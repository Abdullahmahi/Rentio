import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Receipt } from "lucide-react";
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
import { ConfirmDialog } from "@/components/rentio/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MonthSelector, formatPeriod } from "@/components/rentio/month-selector";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { currentPeriod, shiftPeriod } from "@/lib/invoicing";
import { unitContexts } from "@/lib/portfolio";
import { logActivity, qk, useActorId, usePortfolio, useToastMutation } from "@/lib/queries";
import { db } from "@/lib/db";
import type { Tables } from "@/lib/database.types";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/app/expenses/")({
  head: () => ({
    meta: [
      { title: pageTitle(i18n.t("pages.expenses.title")) },
      { name: "description", content: i18n.t("pages.expenses.description") },
    ],
  }),
  component: ExpensesPage,
});

const ALL = "__all__";

interface ExpenseRow extends Tables<"expenses"> {
  unitNumber: string;
  propertyId: string | null;
  propertyName: string;
}

const emptyForm = () => ({
  id: null as string | null,
  unit_id: null as string | null,
  amount: "" as number | "",
  spent_at: todayIso(),
  description: "",
  notes: "",
});

function ExpensesPage() {
  const { t, i18n: i18nInstance } = useTranslation();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [period, setPeriod] = useState(() => currentPeriod());
  const [propertyFilter, setPropertyFilter] = useState(ALL);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const expenses = useQuery({
    queryKey: qk.expenses(period),
    queryFn: async () => {
      const { data, error: caught } = await db
        .from("expenses")
        .select("*")
        .gte("spent_at", period)
        .lt("spent_at", shiftPeriod(period, 1))
        .order("spent_at", { ascending: false });
      if (caught) throw caught;
      return data ?? [];
    },
  });

  const units = useMemo(
    () => (portfolio.data ? unitContexts(portfolio.data) : []),
    [portfolio.data],
  );

  const rows = useMemo<ExpenseRow[]>(() => {
    const byUnit = new Map(units.map((row) => [row.unit.id, row]));
    return (expenses.data ?? [])
      .map((expense) => {
        const context = byUnit.get(expense.unit_id);
        return {
          ...expense,
          unitNumber: context?.unit.unit_number ?? "—",
          propertyId: context?.property?.id ?? null,
          propertyName: context?.property?.name ?? "—",
        };
      })
      .filter((row) => propertyFilter === ALL || row.propertyId === propertyFilter);
  }, [expenses.data, units, propertyFilter]);

  const summary = useMemo(() => {
    const byProperty = new Map<string, number>();
    for (const row of rows) {
      byProperty.set(
        row.propertyName,
        (byProperty.get(row.propertyName) ?? 0) + Number(row.amount),
      );
    }
    return {
      total: rows.reduce((sum, row) => sum + Number(row.amount), 0),
      byProperty: [...byProperty].sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  const unitOptions = useMemo<ComboboxOption[]>(
    () =>
      units.map((row) => ({
        value: row.unit.id,
        label: `${t("units.columns.unit")} ${row.unit.unit_number}`,
        hint: row.property?.name ?? "",
        keywords: row.property?.name ?? "",
      })),
    [units, t],
  );

  const invalidate = [qk.expenses(period), ["report-expenses"]];

  const save = useToastMutation({
    mutationFn: async (values: ReturnType<typeof emptyForm>) => {
      if (!values.unit_id || values.amount === "") throw new Error("invalid");
      const record = {
        unit_id: values.unit_id,
        amount: values.amount,
        spent_at: values.spent_at,
        description: values.description.trim(),
        notes: values.notes.trim() || null,
      };
      const { data, error: caught } = values.id
        ? await db.from("expenses").update(record).eq("id", values.id).select("id").single()
        : await db
            .from("expenses")
            .insert({ ...record, created_by: actorId })
            .select("id")
            .single();
      if (caught) throw caught;
      await logActivity(actorId, "expense", data.id, values.id ? "update" : "create", {
        unit: values.unit_id,
        amount: values.amount,
      });
    },
    successKey: "expenses.saved",
    invalidate,
    onSuccess: () => {
      setFormOpen(false);
      setForm(emptyForm());
    },
  });

  const remove = useToastMutation({
    mutationFn: async (row: ExpenseRow) => {
      const { error: caught } = await db.from("expenses").delete().eq("id", row.id);
      if (caught) throw caught;
      await logActivity(actorId, "expense", row.id, "delete", {
        unit: row.unit_id,
        amount: row.amount,
      });
    },
    successKey: "expenses.deleted",
    invalidate,
  });

  const openForm = (row?: ExpenseRow) => {
    setError(null);
    setForm(
      row
        ? {
            id: row.id,
            unit_id: row.unit_id,
            amount: Number(row.amount),
            spent_at: row.spent_at,
            description: row.description,
            notes: row.notes ?? "",
          }
        : emptyForm(),
    );
    setFormOpen(true);
  };

  const columns: DataTableColumn<ExpenseRow>[] = [
    {
      key: "date",
      header: t("expenses.columns.date"),
      sortValue: (row) => row.spent_at,
      cell: (row) => <span className="numeric">{formatDate(row.spent_at)}</span>,
    },
    {
      key: "property",
      header: t("units.fields.property"),
      sortValue: (row) => row.propertyName,
      cell: (row) => row.propertyName,
    },
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => <span className="font-medium">{row.unitNumber}</span>,
    },
    {
      key: "description",
      header: t("expenses.columns.description"),
      sortValue: (row) => row.description,
      cell: (row) => row.description,
    },
    {
      key: "amount",
      header: t("payments.columns.amount"),
      numeric: true,
      sortValue: (row) => Number(row.amount),
      cell: (row) => <MoneyText value={Number(row.amount)} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        // The row itself opens the editor; keep the delete click to itself.
        <div onClick={(event) => event.stopPropagation()}>
          <ConfirmDialog
            triggerLabel={t("actions.delete")}
            triggerVariant="ghost"
            destructive
            title={t("expenses.deleteTitle")}
            description={t("expenses.deleteDescription")}
            onConfirm={() => remove.mutate(row)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.expenses.title")}
        description={t("pages.expenses.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthSelector period={period} onChange={setPeriod} />
            <Button onClick={() => openForm()}>
              <Plus className="size-4" />
              {t("expenses.new")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-subtle">
          <p className="text-xs font-medium text-muted-foreground">{t("expenses.summary.total")}</p>
          <p className="numeric mt-1 text-xl font-semibold">{formatMoney(summary.total)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-subtle sm:col-span-1 xl:col-span-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t("expenses.summary.byProperty")}
          </p>
          {summary.byProperty.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">—</p>
          ) : (
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {summary.byProperty.map(([name, total]) => (
                <div key={name} className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="numeric font-semibold">{formatMoney(total)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

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
        isLoading={expenses.isLoading || portfolio.isLoading}
        error={expenses.error ?? portfolio.error}
        isEmpty={rows.length === 0}
        onRetry={() => void expenses.refetch()}
        skeleton={<RowsSkeleton count={8} />}
        empty={
          <EmptyState
            icon={Receipt}
            message={t("expenses.emptyTitle", {
              month: formatPeriod(period, i18nInstance.language),
            })}
            description={t("expenses.emptyDescription")}
            actionLabel={t("expenses.new")}
            onAction={() => openForm()}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={openForm}
          searchValue={(row) =>
            `${row.propertyName} ${row.unitNumber} ${row.description} ${row.notes ?? ""}`
          }
          pageSize={20}
        />
      </QueryState>

      <FormDialog
        open={formOpen}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) setError(null);
        }}
        title={t(form.id ? "expenses.edit" : "expenses.new")}
        error={error}
        pending={save.isPending}
        onSubmit={() => {
          setError(null);
          if (!form.unit_id) return setError(t("expenses.errors.unitRequired"));
          if (form.amount === "" || Number(form.amount) <= 0)
            return setError(t("expenses.errors.amountRequired"));
          if (!form.spent_at) return setError(t("expenses.errors.dateRequired"));
          if (!form.description.trim()) return setError(t("expenses.errors.descriptionRequired"));
          save.mutate(form);
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
          <Field label={t("payments.columns.amount")}>
            <MoneyInput
              value={form.amount}
              onChange={(value) => setForm({ ...form, amount: value })}
            />
          </Field>
          <Field label={t("expenses.columns.date")} htmlFor="expense-date">
            <Input
              id="expense-date"
              type="date"
              value={form.spent_at}
              onChange={(event) => setForm({ ...form, spent_at: event.target.value })}
            />
          </Field>
        </div>
        <Field label={t("expenses.columns.description")} htmlFor="expense-description">
          <Input
            id="expense-description"
            value={form.description}
            placeholder={t("expenses.descriptionPlaceholder")}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        <Field label={t("services.columns.notes")} htmlFor="expense-notes">
          <Textarea
            id="expense-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </FormDialog>
    </div>
  );
}
