import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/rentio/confirm-dialog";
import { Field } from "@/components/rentio/form-dialog";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { logActivity, useActorId, useToastMutation } from "@/lib/queries";
import { STRIPE_ACCOUNT_KEY, stripePost, useStripeAccount } from "@/lib/stripe";

const BADGE = { not_connected: "neutral", pending: "warning", ready: "success" } as const;

/**
 * Settings → "Connect Stripe". Connect and Disconnect are admin-only (the
 * money destination is the admin's call); managers see status and the fee.
 * Renders nothing when the platform has
 * no Stripe keys, so a company that never asked for online rent never sees
 * it. The fee toggle writes stripe_accounts directly (staff column grant);
 * everything about the account itself goes through /api/stripe/*.
 */
export function StripeConnectCard() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const actorId = useActorId();
  const queryClient = useQueryClient();
  const info = useStripeAccount();
  const account = info.data?.account ?? null;
  const status = account?.status ?? "not_connected";
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const [fee, setFee] = useState({ enabled: false, percent: "0" });
  useEffect(() => {
    if (account)
      setFee({ enabled: account.card_fee_enabled, percent: String(account.card_fee_percent) });
  }, [account]);

  const connect = useToastMutation({
    mutationFn: async () => {
      const { url } = await stripePost<{ url: string }>("connect");
      window.location.assign(url);
    },
    successKey: "stripe.redirecting",
  });
  const refresh = useToastMutation({
    mutationFn: () => stripePost("refresh"),
    successKey: "stripe.refreshed",
    invalidate: [STRIPE_ACCOUNT_KEY],
  });
  const disconnect = useToastMutation({
    mutationFn: () => stripePost("disconnect"),
    successKey: "stripe.disconnected",
    invalidate: [STRIPE_ACCOUNT_KEY],
  });
  // Issue #10: charge today's enrolled invoices by hand until the nightly
  // job calls runAutopay; the last failures, so staff can call the tenant.
  const runAutopay = useToastMutation({
    mutationFn: () => stripePost<{ created: number; failed: number }>("autopay-run"),
    successKey: "stripe.autopay.saved",
    pendingKey: "stripe.autopay.running",
    resultMessage: (result) => t("stripe.autopay.runResult", result),
    invalidate: [["autopay-runs-failed"]],
  });
  const failedRuns = useQuery({
    queryKey: ["autopay-runs-failed"],
    enabled: Boolean(account?.stripe_account_id),
    queryFn: async () => {
      const { error, data } = await db
        .from("autopay_runs")
        .select("id, run_on, error")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });
  const saveFee = useToastMutation({
    mutationFn: async () => {
      if (!profile?.org_id) throw new Error("no-org");
      const percent = Math.min(4, Math.max(0, Number(fee.percent) || 0));
      const { error } = await db
        .from("stripe_accounts")
        .update({ card_fee_enabled: fee.enabled, card_fee_percent: percent })
        .eq("org_id", profile.org_id);
      if (error) throw error;
      await logActivity(actorId, "stripe_account", null, "card_fee", {
        enabled: fee.enabled,
        percent,
      });
    },
    successKey: "stripe.cardFee.saved",
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: STRIPE_ACCOUNT_KEY }),
  });

  if (info.data && !info.data.configured) return null;

  return (
    <section className="mt-4 max-w-2xl space-y-4 rounded-lg border border-border bg-surface p-5 shadow-subtle">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="size-4 text-muted-foreground" aria-hidden />
            {t("stripe.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("stripe.description")}</p>
        </div>
        <StatusBadge status={t(`stripe.status.${status}`)} variant={BADGE[status]} />
      </div>

      <QueryState
        isLoading={info.isLoading}
        error={info.error}
        onRetry={() => void info.refetch()}
        skeleton={<RowsSkeleton count={2} />}
      >
        {status === "not_connected" && !isAdmin ? (
          <p className="text-sm text-muted-foreground">{t("stripe.adminOnly")}</p>
        ) : status === "not_connected" ? (
          <Button
            type="button"
            disabled={connect.isPending}
            onClick={() => connect.mutate(undefined)}
          >
            {t("stripe.connect")}
          </Button>
        ) : (
          <div className="space-y-4">
            {status === "pending" ? (
              <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                {t("stripe.pendingHint")}
              </p>
            ) : null}
            <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="text-muted-foreground">{t("stripe.accountId")}</dt>
              <dd className="numeric break-all">{account?.stripe_account_id}</dd>
              <dt className="text-muted-foreground">{t("stripe.payouts")}</dt>
              <dd>{account?.payouts_enabled ? t("stripe.yes") : t("stripe.no")}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate(undefined)}
              >
                <RefreshCw className="size-4" aria-hidden />
                {t("stripe.refresh")}
              </Button>
              {isAdmin ? (
                <ConfirmDialog
                  triggerLabel={t("stripe.disconnect")}
                  title={t("stripe.disconnect")}
                  description={t("stripe.disconnectConfirm")}
                  destructive
                  onConfirm={() => disconnect.mutate(undefined)}
                />
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={runAutopay.isPending || !account?.charges_enabled}
                onClick={() => runAutopay.mutate(undefined)}
              >
                {t("stripe.autopay.runNow")}
              </Button>
            </div>
            {failedRuns.data?.length ? (
              <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-sm">
                <p className="font-medium text-danger">{t("stripe.autopay.staffFailed")}</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {failedRuns.data.map((run) => (
                    <li key={run.id}>
                      <span className="numeric">{formatDate(run.run_on)}</span> — {run.error}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <form
              className="space-y-3 border-t border-border pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveFee.mutate(undefined);
              }}
            >
              <h3 className="text-sm font-semibold">{t("stripe.cardFee.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("stripe.cardFee.hint")}</p>
              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={fee.enabled}
                  onCheckedChange={(enabled) => setFee({ ...fee, enabled })}
                  aria-label={t("stripe.cardFee.label")}
                />
                {t("stripe.cardFee.label")}
              </label>
              {fee.enabled ? (
                <Field label={t("stripe.cardFee.percent")} htmlFor="card-fee-percent">
                  <div className="relative max-w-40">
                    <Input
                      id="card-fee-percent"
                      inputMode="decimal"
                      className="numeric pr-8 text-right"
                      value={fee.percent}
                      onChange={(event) =>
                        setFee({
                          ...fee,
                          percent: event.target.value.replace(/[^\d.]/g, "").slice(0, 4),
                        })
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      %
                    </span>
                  </div>
                </Field>
              ) : null}
              <Button type="submit" variant="outline" disabled={saveFee.isPending}>
                {t("actions.save")}
              </Button>
            </form>
          </div>
        )}
      </QueryState>
    </section>
  );
}
