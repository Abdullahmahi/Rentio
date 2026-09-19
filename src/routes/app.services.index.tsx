import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Info, Plus, Table2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/rentio/combobox";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MonthSelector, formatPeriod } from "@/components/rentio/month-selector";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { UtilityStatusBadge } from "@/components/rentio/status";
import { formatMXN } from "@/lib/format";
import { periodKey } from "@/lib/invoicing";
import { unitContexts } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { Enums, Tables } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/services/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.services.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.services.description") },
    ],
  }),
  component: ServicesPage,
});

const ALL = "__all__";
const TYPES: Enums<"utility_type">[] = ["agua", "luz", "gas", "cuota_mantenimiento", "otro"];

interface ChargeRow extends Tables<"utility_charges"> {
  unitNumber: string;
  tenantName: string;
  propertyId: string | null;
  invoiceNumber: string | null;
}

function ServicesPage() {
  const { t, i18n: i18nInstance } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [period, setPeriod] = useState(() => periodKey(new Date()));
  const [propertyFilter, setPropertyFilter] = useState(ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    unit_id: null as string | null,
    type: "agua" as Enums<"utility_type">,
    amount: "" as number | "",
    notes: "",
  });
  const [bulk, setBulk] = useState({
    property_id: "",
    type: "cuota_mantenimiento" as Enums<"utility_type">,
  });
  const [amounts, setAmounts] = useState<Record<string, number | "">>({});
  const [applyAll, setApplyAll] = useState<number | "">("");

  const charges = useQuery({
    queryKey: qk.utilities(period),
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("utility_charges")
        .select("*")
        .eq("period_month", period)
        .order("created_at");
      if (caught) throw caught;

      // Resolve the folio of whichever invoice consumed each billed charge.
      const invoiceIds = [
        ...new Set(
          (data ?? []).map((row) => row.invoice_id).filter((v): v is string => Boolean(v)),
        ),
      ];
      const folios = new Map<string, string | null>();
      if (invoiceIds.length > 0) {
        const { data: invoices } = await supabase
          .from("invoices")
          .select("id, invoice_number")
          .in("id", invoiceIds);
        for (const invoice of invoices ?? []) folios.set(invoice.id, invoice.invoice_number);
      }
      return (data ?? []).map((row) => ({
        ...row,
        _folio: row.invoice_id ? (folios.get(row.invoice_id) ?? null) : null,
      }));
    },
  });

  const units = useMemo(
    () => (portfolio.data ? unitContexts(portfolio.data) : []),
    [portfolio.data],
  );

  const rows = useMemo<ChargeRow[]>(() => {
    const byUnit = new Map(units.map((row) => [row.unit.id, row]));
    return (charges.data ?? [])
      .map((charge) => {
        const context = byUnit.get(charge.unit_id);
        return {
          ...charge,
          unitNumber: context?.unit.unit_number ?? "—",
          tenantName: context?.tenant?.full_name ?? "—",
          propertyId: context?.property?.id ?? null,
          invoiceNumber: charge._folio,
        };
      })
      .filter((row) => propertyFilter === ALL || row.propertyId === propertyFilter);
  }, [charges.data, units, propertyFilter]);

  const summary = useMemo(() => {
    const pending = rows.filter((row) => row.status === "pendiente");
    const billed = rows.filter((row) => row.status === "facturado");
    const byType = TYPES.map((type) => ({
      type,
      total: rows
        .filter((row) => row.type === type)
        .reduce((sum, row) => sum + Number(row.amount), 0),
    })).filter((entry) => entry.total > 0);
    return {
      pending: pending.reduce((sum, row) => sum + Number(row.amount), 0),
      billed: billed.reduce((sum, row) => sum + Number(row.amount), 0),
      byType,
    };
  }, [rows]);

  const unitOptions = useMemo<ComboboxOption[]>(
    () =>
      units.map((row) => ({
        value: row.unit.id,
        label: `${t("units.columns.unit")} ${row.unit.unit_number}`,
        hint: [row.property?.name, row.tenant?.full_name].filter(Boolean).join(" · "),
        keywords: `${row.property?.name ?? ""} ${row.tenant?.full_name ?? ""}`,
      })),
    [units, t],
  );

  const bulkUnits = useMemo(
    () => units.filter((row) => row.unit.property_id === bulk.property_id),
    [units, bulk.property_id],
  );

  /** A unit that already carries this type for this month is skipped. */
  const alreadyCharged = useMemo(() => {
    const set = new Set<string>();
    for (const charge of charges.data ?? []) {
      if (charge.type === bulk.type) set.add(charge.unit_id);
    }
    return set;
  }, [charges.data, bulk.type]);

  const bulkTotal = bulkUnits.reduce((sum, row) => {
    if (alreadyCharged.has(row.unit.id)) return sum;
    const value = amounts[row.unit.id];
    return sum + (value === "" || value === undefined ? 0 : value);
  }, 0);

  const create = useToastMutation({
    mutationFn: async (values: typeof form) => {
      if (!values.unit_id) throw new Error("no-unit");
      const context = units.find((row) => row.unit.id === values.unit_id);
      const { error: caught } = await supabase.from("utility_charges").insert({
        unit_id: values.unit_id,
        lease_id: context?.activeLease?.id ?? null,
        type: values.type,
        period_month: period,
        amount: values.amount === "" ? 0 : values.amount,
        status: "pendiente",
        notes: values.notes.trim() || null,
      });
      if (caught) throw caught;
      await logActivity(actorId, "utility_charge", null, "create", {
        unit: values.unit_id,
        type: values.type,
        period,
      });
    },
    successKey: "services.created",
    invalidate: [qk.utilities(period)],
    onSuccess: () => {
      setCreateOpen(false);
      setForm({ ...form, amount: "", notes: "" });
    },
  });

  const createBulk = useToastMutation({
    mutationFn: async () => {
      const inserts = bulkUnits
        .filter((row) => !alreadyCharged.has(row.unit.id))
        .map((row) => ({ row, amount: amounts[row.unit.id] }))
        .filter(
          (entry): entry is { row: (typeof bulkUnits)[number]; amount: number } =>
            entry.amount !== "" && entry.amount !== undefined && entry.amount > 0,
        )
        .map(({ row, amount }) => ({
          unit_id: row.unit.id,
          lease_id: row.activeLease?.id ?? null,
          type: bulk.type,
          period_month: period,
          amount,
          status: "pendiente" as const,
        }));

      if (inserts.length === 0) throw new Error("nothing-to-save");
      const { error: caught } = await supabase.from("utility_charges").insert(inserts);
      if (caught) throw caught;
      await logActivity(actorId, "utility_charge", null, "bulk_create", {
        count: inserts.length,
        type: bulk.type,
        period,
      });
      return inserts.length;
    },
    successKey: "services.bulkCreated",
    invalidate: [qk.utilities(period)],
    onSuccess: () => {
      setBulkOpen(false);
      setAmounts({});
      setApplyAll("");
    },
  });

  const remove = useToastMutation({
    mutationFn: async (charge: ChargeRow) => {
      const { error: caught } = await supabase.from("utility_charges").delete().eq("id", charge.id);
      if (caught) throw caught;
    },
    successKey: "services.deleted",
    invalidate: [qk.utilities(period)],
  });

  const columns: DataTableColumn<ChargeRow>[] = [
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => <span className="font-medium">{row.unitNumber}</span>,
    },
    {
      key: "tenant",
      header: t("contracts.columns.tenant"),
      sortValue: (row) => row.tenantName,
      cell: (row) => row.tenantName,
    },
    {
      key: "type",
      header: t("services.columns.type"),
      sortValue: (row) => row.type,
      cell: (row) => t(`utilityType.${row.type}`),
    },
    {
      key: "period",
      header: t("receipts.columns.period"),
      sortValue: (row) => row.period_month,
      cell: (row) => (
        <span className="numeric">{formatPeriod(row.period_month, i18nInstance.language)}</span>
      ),
    },
    {
      key: "amount",
      header: t("payments.columns.amount"),
      numeric: true,
      sortValue: (row) => Number(row.amount),
      cell: (row) => <MoneyText value={Number(row.amount)} />,
    },
    {
      key: "status",
      header: t("receipts.columns.status"),
      sortValue: (row) => row.status,
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          <UtilityStatusBadge value={row.status} />
          {/* A billed charge can't be changed — say which receipt ate it. */}
          {row.status === "facturado" && row.invoiceNumber ? (
            <button
              className="numeric text-xs font-medium text-primary hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                if (row.invoice_id)
                  void navigate({ to: "/app/receipts/$id", params: { id: row.invoice_id } });
              }}
            >
              {row.invoiceNumber}
            </button>
          ) : null}
        </span>
      ),
    },
    {
      key: "notes",
      header: t("services.columns.notes"),
      sortValue: (row) => row.notes ?? "",
      cell: (row) => <span className="text-muted-foreground">{row.notes ?? "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        row.status === "pendiente" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              remove.mutate(row);
            }}
          >
            {t("actions.delete")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.services.title")}
        description={t("pages.services.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthSelector period={period} onChange={setPeriod} />
            <Button
              variant="outline"
              onClick={() => {
                setBulkOpen(true);
                setAmounts({});
                setApplyAll("");
              }}
            >
              <Table2 className="size-4" />
              {t("services.bulk")}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t("services.new")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-subtle">
          <p className="text-xs font-medium text-muted-foreground">
            {t("services.summary.pending")}
          </p>
          <p className="numeric mt-1 text-xl font-semibold text-warning">
            {formatMXN(summary.pending)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-subtle">
          <p className="text-xs font-medium text-muted-foreground">
            {t("services.summary.billed")}
          </p>
          <p className="numeric mt-1 text-xl font-semibold text-success">
            {formatMXN(summary.billed)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-subtle sm:col-span-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("services.summary.byType")}
          </p>
          {summary.byType.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">—</p>
          ) : (
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {summary.byType.map((entry) => (
                <div key={entry.type} className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">{t(`utilityType.${entry.type}`)}</dt>
                  <dd className="numeric font-semibold">{formatMXN(entry.total)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-sm text-info">
        <Info className="mt-0.5 size-4 shrink-0" />
        {t("services.pipelineNote")}
      </p>

      <div className="max-w-xs">
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger aria-label={t("units.filters.property")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("units.filters.allProperties")}</SelectItem>
            {portfolio.data?.properties.map((property) => (
              <SelectItem key={property.id} value={property.id}>
                {property.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <QueryState
        isLoading={charges.isLoading || portfolio.isLoading}
        error={charges.error ?? portfolio.error}
        isEmpty={rows.length === 0}
        onRetry={() => void charges.refetch()}
        skeleton={<RowsSkeleton count={8} />}
        empty={
          <EmptyState
            icon={Zap}
            message={t("services.emptyTitle", {
              month: formatPeriod(period, i18nInstance.language),
            })}
            description={t("services.emptyDescription")}
            actionLabel={t("services.bulk")}
            onAction={() => setBulkOpen(true)}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          searchValue={(row) => `${row.unitNumber} ${row.tenantName} ${row.notes ?? ""}`}
          pageSize={20}
        />
      </QueryState>

      {/* --------------------------------------------------- single charge */}
      <FormDialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) setError(null);
        }}
        title={t("services.new")}
        description={t("services.newDescription", {
          month: formatPeriod(period, i18nInstance.language),
        })}
        error={error}
        pending={create.isPending}
        onSubmit={() => {
          setError(null);
          if (!form.unit_id) return setError(t("services.errors.unitRequired"));
          if (form.amount === "" || Number(form.amount) <= 0)
            return setError(t("services.errors.amountRequired"));
          create.mutate(form);
        }}
      >
        <Field label={t("units.columns.unit")}>
          <Combobox
            options={unitOptions}
            value={form.unit_id}
            onChange={(value) => setForm({ ...form, unit_id: value })}
            placeholder={t("contracts.fields.unitPlaceholder")}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("services.columns.type")}>
            <Select
              value={form.type}
              onValueChange={(value) => setForm({ ...form, type: value as Enums<"utility_type"> })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`utilityType.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("payments.columns.amount")}>
            <MoneyInput
              value={form.amount}
              onChange={(value) => setForm({ ...form, amount: value })}
            />
          </Field>
        </div>
        <Field label={t("services.columns.notes")} htmlFor="charge-notes">
          <Textarea
            id="charge-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </FormDialog>

      {/* ------------------------------------------------- bulk capture */}
      <FormDialog
        open={bulkOpen}
        onOpenChange={(next) => {
          setBulkOpen(next);
          if (!next) setError(null);
        }}
        wide
        title={t("services.bulk")}
        description={t("services.bulkDescription", {
          month: formatPeriod(period, i18nInstance.language),
        })}
        error={error}
        pending={createBulk.isPending}
        submitLabel={t("services.bulkSubmit")}
        disabled={bulkTotal <= 0}
        onSubmit={() => {
          setError(null);
          if (!bulk.property_id) return setError(t("units.errors.propertyRequired"));
          createBulk.mutate(undefined);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("units.fields.property")}>
            <Select
              value={bulk.property_id}
              onValueChange={(value) => {
                setBulk({ ...bulk, property_id: value });
                setAmounts({});
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("units.fields.propertyPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {portfolio.data?.properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("services.columns.type")}>
            <Select
              value={bulk.type}
              onValueChange={(value) => setBulk({ ...bulk, type: value as Enums<"utility_type"> })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`utilityType.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/* One field fills every row — a flat cuota is the common case. */}
        <Field label={t("services.applyAll")} hint={t("services.applyAllHint")}>
          <div className="flex gap-2">
            <MoneyInput className="flex-1" value={applyAll} onChange={setApplyAll} />
            <Button
              type="button"
              variant="outline"
              disabled={applyAll === "" || bulkUnits.length === 0}
              onClick={() => {
                const next: Record<string, number | ""> = {};
                for (const row of bulkUnits) {
                  if (!alreadyCharged.has(row.unit.id)) next[row.unit.id] = applyAll;
                }
                setAmounts(next);
              }}
            >
              {t("actions.apply")}
            </Button>
          </div>
        </Field>

        {bulk.property_id ? (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-left text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="h-9 px-3">{t("units.columns.unit")}</th>
                  <th className="h-9 px-3">{t("units.columns.tenant")}</th>
                  <th className="h-9 w-44 px-3 text-right">{t("payments.columns.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {bulkUnits.map((row) => {
                  const skipped = alreadyCharged.has(row.unit.id);
                  return (
                    <tr key={row.unit.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{row.unit.unit_number}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {skipped ? t("services.alreadyCharged") : (row.tenant?.full_name ?? "—")}
                      </td>
                      <td className="px-3 py-2">
                        <MoneyInput
                          disabled={skipped}
                          value={amounts[row.unit.id] ?? ""}
                          onChange={(value) => setAmounts({ ...amounts, [row.unit.id]: value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2.5">
          <span className="text-sm font-medium">{t("services.runningTotal")}</span>
          <MoneyText value={bulkTotal} className="text-base font-semibold" />
        </div>
      </FormDialog>
    </div>
  );
}
