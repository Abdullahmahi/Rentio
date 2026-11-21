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
import { escapeHtml } from "@/lib/server/email";
import { emailStaff } from "@/lib/server/staff-email";
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

// ------------------------------------------------------- payment attempts
// One OPEN PaymentIntent per tenant + lease + invoice set (security review
// on #71): a second tab, a double click or autopay racing Pay now gets the
// same intent back, or "in progress", never a second charge. The attempt
// row also records the account the intent was created ON, so its webhook
// maps to the org even after a disconnect or reconnect.

/** Open = money may still move. */
export const OPEN_ATTEMPT = [
  "creating",
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
] as const;
const REUSABLE = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

export const invoiceKey = (ids: string[]) => [...ids].sort().join(",");

type IntentApi = Pick<Stripe, "paymentIntents">;

export interface AttemptInput {
  orgId: string;
  leaseId: string;
  tenantId: string;
  stripeAccount: string;
  invoiceIds: string[];
  method: OnlineMethod;
  autopay?: boolean;
  /** What Stripe is asked to create; amount must be the charge total. */
  params: Stripe.PaymentIntentCreateParams & { amount: number };
}

export type AttemptResult =
  { intent: Stripe.PaymentIntent; reused: boolean } | { in_progress: true; status: string };

export async function openPaymentIntent(
  db: Db,
  stripe: IntentApi,
  input: AttemptInput,
): Promise<AttemptResult> {
  const key = invoiceKey(input.invoiceIds);
  for (let round = 0; round < 2; round += 1) {
    const { data: open, error } = await db
      .from("stripe_payment_attempts")
      .select("id, status, payment_intent_id, stripe_account_id, method, amount_cents")
      .eq("org_id", input.orgId)
      .eq("tenant_id", input.tenantId)
      .eq("lease_id", input.leaseId)
      .eq("invoice_key", key)
      .in("status", [...OPEN_ATTEMPT])
      .maybeSingle();
    if (error) throw error;

    if (open?.status === "processing") return { in_progress: true, status: "processing" };

    if (open && !open.payment_intent_id) {
      // Another request is creating it right now (or crashed doing so): the
      // same idempotency key gets the same intent from Stripe, never a second.
      const intent = await createIntent(stripe, open.id, open.stripe_account_id, input);
      return settle(db, open.id, intent, true);
    }

    if (open?.payment_intent_id) {
      const intent = await stripe.paymentIntents.retrieve(open.payment_intent_id, undefined, {
        stripeAccount: open.stripe_account_id,
      });
      const same =
        open.stripe_account_id === input.stripeAccount &&
        open.method === input.method &&
        intent.amount === input.params.amount;
      if (REUSABLE.has(intent.status) && same) return settle(db, open.id, intent, true);
      if (!REUSABLE.has(intent.status)) {
        // processing / succeeded / canceled: record what Stripe says.
        await setStatus(db, open.id, intent.status);
        if (intent.status === "processing" || intent.status === "succeeded")
          return { in_progress: true, status: intent.status };
      } else {
        // Amount or method changed (staff recorded a payment, tenant switched
        // to bank): the old intent must not stay payable next to the new one.
        await stripe.paymentIntents.cancel(open.payment_intent_id, undefined, {
          stripeAccount: open.stripe_account_id,
        });
        await setStatus(db, open.id, "canceled");
      }
    }

    const { data: created, error: insertError } = await db
      .from("stripe_payment_attempts")
      .insert({
        org_id: input.orgId,
        lease_id: input.leaseId,
        tenant_id: input.tenantId,
        invoice_key: key,
        stripe_account_id: input.stripeAccount,
        method: input.method,
        amount_cents: input.params.amount,
        autopay: Boolean(input.autopay),
      })
      .select("id")
      .maybeSingle();
    if (insertError?.code === "23505") continue; // lost the race: reuse the winner's
    if (insertError) throw insertError;
    const intent = await createIntent(stripe, created!.id, input.stripeAccount, input);
    return settle(db, created!.id, intent, false);
  }
  return { in_progress: true, status: "creating" };
}

const createIntent = (
  stripe: IntentApi,
  attemptId: string,
  stripeAccount: string,
  input: AttemptInput,
) =>
  stripe.paymentIntents.create(
    { ...input.params, metadata: { ...input.params.metadata, attempt_id: attemptId } },
    { stripeAccount, idempotencyKey: `rentio-attempt-${attemptId}` },
  );

async function settle(db: Db, attemptId: string, intent: Stripe.PaymentIntent, reused: boolean) {
  const { error } = await db
    .from("stripe_payment_attempts")
    .update({ payment_intent_id: intent.id, status: attemptStatus(intent.status) })
    .eq("id", attemptId);
  if (error) throw error;
  return { intent, reused };
}

const attemptStatus = (status: string) => (status === "requires_capture" ? "processing" : status);

async function setStatus(db: Db, attemptId: string, status: string) {
  const { error } = await db
    .from("stripe_payment_attempts")
    .update({ status: attemptStatus(status) })
    .eq("id", attemptId);
  if (error) throw error;
}

// ---------------------------------------------------------------- webhook

export type WebhookOutcome =
  | { ignored: string }
  | { duplicate: true }
  | { processed: string; payment_id?: string; reversed?: boolean };

