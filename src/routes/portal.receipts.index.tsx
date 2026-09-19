import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ReceiptText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/rentio/empty-state";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { InvoiceStatusBadge, effectiveInvoiceStatus } from "@/components/rentio/status";
import { formatPeriod } from "@/components/rentio/month-selector";
import { formatMexicoDate } from "@/lib/format";
import { useMyPortal } from "@/lib/queries";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/portal/receipts/")({
  head: () => ({ meta: [{ title: `${i18n.t("pages.receipts.title")} — Rentio` }] }),
  component: PortalReceipts,
});

function PortalReceipts() {
  const { t, i18n: i18nInstance } = useTranslation();
  const navigate = useNavigate();
  const portal = useMyPortal();

  return (
    <div className="space-y-5">
      <PageHeader title={t("pages.receipts.title")} description={t("portal.receiptsHint")} />

      <QueryState
        isLoading={portal.isLoading}
        error={portal.error}
        isEmpty={(portal.data?.invoices.length ?? 0) === 0}
        onRetry={() => void portal.refetch()}
        skeleton={<RowsSkeleton count={5} />}
        empty={
          <EmptyState
            icon={ReceiptText}
            message={t("receipts.emptyTitle")}
            description={t("portal.noReceipts")}
          />
        }
      >
        <ul className="space-y-3">
          {portal.data?.invoices.map((invoice) => (
            <li key={invoice.id}>
              <button
                onClick={() =>
                  void navigate({ to: "/portal/receipts/$id", params: { id: invoice.id } })
                }
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-surface p-4 text-left hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">
                    {formatPeriod(invoice.period_month, i18nInstance.language)}
                  </p>
                  <p className="numeric mt-0.5 text-xs text-muted-foreground">
                    {invoice.invoice_number ?? "—"} · {t("receipts.columns.due")}{" "}
                    {formatMexicoDate(invoice.due_date)}
                  </p>
                  <div className="mt-2">
                    <InvoiceStatusBadge value={effectiveInvoiceStatus(invoice, invoice.paid)} />
                  </div>
                </div>
                <div className="text-right">
                  <MoneyText value={Number(invoice.total)} className="block font-semibold" />
                  {invoice.balance > 0.005 ? (
                    <p className="numeric mt-1 text-xs text-danger">
                      {t("receipts.columns.balance")}: <MoneyText value={invoice.balance} />
                    </p>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </QueryState>
    </div>
  );
}
