/**
 * Server-only. Autopay (issue #10): charge the saved method of every enrolled
 * lease whose invoice is due today, on the company's connected account.
 *
 * Idempotent twice over: autopay_due skips invoices with a run row, and the
 * Stripe idempotency key is (invoice, run date), so a crash between the
 * charge and the insert cannot charge again. Success is booked by the
 * webhook (payment_intent.succeeded -> record_online_payment); this records
 * the attempt and, when Stripe refuses, why.
 *
 * Never a second debit (security review on #72): autopay_due skips leases
 * with a payment already moving, the enrolled tenant must still be on an
 * active lease, and each charge takes the lease's payment-attempt slot
 * (stripe_payment_attempts) so Pay now sees it too. A timeout or unknown
 * Stripe error is recorded as 'unknown' (check Stripe), not 'failed': the
 * tenant is not told to pay by hand for a charge that may have gone through.
 *
 * TODO(nightly lane): the nightly job should call runAutopay(orgId, { stripe,
 * db }) once per active organization after invoicing. Not wired here.
 */
import type Stripe from "stripe";
import type { Db } from "@/lib/server/session";
import {
  computeCharge,
  intentMetadata,
  invoiceKey,
  type OnlineMethod,
} from "@/lib/server/stripe-payments";

export interface AutopayResult {
  created: number;
  failed: number;
  unknown?: number;
  skipped?: string;
}

/** Stripe answered and said no: nothing was charged. Anything else may have charged. */
const definiteRefusal = (caught: unknown) => {
  const type = (caught as { type?: string }).type;
  return type === "StripeCardError" || type === "StripeInvalidRequestError";
};

export async function runAutopay(
  orgId: string,
  { stripe, db }: { stripe: Pick<Stripe, "paymentIntents">; db: Db },
): Promise<AutopayResult> {
  const { data: account, error: accountError } = await db
    .from("stripe_accounts")
    .select("stripe_account_id, charges_enabled, card_fee_enabled, card_fee_percent")
    .eq("org_id", orgId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account?.stripe_account_id || !account.charges_enabled)
    return { created: 0, failed: 0, skipped: "stripe not ready" };

  const { data: due, error: dueError } = await db.rpc("autopay_due", { p_org: orgId });
  if (dueError) throw dueError;

  let created = 0;
  let failed = 0;
  let unknown = 0;
  for (const row of due ?? []) {
    const method: OnlineMethod = row.method_type === "ach" ? "ach" : "card";
    const charge = computeCharge(Number(row.balance), method, account);
    const run = {
      org_id: orgId,
      enrollment_id: row.enrollment_id,
      invoice_id: row.invoice_id,
      run_on: row.due_date,
    };

    // Take the attempt slot first: a Pay now that slipped in since
    // autopay_due holds it, and then autopay leaves this invoice alone.
    const { data: attempt, error: attemptError } = await db
      .from("stripe_payment_attempts")
      .insert({
        org_id: orgId,
        lease_id: row.lease_id,
        tenant_id: row.tenant_id,
        invoice_key: invoiceKey([row.invoice_id]),
        stripe_account_id: account.stripe_account_id,
        method,
        amount_cents: charge.totalCents,
        autopay: true,
      })
      .select("id")
      .maybeSingle();
    if (attemptError?.code === "23505") continue;
    if (attemptError) throw attemptError;

    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: charge.totalCents,
          currency: "usd",
          customer: row.stripe_customer_id,
          payment_method: row.payment_method_id,
          off_session: true,
          confirm: true,
          // A card that now wants 3DS cannot be authenticated with nobody
          // there: fail it so the tenant pays by hand.
          error_on_requires_action: true,
          metadata: {
            ...intentMetadata({
              orgId,
              leaseId: row.lease_id,
              tenantId: row.tenant_id,
              invoiceIds: [row.invoice_id],
              charge,
              method,
              autopay: true,
            }),
            attempt_id: attempt!.id,
          },
        },
        {
          stripeAccount: account.stripe_account_id,
          // per (invoice, run date): a retry of the same run is the same charge
          idempotencyKey: `autopay:${row.invoice_id}:${row.due_date}`,
        },
      );
      const ok = intent.status === "succeeded" || intent.status === "processing";
      await db
        .from("stripe_payment_attempts")
        .update({ payment_intent_id: intent.id, status: ok ? intent.status : "canceled" })
        .eq("id", attempt!.id);
      const { error } = await db.from("autopay_runs").insert({
        ...run,
        status: ok ? "created" : "failed",
        payment_intent_id: intent.id,
        error: ok ? null : `Stripe status: ${intent.status}`,
      });
      if (error) throw error;
      if (ok) created += 1;
      else failed += 1;
    } catch (caught) {
      const stripeError = caught as { message?: string; payment_intent?: { id?: string } };
      const refused = definiteRefusal(caught);
      // Refused: free the slot. Unknown: keep it open ('creating'), so
      // neither autopay nor Pay now charges this lease again until the
      // webhook (or staff, in Stripe) settles what happened.
      if (refused)
        await db
          .from("stripe_payment_attempts")
          .update({
            status: "canceled",
            payment_intent_id: stripeError.payment_intent?.id ?? null,
          })
          .eq("id", attempt!.id);
      const message = String(stripeError.message ?? caught);
      const { error } = await db.from("autopay_runs").insert({
        ...run,
        status: refused ? "failed" : "unknown",
        payment_intent_id: stripeError.payment_intent?.id ?? null,
        error: (refused ? message : `unknown – check Stripe: ${message}`).slice(0, 500),
      });
      // A failure we cannot even record must surface, or it repeats daily.
      if (error) throw error;
      if (refused) failed += 1;
      else unknown += 1;
    }
  }
  return { created, failed, ...(unknown ? { unknown } : {}) };
}