/** The PaymentIntent an event is about, for the event types we act on. */
function intentIdOf(event: Stripe.Event): string | null {
  const object = event.data.object as {
    object?: string;
    id?: string;
    payment_intent?: string | { id: string } | null;
  };
  if (object.object === "payment_intent") return object.id ?? null;
  const pi = object.payment_intent;
  return typeof pi === "string" ? pi : (pi?.id ?? null);
}

/** Which org an event belongs to: the attempt (created ON that account) first, else the account now connected. */
async function orgForEvent(db: Db, event: Stripe.Event & { account: string }) {
  const intentId = intentIdOf(event);
  if (intentId) {
    const { data, error } = await db
      .from("stripe_payment_attempts")
      .select("id, org_id, status")
      .eq("payment_intent_id", intentId)
      .eq("stripe_account_id", event.account)
      .maybeSingle();
    if (error) throw error;
    if (data) return { orgId: data.org_id, attempt: data };
  }
  const { data: owner, error } = await db
    .from("stripe_accounts")
    .select("org_id")
    .eq("stripe_account_id", event.account)
    .maybeSingle();
  if (error) throw error;
  return owner ? { orgId: owner.org_id, attempt: null } : null;
}

/**
 * One Connect event. The org comes from the payment attempt (the account
 * the intent was created on) or else the connected account; the event id is
 * written first so a redelivery is a no-op. Then:
 *   payment_intent.succeeded          books the rent
 *   payment_intent.processing/…       keeps the attempt's status current
 *   payment_intent.payment_failed     after processing (ACH failure): reverse
 *   charge.refunded (full)            reverse
 *   charge.dispute.created            reverse
 *   account.updated                   refreshes the connection status
 * Reverse = void the booked payment (invoice balance reopens) and email staff.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  db: Db,
  notify: typeof emailStaff = emailStaff,
): Promise<WebhookOutcome> {
  if (!event.account) return { ignored: "no connected account on event" };
  const owner = await orgForEvent(db, event as Stripe.Event & { account: string });
  if (!owner) return { ignored: "unknown connected account" };
  const { orgId, attempt } = owner;

  const { error: insertError } = await db
    .from("stripe_events")
    .insert({ event_id: event.id, org_id: orgId, type: event.type });
  if (insertError) {
    if (insertError.code !== "23505") throw insertError;
    // Seen before. Only a PROCESSED event is a true duplicate: if the first
    // delivery threw after the insert (our 500 made Stripe retry), the row
    // exists with processed_at null and the work still has to happen.
    // record_online_payment and reverse_online_payment are idempotent on the
    // intent, so reprocessing is safe.
    const { data: seen, error: seenError } = await db
      .from("stripe_events")
      .select("processed_at")
      .eq("event_id", event.id)
      .maybeSingle();
    if (seenError) throw seenError;
    if (seen?.processed_at) return { duplicate: true };
  }

  let paymentId: string | undefined;
  let reversed: boolean | undefined;
  const reverse = async (intentId: string, reason: string, alwaysNotify = false) => {
    const { data, error } = await db.rpc("reverse_online_payment", {
      p_org: orgId,
      p_payment_intent: intentId,
      p_reason: reason,
      p_event: event.id,
    });
    if (error) throw error;
    const result = data as { voided: boolean; payment_id?: string; amount?: number };
    paymentId = result.payment_id;
    reversed = result.voided;
    if (result.voided || alwaysNotify)
      await notify(
        db,
        orgId,
        ["admin", "manager"],
        "An online rent payment did not go through",
        `<p>${escapeHtml(reason)}</p><p>Stripe payment <strong>${escapeHtml(intentId)}</strong>. ${
          result.voided
            ? "Rentio voided the recorded payment, so the invoice is open again."
            : "Nothing had been recorded in Rentio for it."
        } Follow up with the tenant; details are in your Stripe dashboard.</p>`,
      );
  };

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    if (attempt) await setStatus(db, attempt.id, "succeeded");
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
  } else if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object;
    // A card decline happens with the tenant on screen (the intent goes
    // back to requires_payment_method and stays reusable). Only a failure
    // AFTER processing (ACH failure or return) touches the books.
    if (attempt?.status === "processing")
      await reverse(intent.id, "A bank (ACH) payment failed or was returned.", true);
    if (attempt) await setStatus(db, attempt.id, intent.status);
  } else if (
    event.type === "payment_intent.processing" ||
    event.type === "payment_intent.canceled" ||
    event.type === "payment_intent.requires_action"
  ) {
    if (attempt) await setStatus(db, attempt.id, event.data.object.status);
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object;
    const intentId = intentIdOf(event);
    // ponytail: partial refunds only email staff; the booked payment stays, staff adjust by hand.
    if (intentId && charge.refunded) await reverse(intentId, "The payment was refunded in Stripe.");
    else if (intentId)
      await notify(
        db,
        orgId,
        ["admin", "manager"],
        "An online rent payment was partly refunded",
        `<p>Stripe payment <strong>${escapeHtml(intentId)}</strong> was partly refunded (${(charge.amount_refunded / 100).toFixed(2)}). Rentio did not change the payment; adjust it if needed.</p>`,
      );
  } else if (event.type === "charge.dispute.created") {
    const intentId = intentIdOf(event);
    if (intentId) await reverse(intentId, "The tenant disputed the payment (chargeback).");
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
    ...(reversed !== undefined ? { reversed } : {}),
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
