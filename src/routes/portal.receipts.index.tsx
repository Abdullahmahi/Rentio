import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, ReceiptText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/rentio/empty-state";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { InvoiceStatusBadge, effectiveInvoiceStatus } from "@/components/rentio/status";
import { formatPeriod } from "@/components/rentio/month-selector";
import { formatDate } from "@/lib/format";
import { useMyPortal } from "@/lib/queries";
import { cn } from "@/lib/utils";
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
          {portal.data?.invoices.map((invoice) => {
            const status = effectiveInvoiceStatus(invoice, invoice.paid);
            const settled = invoice.balance <= 0.005;
            return (
              <li key={invoice.id}>
                {/* This is the screen a tenant opens when they are anxiously
                    checking whether a payment landed. Settled reads quiet;
                    outstanding reads loud. */}
                <div
                  className={cn(
                    "rounded-lg border bg-surface p-4",
                    settled ? "border-border" : "border-danger/30",
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-base font-semibold",
                          settled && "text-muted-foreground",
                        )}
                      >
                        {formatPeriod(invoice.period_month, i18nInstance.language)}
                      </p>
                      <p className="numeric mt-0.5 text-xs text-muted-foreground">
                        {invoice.invoice_number ?? "—"}
                      </p>
                      <p className="numeric mt-0.5 text-xs text-muted-foreground">
                        {t("receipts.columns.due")} {formatDate(invoice.due_date)}
                      </p>
                      <div className="mt-2">
                        <InvoiceStatusBadge value={status} />
                      </div>
                    </div>
                    <div className="text-right">
                      <MoneyText
                        value={Number(invoice.total)}
                        className={cn(
                          "block text-lg font-semibold",
                          settled && "text-muted-foreground",
                        )}
                      />
                      {settled ? null : (
                        <p className="mt-1 text-xs text-danger">
                          {t("receipts.columns.balance")}:{" "}
                          <MoneyText value={invoice.balance} className="font-semibold" />
                        </p>
                      )}
                    </div>
                  </div>

                  {/* An explicit affordance, not a row that happens to be
                      clickable — a tenant should not have to guess. */}
                  <Button
                    variant="outline"
                    className="mt-3 h-12 w-full"
                    onClick={() =>
                      void navigate({ to: "/portal/receipts/$id", params: { id: invoice.id } })
                    }
                  >
                    <Download className="size-4" />
                    {t("portal.viewReceipt")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </QueryState>
    </div>
  );
}
