import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ReceiptText, Send, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/rentio/data-table";
import { EmptyState } from "@/components/rentio/empty-state";
import { FormDialog } from "@/components/rentio/form-dialog";
import { MonthSelector, formatPeriod } from "@/components/rentio/month-selector";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { InvoiceStatusBadge, effectiveInvoiceStatus } from "@/components/rentio/status";
import { formatMXN, formatMexicoDate } from "@/lib/format";
import { periodKey, planMonthlyInvoices } from "@/lib/invoicing";
import { leaseContexts } from "@/lib/portfolio";
import {
  logActivity,
  qk,
  useActorId,
  useInvoices,
  usePortfolio,
  useToastMutation,
  type InvoiceWithPaid,
} from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/receipts/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.receipts.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.receipts.description") },
    ],
  }),
  component: ReceiptsPage,
});

const ALL = "__all__";

interface Row extends InvoiceWithPaid {
  unitNumber: string;
  tenantName: string;
  propertyId: string | null;
  derived: ReturnType<typeof effectiveInvoiceStatus>;
}

function ReceiptsPage() {
  const { t, i18n: i18nInstance } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const actorId = useActorId();

  const [period, setPeriod] = useState(() => periodKey(new Date()));
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [propertyFilter, setPropertyFilter] = useState(ALL);
  const [selected, setSelected] = useState<string[]>([]);
  const [generateOpen, setGenerateOpen] = useState(false);

  const invoices = useInvoices({ period });

  /** Pending charges drive the generation preview, so they load with the page. */
  const pendingUtilities = useQuery({
    queryKey: [...qk.utilities(period), "pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_charges")
        .select("*")
        .eq("status", "pendiente")
        .eq("period_month", period);
      if (error) throw error;
      return data;
    },
  });

  const rows = useMemo<Row[]>(() => {
    if (!invoices.data || !portfolio.data) return [];
    const byLease = new Map(
      leaseContexts(portfolio.data).map((context) => [context.lease.id, context]),
    );

    return invoices.data
      .map((invoice) => {
        const context = byLease.get(invoice.lease_id);
        return {
          ...invoice,
          unitNumber: context?.unit?.unit_number ?? "—",
          tenantName: context?.primaryTenant?.full_name ?? "—",
          propertyId: context?.property?.id ?? null,
          derived: effectiveInvoiceStatus(invoice, invoice.paid),
        };
      })
      .filter((row) => {
        if (statusFilter !== ALL && row.derived !== statusFilter) return false;
        if (propertyFilter !== ALL && row.propertyId !== propertyFilter) return false;
        return true;
      });
  }, [invoices.data, portfolio.data, statusFilter, propertyFilter]);

  const summary = useMemo(() => {
    const all = rows.filter((row) => row.derived !== "cancelado");
    const overdue = all.filter((row) => row.derived === "vencido");
    return {
      invoiced: all.reduce((sum, row) => sum + Number(row.total), 0),
      collected: all.reduce((sum, row) => sum + row.paid, 0),
      pending: all.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
      overdueAmount: overdue.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
      overdueCount: overdue.length,
    };
  }, [rows]);

  const plan = useMemo(() => {
    if (!portfolio.data || !invoices.data) return null;
    return planMonthlyInvoices({
      portfolio: portfolio.data,
      period,
      invoicedLeaseIds: new Set(invoices.data.map((invoice) => invoice.lease_id)),
      pendingUtilities: pendingUtilities.data ?? [],
      labels: {
        rent: t("receipts.lines.rent"),
        parking: (label) => t("receipts.lines.parking", { label }),
      },
    });
  }, [portfolio.data, invoices.data, pendingUtilities.data, period, t]);

  const generate = useToastMutation({
    mutationFn: async () => {
      if (!plan) throw new Error("no-plan");
      let created = 0;

      for (const planned of plan.toCreate) {
        const { data: folio, error: folioError } = await supabase.rpc("next_invoice_number");
        if (folioError) throw folioError;

        const { data: invoice, error: invoiceError } = await supabase
          .from("invoices")
          .insert({
            lease_id: planned.leaseId,
            period_month: period,
            invoice_number: folio,
            issue_date: new Date().toISOString().slice(0, 10),
            due_date: planned.dueDate,
            status: "borrador",
            total: planned.total,
          })
          .select("id")
          .single();

        // The (lease_id, period_month) unique constraint is the real backstop
        // against double-billing; if a concurrent run won, skip and carry on.
        if (invoiceError) {
          if (invoiceError.code === "23505") continue;
          throw invoiceError;
        }

        const { error: linesError } = await supabase.from("invoice_lines").insert(
          planned.lines.map((line) => ({
            invoice_id: invoice.id,
            description: line.description,
            category: line.category,
            quantity: 1,
            amount: line.amount,
          })),
        );
        if (linesError) throw linesError;

        const consumed = planned.lines
          .map((line) => line.utilityChargeId)
          .filter((value): value is string => Boolean(value));
        if (consumed.length > 0) {
          const { error: utilityError } = await supabase
            .from("utility_charges")
            .update({ status: "facturado", invoice_id: invoice.id })
            .in("id", consumed);
          if (utilityError) throw utilityError;
        }
        created += 1;
      }

      await logActivity(actorId, "invoice", null, "generate_month", { period, created });
      return created;
    },
    successKey: "receipts.generated",
    invalidate: [qk.portfolio, ["invoices"], qk.utilities(period)],
    onSuccess: () => setGenerateOpen(false),
  });

  const sendSelected = useToastMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("invoices").update({ status: "enviado" }).in("id", ids);
      if (error) throw error;
      await logActivity(actorId, "invoice", null, "send_bulk", { count: ids.length, period });
    },
    successKey: "receipts.sent",
    invalidate: [["invoices"]],
    onSuccess: () => setSelected([]),
  });

  const columns: DataTableColumn<Row>[] = [
    {
      key: "folio",
      header: t("receipts.columns.folio"),
      sortValue: (row) => row.invoice_number ?? "",
      cell: (row) => <span className="font-medium">{row.invoice_number ?? "—"}</span>,
    },
    {
      key: "unit",
      header: t("units.columns.unit"),
      sortValue: (row) => row.unitNumber,
      cell: (row) => row.unitNumber,
    },
    {
      key: "tenant",
      header: t("contracts.columns.tenant"),
      sortValue: (row) => row.tenantName,
      cell: (row) => row.tenantName,
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
      key: "issue",
      header: t("receipts.columns.issue"),
      sortValue: (row) => row.issue_date,
      cell: (row) => <span className="numeric">{formatMexicoDate(row.issue_date)}</span>,
    },
    {
      key: "due",
      header: t("receipts.columns.due"),
      sortValue: (row) => row.due_date,
      cell: (row) => <span className="numeric">{formatMexicoDate(row.due_date)}</span>,
    },
    {
      key: "total",
      header: t("receipts.columns.total"),
      numeric: true,
      sortValue: (row) => Number(row.total),
      cell: (row) => <MoneyText value={Number(row.total)} />,
    },
    {
      key: "paid",
      header: t("receipts.columns.paid"),
      numeric: true,
      sortValue: (row) => row.paid,
      cell: (row) => <MoneyText value={row.paid} />,
    },
    {
      key: "balance",
      header: t("receipts.columns.balance"),
      numeric: true,
      sortValue: (row) => row.balance,
      cell: (row) => (
        <MoneyText value={row.balance} className={row.balance > 0 ? "text-danger" : undefined} />
      ),
    },
    {
      key: "status",
      header: t("receipts.columns.status"),
      sortValue: (row) => row.derived,
      cell: (row) => <InvoiceStatusBadge value={row.derived} />,
    },
  ];

  const summaryCards = [
    { key: "invoiced", value: formatMXN(summary.invoiced), tone: "" },
    { key: "collected", value: formatMXN(summary.collected), tone: "text-success" },
    { key: "pending", value: formatMXN(summary.pending), tone: "" },
    {
      key: "overdue",
      value: formatMXN(summary.overdueAmount),
      tone: "text-danger",
      note: t("receipts.overdueCount", { count: summary.overdueCount }),
    },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.receipts.title")}
        description={t("pages.receipts.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthSelector
              period={period}
              onChange={(next) => {
                setPeriod(next);
                setSelected([]);
              }}
            />
            <Button onClick={() => setGenerateOpen(true)} disabled={!plan}>
              <Sparkles className="size-4" />
              {t("receipts.generate")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.key}
            className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
          >
            <p className="text-xs font-medium text-muted-foreground">
              {t(`receipts.summary.${card.key}`)}
            </p>
            <p className={`numeric mt-1 text-xl font-semibold ${card.tone}`}>{card.value}</p>
            {"note" in card && card.note ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{card.note}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label={t("receipts.columns.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("contracts.filters.allStatuses")}</SelectItem>
            {(
              ["borrador", "enviado", "pagado_parcial", "pagado", "vencido", "cancelado"] as const
            ).map((status) => (
              <SelectItem key={status} value={status}>
                {t(`invoiceStatus.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        isLoading={invoices.isLoading || portfolio.isLoading}
        error={invoices.error ?? portfolio.error}
        isEmpty={rows.length === 0}
        onRetry={() => {
          void invoices.refetch();
          void portfolio.refetch();
        }}
        skeleton={<RowsSkeleton count={8} />}
        empty={
          <EmptyState
            icon={ReceiptText}
            message={t("receipts.emptyMonthTitle", {
              month: formatPeriod(period, i18nInstance.language),
            })}
            description={t("receipts.emptyMonthDescription")}
            actionLabel={t("receipts.generate")}
            onAction={() => setGenerateOpen(true)}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          searchValue={(row) => `${row.invoice_number ?? ""} ${row.unitNumber} ${row.tenantName}`}
          onRowClick={(row) => void navigate({ to: "/app/receipts/$id", params: { id: row.id } })}
          pageSize={15}
          selectedIds={selected}
          onSelectionChange={setSelected}
          isSelectable={(row) => row.status === "borrador"}
          bulkActions={
            <Button
              size="sm"
              disabled={sendSelected.isPending}
              onClick={() => sendSelected.mutate(selected)}
            >
              <Send className="size-4" />
              {t("receipts.sendSelected")}
            </Button>
          }
        />
      </QueryState>

      {/* ------------------------------------------- generate the month */}
      <FormDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        wide
        title={t("receipts.generateTitle", { month: formatPeriod(period, i18nInstance.language) })}
        submitLabel={t("receipts.generateSubmit")}
        pending={generate.isPending}
        disabled={!plan || plan.toCreate.length === 0}
        onSubmit={() => generate.mutate(undefined)}
      >
        {plan ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm">
              {plan.toCreate.length > 0
                ? t("receipts.generatePreview", {
                    count: plan.toCreate.length,
                    total: formatMXN(plan.total),
                  })
                : t("receipts.generateNothing")}
            </p>

            {plan.toCreate.length > 0 ? (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-left text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="h-9 px-3">{t("units.columns.unit")}</th>
                      <th className="h-9 px-3">{t("contracts.columns.tenant")}</th>
                      <th className="h-9 px-3">{t("receipts.columns.due")}</th>
                      <th className="h-9 px-3">{t("receipts.columns.lines")}</th>
                      <th className="h-9 px-3 text-right">{t("receipts.columns.total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.toCreate.map((planned) => (
                      <tr key={planned.leaseId} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{planned.unitNumber}</td>
                        <td className="px-3 py-2">{planned.tenantName}</td>
                        <td className="numeric px-3 py-2">{formatMexicoDate(planned.dueDate)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {planned.lines.map((line) => line.description).join(" · ")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <MoneyText value={planned.total} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {plan.skipped.length > 0 ? (
              <div className="rounded-lg border border-warning/25 bg-warning/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  {t("receipts.skippedTitle", { count: plan.skipped.length })}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {plan.skipped.map((skip) => (
                    <li key={skip.leaseId}>
                      {t("units.columns.unit")} {skip.unitNumber} — {skip.tenantName} ·{" "}
                      {t("receipts.skippedReason")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">{t("receipts.generateNote")}</p>
          </div>
        ) : null}
      </FormDialog>
    </div>
  );
}
