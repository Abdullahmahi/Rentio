import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CheckCircle2, Clock, CreditCard, Landmark, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { formatMoney } from "@/lib/format";
import { useMyPortal } from "@/lib/queries";
import { canPayOnline, stripePost, useStripeAccount } from "@/lib/stripe";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/portal/pay")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("stripe.pay.title")) }] }),
  component: PayPage,
});

interface Intent {
  clientSecret: string;
  publishableKey: string;
  stripeAccount: string;
  rent: number;
  fee: number;
  total: number;
  feePercent: number;
}

type Method = "card" | "ach";

/**
 * Pay now (issue #9). Two steps on a phone: pick card or bank (the card fee,
 * if any, is settled server-side on that choice), then Stripe's Payment
 * Element on the company's connected account. The webhook records the
 * payment; this page only reports what Stripe said.
 */
function PayPage() {
  const { t } = useTranslation();
  const portal = useMyPortal();
  const info = useStripeAccount();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Method>("card");
  const [save, setSave] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [outcome, setOutcome] = useState<"succeeded" | "processing" | null>(null);

  const balance = Number(portal.data?.balance?.balance ?? 0);
  const available = canPayOnline(info.data);
  const feePercent = info.data?.account?.card_fee_enabled
    ? Number(info.data.account.card_fee_percent)
    : 0;

  const start = useMutation({
    mutationFn: () =>
      stripePost<Intent>("portal/payment-intent", {
        lease_id: portal.data?.lease?.id,
        method,
        save_method: save,
      }),
    onSuccess: setIntent,
  });

  const stripePromise = useMemo(
    () =>
      intent ? loadStripe(intent.publishableKey, { stripeAccount: intent.stripeAccount }) : null,
    [intent],
  );

  const finish = (status: "succeeded" | "processing") => {
    setOutcome(status);
    // The webhook books it a moment later; refetch when the tenant goes home.
    void queryClient.invalidateQueries({ queryKey: ["my-portal"] });
  };

  if (outcome) {
    const processing = outcome === "processing";
    return (
      <section className="rounded-lg border border-success/25 bg-success/5 p-6 text-center">
        {processing ? (
          <Clock className="mx-auto size-10 text-warning" />
        ) : (
          <CheckCircle2 className="mx-auto size-10 text-success" />
        )}
        <h1 className="mt-3 text-xl font-semibold">
          {t(processing ? "stripe.pay.processingTitle" : "stripe.pay.successTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(processing ? "stripe.pay.processingBody" : "stripe.pay.successBody")}
        </p>
        <Button asChild className="mt-5 h-12 w-full">
          <Link to="/portal">{t("portal.backHome")}</Link>
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("stripe.pay.title")} description={t("stripe.pay.hint")} />
      <QueryState
        isLoading={portal.isLoading || info.isLoading}
        error={portal.error ?? info.error}
        onRetry={() => void portal.refetch()}
        skeleton={<RowsSkeleton count={4} />}
      >
        {!available ? (
          <Notice>{t("stripe.pay.notReady")}</Notice>
        ) : balance <= 0.005 ? (
          <Notice>{t("stripe.pay.nothingDue")}</Notice>
        ) : intent && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: intent.clientSecret,
              locale: i18n.language === "en" ? "en" : "es",
              appearance: { theme: "stripe", variables: { borderRadius: "0.625rem" } },
            }}
          >
            <Summary intent={intent} />
            <CheckoutForm total={intent.total} onDone={finish} />
          </Elements>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              start.mutate();
            }}
          >
            <section className="rounded-lg border border-border bg-surface p-5">
              <p className="text-sm text-muted-foreground">{t("stripe.pay.amount")}</p>
              <p className="numeric mt-1 text-3xl font-semibold">{formatMoney(balance)}</p>
            </section>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("stripe.pay.chooseMethod")}</legend>
              {(
                [
                  ["card", CreditCard, "stripe.pay.card", "stripe.pay.cardHint"],
                  ["ach", Landmark, "stripe.pay.bank", "stripe.pay.bankHint"],
                ] as const
              ).map(([value, Icon, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMethod(value)}
                  aria-pressed={method === value}
                  className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left ${
                    method === value
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border bg-surface hover:bg-muted"
                  }`}
                >
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t(label)}</span>
                    <span className="block text-xs text-muted-foreground">{t(hint)}</span>
                  </span>
                </button>
              ))}
            </fieldset>

            {method === "card" && feePercent > 0 ? (
              <Notice>
                {t("stripe.pay.feeNotice", {
                  percent: feePercent,
                  fee: formatMoney(Math.round(balance * feePercent) / 100),
                })}
              </Notice>
            ) : null}

            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={save} onCheckedChange={(next) => setSave(next === true)} />
              {t("stripe.pay.saveMethod")}
            </label>

            {start.error ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {start.error.message === "payment_in_progress"
                  ? t("stripe.pay.inProgress")
                  : t("stripe.pay.failed")}
              </p>
            ) : null}

            <Button type="submit" className="h-12 w-full text-base" disabled={start.isPending}>
              {start.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("stripe.pay.continue")}
            </Button>
          </form>
        )}
      </QueryState>
    </div>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <p className="rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-sm text-info">
      {children}
    </p>
  );
}

function Summary({ intent }: { intent: Intent }) {
  const { t } = useTranslation();
  return (
    <dl className="mb-4 rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">{t("stripe.pay.amount")}</dt>
        <dd className="numeric">{formatMoney(intent.rent)}</dd>
      </div>
      {intent.fee > 0 ? (
        <div className="mt-1 flex justify-between">
          <dt className="text-muted-foreground">
            {t("stripe.pay.feeLine", { percent: intent.feePercent })}
          </dt>
          <dd className="numeric">{formatMoney(intent.fee)}</dd>
        </div>
      ) : null}
      <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
        <dt>{t("stripe.pay.total")}</dt>
        <dd className="numeric">{formatMoney(intent.total)}</dd>
      </div>
    </dl>
  );
}

function CheckoutForm({
  total,
  onDone,
}: {
  total: number;
  onDone: (status: "succeeded" | "processing") => void;
}) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/portal` },
    });
    setBusy(false);
    if (result.error) return setError(result.error.message ?? t("stripe.pay.failed"));
    onDone(result.paymentIntent.status === "processing" ? "processing" : "succeeded");
  };

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      <Button type="submit" className="h-12 w-full text-base" disabled={busy || !stripe}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        {t("stripe.pay.payButton", { amount: formatMoney(total) })}
      </Button>
    </form>
  );
}
