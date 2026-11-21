/**
 * Server-only. The money side of Pay now (issue #9): how much a tenant is
 * charged, and what a Stripe webhook event does to our books.
 *
 * Direct charges on the company's connected account. The PaymentIntent
 * carries the rent and (optionally) a card fee; only the rent is recorded as
 * a payment, through record_online_payment, the same allocation path staff
 * confirmations use.
 */
import type Stripe from "stripe";
import type { Db } from "@/lib/server/session";
import { accountRow } from "@/lib/server/stripe";

export type OnlineMethod = "card" | "ach";

export interface FeeSetting {
  card_fee_enabled: boolean;
  card_fee_percent: number | string;
}

/** Cents the tenant is charged, split into rent and the optional card fee. */
export function computeCharge(rent: number, method: OnlineMethod, account: FeeSetting) {
  const rentCents = Math.round(rent * 100);
  const percent =
    method === "card" && account.card_fee_enabled ? Number(account.card_fee_percent) : 0;
  const feeCents = percent > 0 ? Math.round((rentCents * percent) / 100) : 0;
  return { rentCents, feeCents, totalCents: rentCents + feeCents, feePercent: percent };
}

/** What a PaymentIntent we created says about itself. All values are strings (Stripe). */
export interface IntentMetadata {
  [key: string]: string;
  org_id: string;
  lease_id: string;
  tenant_id: string;
  invoice_ids: string;
  rent_amount: string;
  fee_amount: string;
  method: OnlineMethod;
  autopay?: "1";
}

export function intentMetadata(input: {
  orgId: string;
  leaseId: string;
  tenantId: string;
  invoiceIds: string[];
  charge: ReturnType<typeof computeCharge>;
  method: OnlineMethod;
  autopay?: boolean;
}): IntentMetadata {
  return {
    org_id: input.orgId,
    lease_id: input.leaseId,
    tenant_id: input.tenantId,
    // Stripe caps a metadata value at 500 chars; the ids are informational
    // (allocation is oldest-first regardless), so a long list is cut.
    invoice_ids: input.invoiceIds.slice(0, 12).join(","),
    rent_amount: (input.charge.rentCents / 100).toFixed(2),
    fee_amount: (input.charge.feeCents / 100).toFixed(2),
    method: input.method,
    ...(input.autopay ? { autopay: "1" as const } : {}),
  };
}

export type WebhookOutcome =
  { ignored: string } | { duplicate: true } | { processed: string; payment_id?: string };

/**
 * One Connect event. The Stripe account on the event decides the org; the
 * event id is written first so a redelivery is a no-op; then
 * payment_intent.succeeded books the rent and account.updated refreshes
 * the connection status. Everything else (processing, failed, refunds,
 * disputes) is only logged: refunds and disputes live in the company's own
 * Stripe dashboard (PRD).
 */
export async function handleStripeEvent(event: Stripe.Event, db: Db): Promise<WebhookOutcome> {
  if (!event.account) return { ignored: "no connected account on event" };

  const { data: owner, error: ownerError } = await db
    .from("stripe_accounts")
    .select("org_id")
    .eq("stripe_account_id", event.account)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) return { ignored: "unknown connected account" };
  const orgId = owner.org_id;

  const { error: insertError } = await db
    .from("stripe_events")
    .insert({ event_id: event.id, org_id: orgId, type: event.type });
  if (insertError) {
    if (insertError.code !== "23505") throw insertError;
    // Seen before. Only a PROCESSED event is a true duplicate: if the first
    // delivery threw after the insert (our 500 made Stripe retry), the row
    // exists with processed_at null and the work still has to happen.
    // record_online_payment is idempotent on the intent, so reprocessing is safe.
    const { data: seen, error: seenError } = await db
      .from("stripe_events")
      .select("processed_at")
      .eq("event_id", event.id)
      .maybeSingle();
    if (seenError) throw seenError;
    if (seen?.processed_at) return { duplicate: true };
  }

  let paymentId: string | undefined;
  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const meta = intent.metadata as Partial<IntentMetadata>;
    const rent = Number(meta.rent_amount);
    // The org in the metadata must agree with the account the event came
    // from, and the rent must be covered by what was actually received.
    if (meta.org_id !== orgId || !meta.lease_id)
      return finish(db, event.id, { ignored: "metadata does not match the account's org" });
    if (!(rent > 0) || intent.amount_received < Math.round(rent * 100))
      return finish(db, event.id, { ignored: "rent amount missing or not covered" });

    const fee = Number(meta.fee_amount ?? 0);
    const charge =
      typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
    const { data, error } = await db.rpc("record_online_payment", {
      p_org: orgId,
      p_lease: meta.lease_id,
      p_amount: rent,
      p_method: chargedMethod(intent, meta),
      p_payment_intent: intent.id,
      p_charge: charge ?? null,
      p_reference: charge ?? intent.id,
      p_notes: fee > 0 ? `Card fee ${fee.toFixed(2)} charged with this payment (not rent).` : null,
    });
    if (error) throw error;
    paymentId = data.payment_id;
  } else if (event.type === "account.updated") {
    const account = event.data.object;
    const { error } = await db
      .from("stripe_accounts")
      .update(accountRow(account))
      .eq("org_id", orgId)
      .eq("stripe_account_id", account.id);
    if (error) throw error;
  }

  return finish(db, event.id, {
    processed: event.type,
    ...(paymentId ? { payment_id: paymentId } : {}),
  });
}

/**
 * ach or card from what Stripe actually charged: the charge's payment method
 * details when the event carries them, else the intent's payment method
 * type(s) (set server-side to exactly one), and only then our metadata.
 */
export function chargedMethod(
  intent: Pick<Stripe.PaymentIntent, "latest_charge" | "payment_method_types" | "payment_method">,
  meta: Partial<IntentMetadata>,
): OnlineMethod {
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const pm = typeof intent.payment_method === "object" ? intent.payment_method : null;
  const type =
    charge?.payment_method_details?.type ??
    (pm && "type" in pm ? pm.type : undefined) ??
    (intent.payment_method_types?.length === 1 ? intent.payment_method_types[0] : undefined) ??
    (meta.method === "ach" ? "us_bank_account" : "card");
  return type === "us_bank_account" ? "ach" : "card";
}

async function finish<T extends WebhookOutcome>(db: Db, eventId: string, outcome: T) {
  await db
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("event_id", eventId);
  return outcome;
}
