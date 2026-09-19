import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ClipboardCopy, Clock, CreditCard, ReceiptText, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/rentio/empty-state";
import { MoneyText } from "@/components/rentio/money-text";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { InvoiceStatusBadge, WorkOrderStatusBadge, effectiveInvoiceStatus } from "@/components/rentio/status";
import { formatMXN, formatMexicoDate } from "@/lib/format";
import { useMyPortal, usePublicSettings } from "@/lib/queries";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/portal/")({
  head: () => ({ meta: [{ title: `${i18n.t("pages.home.title")} — Rentio` }] }),
  component: PortalHome,
});

function CopyRow({ label, value }: { label: string; value: string | null | undefined }) {
  const { t } = useTranslation();
  if (!value) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("portal.copied"));
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="numeric truncate text-sm font-medium">{value}</p>
      </div>
      {/* 44px tap target — this gets used one-handed. */}
      <Button size="icon" variant="ghost" className="size-11" onClick={() => void copy()} aria-label={`${t("portal.copy")} ${label}`}>
        <ClipboardCopy className="size-4" />
      </Button>
    </div>
  );
}

function PortalHome() {
  const { t } = useTranslation();
  const portal = useMyPortal();
  const settings = usePublicSettings();

  const balance = Number(portal.data?.balance?.balance ?? 0);
  const owes = balance > 0.005;
  const pendingReport = portal.data?.payments.find((payment) => payment.status === "pendiente");
  const nextInvoice = portal.data?.invoices.find((invoice) => invoice.balance > 0.005);
  const openOrders = (portal.data?.workOrders ?? []).filter(
    (order) => !["resuelta", "cerrada"].includes(order.status),
  );
  const recentPayments = (portal.data?.payments ?? []).slice(0, 3);

  return (
    <div className="space-y-5">
      <QueryState
        isLoading={portal.isLoading}
        error={portal.error}
        isEmpty={!portal.data?.lease && !portal.isLoading}
        onRetry={() => void portal.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={<EmptyState message={t("portal.noLeaseTitle")} description={t("portal.noLeaseDescription")} />}
      >
        {/* ------------------------------------------- the balance card */}
        <section
          className={`rounded-lg border p-5 ${owes ? "border-danger/25 bg-danger/5" : "border-success/25 bg-success/5"}`}
        >
          {owes ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">{t("portal.balanceDue")}</p>
              <p className="numeric mt-1 text-4xl font-semibold text-danger sm:text-5xl">{formatMXN(balance)}</p>
              {nextInvoice ? (
                <p className="numeric mt-2 text-sm text-muted-foreground">
                  {t("portal.dueOn", { date: formatMexicoDate(nextInvoice.due_date) })}
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-8 shrink-0 text-success" />
              <div>
                <p className="text-xl font-semibold text-success">{t("portal.upToDate")}</p>
                <p className="text-sm text-muted-foreground">{t("portal.upToDateHint")}</p>
              </div>
            </div>
          )}

          {pendingReport ? (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-sm font-medium text-warning">
              <Clock className="size-4" />
              {t("portal.paymentUnderReview", { amount: formatMXN(Number(pendingReport.amount)) })}
            </p>
          ) : null}

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button asChild className="h-12 text-base">
              <Link to="/portal/report-payment">{t("portal.reportPayment")}</Link>
            </Button>

            {/* Intentionally present and disabled — online payments are Phase 2. */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button variant="outline" className="h-12 w-full text-base" disabled aria-disabled="true">
                      <CreditCard className="size-4" />{t("portal.payOnline")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("portal.payOnlineSoon")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="mt-2 text-xs text-muted-foreground sm:text-right">{t("portal.payOnlineSoon")}</p>
        </section>

        {/* -------------------------------------------- transfer details */}
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">{t("portal.transferTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("portal.transferHint")}</p>
          <dl className="mt-3">
            <CopyRow label={t("portal.bank")} value={settings.data?.bank_name} />
            <CopyRow label={t("portal.clabe")} value={settings.data?.clabe} />
            <CopyRow label={t("portal.accountHolder")} value={settings.data?.account_holder} />
            <CopyRow label={t("portal.reference")} value={portal.data?.details?.unit_number} />
          </dl>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* ------------------------------------------------ next payment */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <ReceiptText className="size-4 text-muted-foreground" />{t("portal.nextPayment")}
            </h2>
            {nextInvoice ? (
              <div className="mt-3 space-y-1">
                <MoneyText value={nextInvoice.balance} className="block text-2xl font-semibold" />
                <p className="numeric text-sm text-muted-foreground">
                  {t("portal.dueOn", { date: formatMexicoDate(nextInvoice.due_date) })}
                </p>
                <InvoiceStatusBadge value={effectiveInvoiceStatus(nextInvoice, nextInvoice.paid)} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{t("portal.noPendingInvoices")}</p>
            )}
            <Button asChild variant="outline" className="mt-4 h-11 w-full">
              <Link to="/portal/receipts">{t("portal.viewReceipts")}</Link>
            </Button>
          </section>

          {/* ---------------------------------------------- open requests */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Wrench className="size-4 text-muted-foreground" />{t("portal.openRequests")}
            </h2>
            {openOrders.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("portal.noOpenRequests")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {openOrders.slice(0, 3).map((order) => (
                  <li key={order.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <span className="truncate text-sm">{order.title}</span>
                    <WorkOrderStatusBadge value={order.status} />
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="outline" className="mt-4 h-11 w-full">
              <Link to="/portal/maintenance">{t("portal.viewRequests")}</Link>
            </Button>
          </section>
        </div>

        {/* ------------------------------------------------ recent activity */}
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">{t("portal.recentActivity")}</h2>
          {recentPayments.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("portal.noActivity")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {recentPayments.map((payment) => (
                <li key={payment.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t(`paymentMethod.${payment.method}`)}</p>
                    <p className="numeric text-xs text-muted-foreground">{formatMexicoDate(payment.paid_at)}</p>
                  </div>
                  <div className="text-right">
                    <MoneyText value={Number(payment.amount)} />
                    <p className="text-xs text-muted-foreground">{t(`paymentStatus.${payment.status}`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </QueryState>
    </div>
  );
}
