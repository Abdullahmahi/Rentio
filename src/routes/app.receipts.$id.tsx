import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Plus, ReceiptText, Send, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { EmptyState } from "@/components/rentio/empty-state";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { MoneyText } from "@/components/rentio/money-text";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import {
  InvoiceStatusBadge,
  PaymentStatusBadge,
  effectiveInvoiceStatus,
} from "@/components/rentio/status";
import { AdminOnly } from "@/lib/auth";
import { formatMXN, formatMexicoDate } from "@/lib/format";
import { formatPeriod } from "@/components/rentio/month-selector";
import { leaseContexts } from "@/lib/portfolio";
import {
  logActivity,
  qk,
  useActorId,
  usePortfolio,
  useSettings,
  useToastMutation,
} from "@/lib/queries";
import { describeError, supabase } from "@/lib/supabase";
import type { Enums, Tables } from "@/lib/database.types";

export const Route = createFileRoute("/app/receipts/$id")({ component: ReceiptDetailPage });

const LINE_CATEGORIES: Enums<"line_category">[] = [
  "renta",
  "estacionamiento",
  "servicios",
  "cuota_mantenimiento",
  "recargo",
  "otro",
];

function ReceiptDetailPage() {
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const portfolio = usePortfolio();
  const settings = useSettings();
  const actorId = useActorId();

  const [lineOpen, setLineOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<{
    description: string;
    category: Enums<"line_category">;
    quantity: string;
    amount: number | "";
  }>({
    description: "",
    category: "otro",
    quantity: "1",
    amount: "",
  });

  const invoice = useQuery({
    queryKey: qk.invoice(id),
    queryFn: async () => {
      const [
        { data: head, error: headError },
        { data: lines, error: linesError },
        { data: balance },
      ] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
        supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("created_at"),
        supabase.from("invoice_balances").select("*").eq("invoice_id", id).maybeSingle(),
      ]);
      if (headError) throw headError;
      if (linesError) throw linesError;
      return {
        head,
        lines: lines ?? [],
        paid: Number(balance?.paid ?? 0),
      };
    },
  });

  const head = invoice.data?.head;
  const lines = invoice.data?.lines ?? [];
  const paid = invoice.data?.paid ?? 0;

  const payments = useQuery({
    queryKey: [...qk.payments, "invoice", id],
    enabled: Boolean(head),
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("payment_allocations")
        .select("id, amount, payment_id, payments(paid_at, method, reference, status)")
        .eq("invoice_id", id);
      if (caught) throw caught;
      return data;
    },
  });

  const context = useMemo(() => {
    if (!portfolio.data || !head) return undefined;
    return leaseContexts(portfolio.data).find((row) => row.lease.id === head.lease_id);
  }, [portfolio.data, head]);

  const subtotal = lines.reduce((sum, row) => sum + Number(row.amount) * Number(row.quantity), 0);
  const derived = head ? effectiveInvoiceStatus(head, paid) : "borrador";
  const isDraft = head?.status === "borrador";
  const isCancelled = head?.status === "cancelado";
  const overdue = derived === "vencido";
  const hasLateFee = lines.some((row) => row.category === "recargo");

  /** Totals always come from the lines — never edited independently. */
  const syncTotal = async () => {
    const { data } = await supabase
      .from("invoice_lines")
      .select("amount, quantity")
      .eq("invoice_id", id);
    const total = (data ?? []).reduce(
      (sum, row) => sum + Number(row.amount) * Number(row.quantity),
      0,
    );
    await supabase.from("invoices").update({ total }).eq("id", id);
  };

  const addLine = useToastMutation({
    mutationFn: async (values: typeof line) => {
      const { error: caught } = await supabase.from("invoice_lines").insert({
        invoice_id: id,
        description: values.description.trim(),
        category: values.category,
        quantity: Number(values.quantity) || 1,
        amount: values.amount === "" ? 0 : values.amount,
      });
      if (caught) throw caught;
      await syncTotal();
      await logActivity(actorId, "invoice", id, "add_line", { description: values.description });
    },
    successKey: "receipts.lineAdded",
    invalidate: [qk.invoice(id), ["invoices"], qk.portfolio],
    onSuccess: () => {
      setLineOpen(false);
      setLine({ description: "", category: "otro", quantity: "1", amount: "" });
    },
  });

  const removeLine = useToastMutation({
    mutationFn: async (lineId: string) => {
      const { error: caught } = await supabase.from("invoice_lines").delete().eq("id", lineId);
      if (caught) throw caught;
      await syncTotal();
    },
    successKey: "receipts.lineRemoved",
    invalidate: [qk.invoice(id), ["invoices"], qk.portfolio],
  });

  const applyLateFee = useToastMutation({
    mutationFn: async () => {
      const amount = Number(context?.lease.late_fee_amount ?? 0);
      const { error: caught } = await supabase.from("invoice_lines").insert({
        invoice_id: id,
        description: t("receipts.lines.lateFee"),
        category: "recargo",
        quantity: 1,
        amount,
      });
      if (caught) throw caught;
      await syncTotal();
      await logActivity(actorId, "invoice", id, "late_fee", { amount });
    },
    successKey: "receipts.lateFeeApplied",
    invalidate: [qk.invoice(id), ["invoices"], qk.portfolio],
  });

  const send = useToastMutation({
    mutationFn: async () => {
      // Try to email the recibo with its PDF attached. If the edge function
      // isn't deployed (or email isn't configured yet), still mark it sent —
      // the operator's workflow must not be blocked on the mail provider.
      let emailed = false;
      try {
        const { error: functionError } = await supabase.functions.invoke("send-invoice-email", {
          body: { invoice_id: id },
        });
        emailed = !functionError;
        if (functionError) console.warn("send-invoice-email", functionError);
      } catch (caught) {
        console.warn("send-invoice-email", caught);
      }

      const { error: caught } = await supabase
        .from("invoices")
        .update({ status: "enviado" })
        .eq("id", id);
      if (caught) throw caught;
      await logActivity(actorId, "invoice", id, "send", { emailed });
      return emailed;
    },
    successKey: "receipts.sent",
    invalidate: [qk.invoice(id), ["invoices"]],
    onSuccess: (emailed) => {
      if (!emailed) toast.warning(t("receipts.sentWithoutEmail"));
    },
  });

  // Cancelling never deletes — the folio has to stay auditable.
  const cancel = useToastMutation({
    mutationFn: async (reason: string) => {
      const { error: caught } = await supabase
        .from("invoices")
        .update({ status: "cancelado", cancel_reason: reason })
        .eq("id", id);
      if (caught) throw caught;
      await logActivity(actorId, "invoice", id, "cancel", { reason });
    },
    successKey: "receipts.cancelled",
    invalidate: [qk.invoice(id), ["invoices"], qk.portfolio],
    onSuccess: () => {
      setCancelOpen(false);
      setCancelReason("");
    },
  });

  const downloadPdf = async () => {
    try {
      const { data, error: caught } = await supabase.functions.invoke("generate-invoice-pdf", {
        body: { invoice_id: id },
      });
      if (caught) throw caught;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("no-url");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      toast.error(t(describeError(caught)));
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/app/receipts"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("receipts.backToList")}
      </Link>

      <QueryState
        isLoading={invoice.isLoading || portfolio.isLoading}
        error={invoice.error ?? portfolio.error}
        isEmpty={!head && !invoice.isLoading}
        onRetry={() => void invoice.refetch()}
        skeleton={<RowsSkeleton count={5} />}
        empty={
          <EmptyState
            icon={ReceiptText}
            message={t("receipts.notFound")}
            description={t("receipts.notFoundDescription")}
          />
        }
      >
        {head ? (
          <>
            <PageHeader
              title={head.invoice_number ?? t("receipts.untitled")}
              description={t("receipts.detailDescription", {
                unit: context?.unit?.unit_number ?? "—",
                tenant: context?.primaryTenant?.full_name ?? "—",
                period: formatPeriod(head.period_month, i18n.language),
              })}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <InvoiceStatusBadge value={derived} />
                  {isDraft ? (
                    <Button onClick={() => send.mutate(undefined)} disabled={send.isPending}>
                      <Send className="size-4" />
                      {t("receipts.send")}
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={() => void downloadPdf()}>
                    <Download className="size-4" />
                    {t("receipts.downloadPdf")}
                  </Button>
                  {!isCancelled ? (
                    <AdminOnly>
                      <Button variant="outline" onClick={() => setCancelOpen(true)}>
                        {t("receipts.cancel")}
                      </Button>
                    </AdminOnly>
                  ) : null}
                </div>
              }
            />

            {isCancelled ? (
              <p
                role="status"
                className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
              >
                {t("receipts.cancelledNotice", { reason: head.cancel_reason ?? "—" })}
              </p>
            ) : null}

            {/* ------------------------------------------- company header */}
            <section className="grid gap-6 rounded-lg border border-border bg-surface p-6 shadow-subtle sm:grid-cols-2">
              <div>
                <p className="text-base font-semibold">{settings.data?.company_name ?? "Rentio"}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[settings.data?.street, settings.data?.colonia].filter(Boolean).join(", ")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[settings.data?.city, settings.data?.state, settings.data?.postal_code]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {settings.data?.email ? (
                  <p className="text-sm text-muted-foreground">{settings.data.email}</p>
                ) : null}
              </div>
              <dl className="space-y-1.5 text-sm sm:text-right">
                <div>
                  <dt className="inline text-muted-foreground">{t("receipts.columns.folio")}: </dt>
                  <dd className="numeric inline font-medium">{head.invoice_number ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">{t("receipts.columns.period")}: </dt>
                  <dd className="inline font-medium">
                    {formatPeriod(head.period_month, i18n.language)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">{t("receipts.columns.issue")}: </dt>
                  <dd className="numeric inline font-medium">
                    {formatMexicoDate(head.issue_date)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">{t("receipts.columns.due")}: </dt>
                  <dd className="numeric inline font-medium">{formatMexicoDate(head.due_date)}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">{t("units.columns.unit")}: </dt>
                  <dd className="inline font-medium">
                    {context?.unit?.unit_number ?? "—"} · {context?.property?.name ?? ""}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">
                    {t("contracts.columns.tenant")}:{" "}
                  </dt>
                  <dd className="inline font-medium">{context?.primaryTenant?.full_name ?? "—"}</dd>
                </div>
              </dl>
            </section>

            {/* ------------------------------------------------ line items */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{t("receipts.conceptsTitle")}</h2>
                <div className="flex flex-wrap gap-2">
                  {/* Only enabled once the invoice is actually overdue. */}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!overdue || hasLateFee || isCancelled || applyLateFee.isPending}
                    title={overdue ? undefined : t("receipts.lateFeeDisabled")}
                    onClick={() => applyLateFee.mutate(undefined)}
                  >
                    {t("receipts.applyLateFee")}
                  </Button>
                  {isDraft ? (
                    <Button variant="outline" size="sm" onClick={() => setLineOpen(true)}>
                      <Plus className="size-4" />
                      {t("receipts.addLine")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-muted/70 text-left text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="h-10 px-4">{t("receipts.line.description")}</th>
                      <th className="h-10 px-4">{t("receipts.line.category")}</th>
                      <th className="h-10 px-4 text-right">{t("receipts.line.quantity")}</th>
                      <th className="h-10 px-4 text-right">{t("receipts.line.amount")}</th>
                      {isDraft ? <th className="h-10 w-12 px-4" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((row: Tables<"invoice_lines">) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-4 py-2.5">{row.description}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {t(`lineCategory.${row.category}`)}
                        </td>
                        <td className="numeric px-4 py-2.5 text-right">{Number(row.quantity)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <MoneyText value={Number(row.amount) * Number(row.quantity)} />
                        </td>
                        {isDraft ? (
                          <td className="px-4 py-2.5 text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t("actions.delete")}
                              onClick={() => removeLine.mutate(row.id)}
                            >
                              <Trash2 className="size-4 text-danger" />
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    <tr className="border-t border-border bg-muted/40">
                      <td className="px-4 py-2.5 font-medium" colSpan={isDraft ? 4 : 3}>
                        {t("receipts.subtotal")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <MoneyText value={subtotal} />
                      </td>
                      {isDraft ? <td /> : null}
                    </tr>
                    <tr className="border-t border-border bg-muted/40">
                      <td className="px-4 py-2.5 font-semibold" colSpan={isDraft ? 4 : 3}>
                        {t("receipts.columns.total")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <MoneyText value={subtotal} className="font-semibold" />
                      </td>
                      {isDraft ? <td /> : null}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["receipts.columns.total", subtotal, ""],
                    ["receipts.columns.paid", paid, "text-success"],
                    [
                      "receipts.columns.balance",
                      subtotal - paid,
                      subtotal - paid > 0 ? "text-danger" : "",
                    ],
                  ] as const
                ).map(([key, value, tone]) => (
                  <div
                    key={key}
                    className="rounded-lg border border-border bg-surface p-4 shadow-subtle"
                  >
                    <p className="text-xs font-medium text-muted-foreground">{t(key)}</p>
                    <p className={`numeric mt-1 text-xl font-semibold ${tone}`}>
                      {formatMXN(value)}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* --------------------------------------- payments applied here */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">{t("receipts.paymentsApplied")}</h2>
              {(payments.data?.length ?? 0) === 0 ? (
                <EmptyState
                  message={t("receipts.noPayments")}
                  description={t("receipts.noPaymentsDescription")}
                />
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                  {payments.data?.map((allocation) => {
                    const payment = allocation.payments as unknown as {
                      paid_at: string;
                      method: Enums<"payment_method">;
                      reference: string | null;
                      status: Enums<"payment_status">;
                    } | null;
                    return (
                      <li
                        key={allocation.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {payment ? formatMexicoDate(payment.paid_at) : "—"} ·{" "}
                            {payment ? t(`paymentMethod.${payment.method}`) : "—"}
                          </p>
                          <p className="numeric truncate text-xs text-muted-foreground">
                            {payment?.reference ?? "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {payment ? <PaymentStatusBadge value={payment.status} /> : null}
                          <MoneyText value={Number(allocation.amount)} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* --------------------------------------------------- add line */}
            <FormDialog
              open={lineOpen}
              onOpenChange={(next) => {
                setLineOpen(next);
                if (!next) setError(null);
              }}
              title={t("receipts.addLine")}
              error={error}
              pending={addLine.isPending}
              onSubmit={() => {
                setError(null);
                if (!line.description.trim())
                  return setError(t("receipts.errors.descriptionRequired"));
                if (line.amount === "") return setError(t("receipts.errors.amountRequired"));
                addLine.mutate(line);
              }}
            >
              <Field label={t("receipts.line.description")} htmlFor="line-description">
                <Input
                  id="line-description"
                  value={line.description}
                  onChange={(event) => setLine({ ...line, description: event.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("receipts.line.category")}>
                  <Select
                    value={line.category}
                    onValueChange={(value) =>
                      setLine({ ...line, category: value as Enums<"line_category"> })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LINE_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {t(`lineCategory.${category}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("receipts.line.quantity")} htmlFor="line-quantity">
                  <Input
                    id="line-quantity"
                    inputMode="numeric"
                    className="numeric"
                    value={line.quantity}
                    onChange={(event) =>
                      setLine({ ...line, quantity: event.target.value.replace(/\D/g, "") })
                    }
                  />
                </Field>
              </div>
              <Field label={t("receipts.line.amount")}>
                <MoneyInput
                  value={line.amount}
                  onChange={(value) => setLine({ ...line, amount: value })}
                />
              </Field>
            </FormDialog>

            {/* ------------------------------------------- cancel (admin) */}
            <FormDialog
              open={cancelOpen}
              onOpenChange={(next) => {
                setCancelOpen(next);
                if (!next) setError(null);
              }}
              title={t("receipts.cancelTitle", { folio: head.invoice_number ?? "" })}
              description={t("receipts.cancelDescription")}
              error={error}
              pending={cancel.isPending}
              submitLabel={t("receipts.cancel")}
              onSubmit={() => {
                setError(null);
                if (!cancelReason.trim()) return setError(t("receipts.errors.reasonRequired"));
                cancel.mutate(cancelReason.trim());
              }}
            >
              <Field label={t("receipts.cancelReason")} htmlFor="cancel-reason">
                <Textarea
                  id="cancel-reason"
                  rows={3}
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                />
              </Field>
            </FormDialog>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
