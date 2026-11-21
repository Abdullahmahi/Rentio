import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { useMyPortal, useToastMutation } from "@/lib/queries";
import {
  AUTOPAY_KEY,
  canPayOnline,
  stripePost,
  useAutopayEnrollment,
  useStripeAccount,
} from "@/lib/stripe";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/portal/autopay")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("stripe.autopay.title")) }] }),
  component: AutopayPage,
});

interface Setup {
  clientSecret: string;
  publishableKey: string;
  stripeAccount: string;
}

/**
 * Autopay (issue #10). The tenant saves a card or bank account through a
 * SetupIntent on the company's connected account, then the server records
 * the enrollment. On/off is the tenant's own column; failed charges show
 * here with Stripe's reason.
 */
function AutopayPage() {
  const { t } = useTranslation();
  const portal = useMyPortal();
  const info = useStripeAccount();
  const enrollment = useAutopayEnrollment();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [done, setDone] = useState(false);

  const lease = portal.data?.lease ?? null;
  const row = enrollment.data ?? null;
  const available = canPayOnline(info.data);

  const failures = useQuery({
    queryKey: ["autopay-runs", row?.id ?? null],
    enabled: Boolean(row),
    queryFn: async () => {
      const { data, error } = await db
        .from("autopay_runs")
        .select("id, run_on, status, error")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data;
    },
  });

  const start = useMutation({
    mutationFn: () => stripePost<Setup>("portal/setup-intent"),
    onSuccess: setSetup,
  });
  const enroll = useToastMutation({
    mutationFn: (setupIntentId: string) =>
      stripePost("portal/autopay-enroll", { lease_id: lease?.id, setup_intent_id: setupIntentId }),
    successKey: "stripe.autopay.enrolled",
    invalidate: [AUTOPAY_KEY],
    onSuccess: () => {
      setSetup(null);
      setDone(true);
    },
  });
  const toggle = useToastMutation({
    mutationFn: async (enabled: boolean) => {
      if (!row) throw new Error("no-enrollment");
      const { error } = await db.from("autopay_enrollments").update({ enabled }).eq("id", row.id);
      if (error) throw error;
    },
    successKey: "stripe.autopay.saved",
    invalidate: [AUTOPAY_KEY],
  });

  const stripePromise = useMemo(
    () => (setup ? loadStripe(setup.publishableKey, { stripeAccount: setup.stripeAccount }) : null),
    [setup],
  );

  return (
    <div className="space-y-5">
      <PageHeader title={t("stripe.autopay.title")} description={t("stripe.autopay.hint")} />
      <QueryState
        isLoading={portal.isLoading || info.isLoading || enrollment.isLoading}
        error={portal.error ?? info.error ?? enrollment.error}
        onRetry={() => void enrollment.refetch()}
        skeleton={<RowsSkeleton count={3} />}
      >
        {!available || !lease ? (
          <p className="rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-sm text-info">
            {t("stripe.pay.notReady")}
          </p>
        ) : setup && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: setup.clientSecret,
              locale: i18n.language === "en" ? "en" : "es",
              appearance: { theme: "stripe", variables: { borderRadius: "0.625rem" } },
            }}
          >
            <SetupForm
              pending={enroll.isPending}
              onCancel={() => setSetup(null)}
              onDone={(id) => enroll.mutate(id)}
            />
          </Elements>
        ) : (
          <>
            <section className="rounded-lg border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t("stripe.autopay.statusLabel")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row?.method_label ?? t("stripe.autopay.noMethod")}
                  </p>
                </div>
                <StatusBadge
                  status={t(row?.enabled ? "stripe.autopay.on" : "stripe.autopay.off")}
                  variant={row?.enabled ? "success" : "neutral"}
                />
              </div>
              {done ? (
                <p className="mt-3 inline-flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="size-4" />
                  {t("stripe.autopay.enrolled")}
                </p>
              ) : null}
              <p className="mt-3 text-sm text-muted-foreground">{t("stripe.autopay.howItWorks")}</p>
              <div className="mt-4 space-y-2">
                {row ? (
                  <Button
                    className="h-12 w-full text-base"
                    variant={row.enabled ? "outline" : "default"}
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(!row.enabled)}
                  >
                    {t(row.enabled ? "stripe.autopay.turnOff" : "stripe.autopay.turnOn")}
                  </Button>
                ) : null}
                <Button
                  className="h-12 w-full text-base"
                  variant={row ? "ghost" : "default"}
                  disabled={start.isPending}
                  onClick={() => start.mutate()}
                >
                  {start.isPending ? <Loader2 className="animate-spin" /> : null}
                  {t(row ? "stripe.autopay.changeMethod" : "stripe.autopay.setUp")}
                </Button>
                {start.error ? (
                  <p role="alert" className="text-sm text-danger">
                    {t("stripe.pay.failed")}
                  </p>
                ) : null}
              </div>
            </section>

            {failures.data?.length ? (
              <section className="rounded-lg border border-danger/25 bg-danger/5 p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-danger">
                  <RefreshCw className="size-4" aria-hidden />
                  {t("stripe.autopay.failedTitle")}
                </h2>
                <ul className="mt-2 space-y-2 text-sm">
                  {failures.data.map((run) => (
                    <li key={run.id}>
                      <span className="numeric font-medium">{formatDate(run.run_on)}</span>
                      <span className="text-muted-foreground"> — {run.error}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("stripe.autopay.failedHint")}
                </p>
                <Button asChild variant="outline" className="mt-3 h-11 w-full">
                  <Link to="/portal/pay">{t("stripe.pay.title")}</Link>
                </Button>
              </section>
            ) : null}
          </>
        )}
      </QueryState>
    </div>
  );
}

function SetupForm({
  pending,
  onCancel,
  onDone,
}: {
  pending: boolean;
  onCancel: () => void;
  onDone: (setupIntentId: string) => void;
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
    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/portal/autopay` },
    });
    setBusy(false);
    if (result.error) return setError(result.error.message ?? t("stripe.pay.failed"));
    onDone(result.setupIntent.id);
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
      <Button type="submit" className="h-12 w-full text-base" disabled={busy || pending || !stripe}>
        {busy || pending ? <Loader2 className="animate-spin" /> : null}
        {t("stripe.autopay.saveMethod")}
      </Button>
      <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
        {t("actions.cancel")}
      </Button>
    </form>
  );
}
