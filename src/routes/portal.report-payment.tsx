import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { formatMXN } from "@/lib/format";
import { useMyPortal, useToastMutation } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/storage";
import type { Enums } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/portal/report-payment")({
  head: () => ({ meta: [{ title: `${i18n.t("portal.reportPayment")} — Rentio` }] }),
  component: ReportPaymentPage,
});

const METHODS: Enums<"payment_method">[] = ["spei", "efectivo", "deposito", "oxxo", "cheque"];
const todayIso = () => new Date().toISOString().slice(0, 10);

function ReportPaymentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portal = useMyPortal();

  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [form, setForm] = useState({
    amount: "" as number | "",
    paid_at: todayIso(),
    method: "spei" as Enums<"payment_method">,
    reference: "",
    notes: "",
    receipt: null as File | null,
  });

  const balance = Number(portal.data?.balance?.balance ?? 0);
  // Pre-fill with what is actually owed, once, without fighting the user.
  if (!touched && form.amount === "" && balance > 0) {
    setTouched(true);
    setForm((current) => ({ ...current, amount: balance }));
  }

  const submit = useToastMutation({
    mutationFn: async () => {
      const lease = portal.data?.lease;
      if (!lease) throw new Error("no-lease");

      // RLS allows exactly this shape from a tenant: pendiente + reported_by_tenant.
      const { data: payment, error: caught } = await supabase
        .from("payments")
        .insert({
          lease_id: lease.id,
          amount: form.amount === "" ? 0 : form.amount,
          paid_at: form.paid_at,
          method: form.method,
          reference: form.reference.trim() || null,
          notes: form.notes.trim() || null,
          status: "pendiente",
          reported_by_tenant: true,
        })
        .select("id")
        .single();
      if (caught) throw caught;

      if (form.receipt) {
        const path = await uploadFile("payment-receipts", lease.id, form.receipt);
        await supabase.from("payments").update({ receipt_url: path }).eq("id", payment.id);
      }
    },
    successKey: "portal.reportSent",
    invalidate: [["my-portal"]],
    onSuccess: () => setDone(true),
  });

  if (done) {
    return (
      <div className="space-y-5">
        <section className="rounded-lg border border-success/25 bg-success/5 p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-success" />
          <h1 className="mt-3 text-xl font-semibold">{t("portal.reportReceivedTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("portal.reportReceivedBody")}</p>
          <Button className="mt-5 h-12 w-full" onClick={() => void navigate({ to: "/portal" })}>
            {t("portal.backHome")}
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("portal.reportPayment")} description={t("portal.reportPaymentHint")} />

      <QueryState
        isLoading={portal.isLoading}
        error={portal.error}
        onRetry={() => void portal.refetch()}
        skeleton={<RowsSkeleton count={4} />}
      >
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (form.amount === "" || Number(form.amount) <= 0)
              return setError(t("payments.errors.amountRequired"));
            if (!form.paid_at) return setError(t("portal.errors.dateRequired"));
            submit.mutate(undefined);
          }}
        >
          <Field
            label={t("payments.columns.amount")}
            hint={balance > 0 ? t("portal.balanceHint", { amount: formatMXN(balance) }) : undefined}
          >
            <MoneyInput
              value={form.amount}
              onChange={(value) => setForm({ ...form, amount: value })}
            />
          </Field>

          <Field label={t("portal.paidOn")} htmlFor="report-date">
            <Input
              id="report-date"
              type="date"
              className="numeric h-12"
              value={form.paid_at}
              onChange={(event) => setForm({ ...form, paid_at: event.target.value })}
            />
          </Field>

          {/* Large tap targets beat a dropdown on a phone. */}
          <Field label={t("payments.columns.method")}>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setForm({ ...form, method })}
                  aria-pressed={form.method === method}
                  className={`h-12 rounded-lg border px-3 text-sm font-medium ${
                    form.method === method
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface text-foreground hover:bg-muted"
                  }`}
                >
                  {t(`paymentMethod.${method}`)}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label={t("payments.columns.reference")}
            htmlFor="report-reference"
            hint={t("portal.referenceHint")}
          >
            <Input
              id="report-reference"
              className="numeric h-12"
              value={form.reference}
              onChange={(event) => setForm({ ...form, reference: event.target.value })}
            />
          </Field>

          {/* capture="environment" opens the phone camera directly. */}
          <Field
            label={t("portal.receiptPhoto")}
            htmlFor="report-receipt"
            hint={t("portal.receiptPhotoHint")}
          >
            <label
              htmlFor="report-receipt"
              className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface text-sm text-muted-foreground"
            >
              <Camera className="size-6" />
              {form.receipt ? form.receipt.name : t("portal.takePhoto")}
            </label>
            <input
              id="report-receipt"
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => setForm({ ...form, receipt: event.target.files?.[0] ?? null })}
            />
          </Field>

          <Field label={t("tenants.fields.notes")} htmlFor="report-notes">
            <Textarea
              id="report-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" className="h-12 w-full text-base" disabled={submit.isPending}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : null}
            {t("portal.sendReport")}
          </Button>
        </form>
      </QueryState>
    </div>
  );
}
