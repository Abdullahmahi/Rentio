/**
 * Server-only. Autopay (issue #10): charge the saved method of every enrolled
 * lease whose invoice is due today, on the company's connected account.
 *
 * Idempotent twice over: autopay_due skips invoices with a run row, and the
 * Stripe idempotency key is (invoice, due date), so a crash between the
 * charge and the insert cannot charge again. Success is booked by the
 * webhook (payment_intent.succeeded -> record_online_payment); this records
 * the attempt and, when Stripe refuses, why.
 *
 * TODO(nightly lane): the nightly job should call runAutopay(orgId, { stripe,
 * db }) once per active organization after invoicing. Not wired here.
 */
import type Stripe from "stripe";
import type { Db } from "@/lib/server/session";
import { computeCharge, intentMetadata, type OnlineMethod } from "@/lib/server/stripe-payments";

export interface AutopayResult {
  created: number;
  failed: number;
  skipped?: string;
}

export async function runAutopay(
  orgId: string,
  { stripe, db }: { stripe: Stripe; db: Db },
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
  for (const row of due ?? []) {
    const method: OnlineMethod = row.method_type === "ach" ? "ach" : "card";
    const charge = computeCharge(Number(row.balance), method, account);
    const run = {
      org_id: orgId,
      enrollment_id: row.enrollment_id,
      invoice_id: row.invoice_id,
      run_on: row.due_date,
    };
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
          metadata: intentMetadata({
            orgId,
            leaseId: row.lease_id,
            tenantId: row.tenant_id,
            invoiceIds: [row.invoice_id],
            charge,
            method,
            autopay: true,
          }),
        },
        {
          stripeAccount: account.stripe_account_id,
          idempotencyKey: `autopay:${row.invoice_id}:${row.due_date}`,
        },
      );
      const ok = intent.status === "succeeded" || intent.status === "processing";
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
      const { error } = await db.from("autopay_runs").insert({
        ...run,
        status: "failed",
        payment_intent_id: stripeError.payment_intent?.id ?? null,
        error: String(stripeError.message ?? caught).slice(0, 500),
      });
      // A failure we cannot even record must surface, or it repeats daily.
      if (error) throw error;
      failed += 1;
    }
  }
  return { created, failed };
}
