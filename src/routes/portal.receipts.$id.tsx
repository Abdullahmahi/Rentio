import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, ReceiptText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/rentio/empty-state";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { InvoiceStatusBadge, effectiveInvoiceStatus } from "@/components/rentio/status";
import { formatPeriod } from "@/components/rentio/month-selector";
import { formatMXN, formatMexicoDate } from "@/lib/format";
import { useMyPortal } from "@/lib/queries";
import { describeError, supabase } from "@/lib/supabase";

export const Route = createFileRoute("/portal/receipts/$id")({ component: PortalReceiptDetail });

function PortalReceiptDetail() {
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const portal = useMyPortal();

  const invoice = portal.data?.invoices.find((row) => row.id === id);

  const lines = useQuery({
    queryKey: ["portal-invoice-lines", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_lines").select("*").eq("invoice_id", id).order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const downloadPdf = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("generate-invoice-pdf", { body: { invoice_id: id } });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("no-url");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      toast.error(t(describeError(caught)));
    }
  };

  return (
    <div className="space-y-5">
      <Link to="/portal/receipts" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />{t("receipts.backToList")}
      </Link>

      <QueryState
        isLoading={portal.isLoading || lines.isLoading}
        error={portal.error ?? lines.error}
        isEmpty={!invoice && !portal.isLoading}
        onRetry={() => void portal.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={<EmptyState icon={ReceiptText} message={t("receipts.notFound")} description={t("receipts.notFoundDescription")} />}
      >
        {invoice ? (
          <>
            <PageHeader
              title={formatPeriod(invoice.period_month, i18n.language)}
              description={`${invoice.invoice_number ?? "—"} · ${t("receipts.columns.due")} ${formatMexicoDate(invoice.due_date)}`}
              actions={<InvoiceStatusBadge value={effectiveInvoiceStatus(invoice, invoice.paid)} />}
            />

            <section className="overflow-hidden rounded-lg border border-border bg-surface">
              <ul className="divide-y divide-border">
                {lines.data?.map((line) => (
                  <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.description}</p>
                      <p className="text-xs text-muted-foreground">{t(`lineCategory.${line.category}`)}</p>
                    </div>
                    <MoneyText value={Number(line.amount) * Number(line.quantity)} />
                  </li>
                ))}
              </ul>
              <dl className="space-y-1.5 border-t border-border bg-muted/40 px-4 py-3 text-sm">
                {([
                  ["receipts.columns.total", Number(invoice.total), ""],
                  ["receipts.columns.paid", invoice.paid, "text-success"],
                  ["receipts.columns.balance", invoice.balance, invoice.balance > 0.005 ? "text-danger" : ""],
                ] as const).map(([key, value, tone]) => (
                  <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                    <dt className="text-muted-foreground">{t(key)}</dt>
                    <dd className={`numeric font-semibold ${tone}`}>{formatMXN(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <Button variant="outline" className="h-12 w-full" onClick={() => void downloadPdf()}>
              <Download className="size-4" />{t("receipts.downloadPdf")}
            </Button>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
