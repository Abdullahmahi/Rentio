import { expect, test } from "bun:test";
import type Stripe from "stripe";

process.env["POSTGREST_JWT_SECRET"] = "test-secret-at-least-thirty-two-characters-long";
const { handleStripeEvent, openPaymentIntent } = await import("@/lib/server/stripe-payments");
const { fakeDb } = await import("@/lib/server/testing/fake-db");

// Security review on #71. Stripe is a fake object; the database is in memory.

const META = {
  org_id: "org-a",
  lease_id: "lease-1",
  tenant_id: "t1",
  invoice_ids: "i1",
  rent_amount: "1000.00",
  fee_amount: "0.00",
  method: "ach",
};

function world(attemptStatus = "processing", connected: string | null = "acct_a") {
  const reverses: unknown[] = [];
  const fake = fakeDb(
    {
      stripe_accounts: [{ org_id: "org-a", stripe_account_id: connected }],
      stripe_payment_attempts: [
        {
          id: "att-1",
          org_id: "org-a",
          lease_id: "lease-1",
          tenant_id: "t1",
          invoice_key: "i1",
          stripe_account_id: "acct_a",
          payment_intent_id: "pi_1",
          method: "ach",
          amount_cents: 100000,
          status: attemptStatus,
        },
      ],
    },
    {
      unique: { stripe_events: ["event_id"] },
      rpc: {
        record_online_payment: () => ({ data: { payment_id: "pay-1" }, error: null }),
        reverse_online_payment: (args) => {
          reverses.push(args);
          return {
            data:
              reverses.length === 1
                ? { voided: true, payment_id: "pay-1", amount: 1000 }
                : { voided: false, reason: "already_voided", payment_id: "pay-1" },
            error: null,
          };
        },
      },
    },
  );
  const notes: string[] = [];
  const notify = async (_db: unknown, _org: string, roles: string[], title: string) => {
    notes.push(`${roles.join("+")}:${title}`);
    return 1;
  };
  return { ...fake, reverses, notes, notify };
}

const event = (type: string, object: Record<string, unknown>, id = "evt_1", account = "acct_a") =>
  ({ id, type, account, data: { object } }) as unknown as Stripe.Event;

const succeeded = (account = "acct_a") =>
  event(
    "payment_intent.succeeded",
    {
      object: "payment_intent",
      id: "pi_1",
      status: "succeeded",
      amount_received: 100000,
      latest_charge: "ch_1",
      payment_method_types: ["us_bank_account"],
      metadata: META,
    },
    "evt_ok",
    account,
  );

test("an ACH success after the company disconnected is still booked (attempt knows the account)", async () => {
  const w = world("processing", null);
  const outcome = await handleStripeEvent(succeeded(), w.db, w.notify);
  expect(outcome).toEqual({ processed: "payment_intent.succeeded", payment_id: "pay-1" });
  expect(w.rpcCalls[0]).toMatchObject({ name: "record_online_payment", args: { p_org: "org-a" } });
  expect(w.rows("stripe_payment_attempts")[0]!["status"]).toBe("succeeded");
});

test("an ACH success after reconnecting a different account is still booked", async () => {
  const w = world("processing", "acct_new");
  expect(await handleStripeEvent(succeeded(), w.db, w.notify)).toMatchObject({
    payment_id: "pay-1",
  });
});

test("the same intent id from another account does not borrow the attempt's org", async () => {
  const w = world("processing", "acct_a");
  expect(await handleStripeEvent(succeeded("acct_other"), w.db, w.notify)).toEqual({
    ignored: "unknown connected account",
  });
  expect(w.rpcCalls).toHaveLength(0);
});

test("a full refund voids the booked payment and tells staff, once per event", async () => {
  const w = world("succeeded");
  const refund = event(
    "charge.refunded",
    {
      object: "charge",
      id: "ch_1",
      payment_intent: "pi_1",
      refunded: true,
      amount_refunded: 100000,
    },
    "evt_refund",
  );
  expect(await handleStripeEvent(refund, w.db, w.notify)).toEqual({
    processed: "charge.refunded",
    payment_id: "pay-1",
    reversed: true,
  });
  expect(w.reverses[0]).toMatchObject({
    p_org: "org-a",
    p_payment_intent: "pi_1",
    p_event: "evt_refund",
  });
  expect(w.notes).toEqual(["admin+manager:An online rent payment did not go through"]);
  expect(await handleStripeEvent(refund, w.db, w.notify)).toEqual({ duplicate: true });
  expect(w.reverses).toHaveLength(1);
  expect(w.notes).toHaveLength(1);
});

test("a partial refund leaves the payment and only tells staff", async () => {
  const w = world("succeeded");
  const refund = event("charge.refunded", {
    object: "charge",
    payment_intent: "pi_1",
    refunded: false,
    amount_refunded: 5000,
  });
  await handleStripeEvent(refund, w.db, w.notify);
  expect(w.reverses).toHaveLength(0);
  expect(w.notes).toEqual(["admin+manager:An online rent payment was partly refunded"]);
});

test("a dispute voids the booked payment", async () => {
  const w = world("succeeded");
  const dispute = event("charge.dispute.created", {
    object: "dispute",
    charge: "ch_1",
    payment_intent: "pi_1",
  });
  expect(await handleStripeEvent(dispute, w.db, w.notify)).toMatchObject({ reversed: true });
  expect(w.reverses).toHaveLength(1);
});

test("ACH failure after processing reverses and tells staff; a card decline does not", async () => {
  const ach = world("processing");
  const failed = (status: string) =>
    event("payment_intent.payment_failed", { object: "payment_intent", id: "pi_1", status });
  await handleStripeEvent(failed("requires_payment_method"), ach.db, ach.notify);
  expect(ach.reverses).toHaveLength(1);
  expect(ach.notes).toHaveLength(1);
  expect(ach.rows("stripe_payment_attempts")[0]!["status"]).toBe("requires_payment_method");

  const card = world("requires_payment_method");
  await handleStripeEvent(failed("requires_payment_method"), card.db, card.notify);
  expect(card.reverses).toHaveLength(0);
  expect(card.notes).toHaveLength(0);
});

test("processing is recorded on the attempt", async () => {
  const w = world("requires_action");
  await handleStripeEvent(
    event("payment_intent.processing", {
      object: "payment_intent",
      id: "pi_1",
      status: "processing",
    }),
    w.db,
    w.notify,
  );
  expect(w.rows("stripe_payment_attempts")[0]!["status"]).toBe("processing");
});

// ------------------------------------------------------- one open intent

function fakeIntents() {
  const intents = new Map<
    string,
    { id: string; status: string; amount: number; client_secret: string }
  >();
  const byKey = new Map<string, string>();
  const calls: string[] = [];
  const api = {
    paymentIntents: {
      create: async (
        params: { amount: number },
        options: { idempotencyKey: string; stripeAccount: string },
      ) => {
        calls.push(`create:${options.stripeAccount}`);
        const known = byKey.get(options.idempotencyKey);
        if (known) return intents.get(known)!;
        const id = `pi_${intents.size + 1}`;
        const intent = {
          id,
          status: "requires_payment_method",
          amount: params.amount,
          client_secret: `${id}_secret`,
        };
        intents.set(id, intent);
        byKey.set(options.idempotencyKey, id);
        return intent;
      },
      retrieve: async (id: string) => (calls.push(`retrieve:${id}`), intents.get(id)!),
      cancel: async (id: string) => {
        calls.push(`cancel:${id}`);
        intents.get(id)!.status = "canceled";
        return intents.get(id)!;
      },
    },
  };
  return { stripe: api as never, intents, calls };
}

const input = (amount = 100000, method: "card" | "ach" = "card") => ({
  orgId: "org-a",
  leaseId: "lease-1",
  tenantId: "t1",
  stripeAccount: "acct_a",
  invoiceIds: ["i2", "i1"],
  method,
  params: { amount, currency: "usd", metadata: {} },
});

test("a second Pay now for the same invoices gets the same intent back", async () => {
  const { db, rows } = fakeDb({}, { unique: { stripe_payment_attempts: ["payment_intent_id"] } });
  const s = fakeIntents();
  const first = await openPaymentIntent(db, s.stripe, input());
  const second = await openPaymentIntent(db, s.stripe, input());
  expect("intent" in first && "intent" in second && first.intent.id === second.intent.id).toBe(
    true,
  );
  expect(s.intents.size).toBe(1);
  expect(rows("stripe_payment_attempts")).toHaveLength(1);
  expect(rows("stripe_payment_attempts")[0]).toMatchObject({
    invoice_key: "i1,i2",
    stripe_account_id: "acct_a",
  });
});

test("while a payment is processing, no new intent is created", async () => {
  const { db } = fakeDb();
  const s = fakeIntents();
  const first = await openPaymentIntent(db, s.stripe, input());
  if (!("intent" in first)) throw new Error("expected intent");
  s.intents.get(first.intent.id)!.status = "processing";
  expect(await openPaymentIntent(db, s.stripe, input())).toEqual({
    in_progress: true,
    status: "processing",
  });
  expect(await openPaymentIntent(db, s.stripe, input())).toEqual({
    in_progress: true,
    status: "processing",
  });
  expect(s.intents.size).toBe(1);
});

test("a changed amount cancels the old intent before creating a new one", async () => {
  const { db } = fakeDb();
  const s = fakeIntents();
  await openPaymentIntent(db, s.stripe, input(100000));
  const next = await openPaymentIntent(db, s.stripe, input(50000));
  expect("intent" in next && next.intent.amount).toBe(50000);
  expect(s.calls).toContain("cancel:pi_1");
  expect([...s.intents.values()].filter((i) => i.status !== "canceled")).toHaveLength(1);
});

test("an attempt caught mid-creation reuses the same idempotency key", async () => {
  const { db } = fakeDb({
    stripe_payment_attempts: [
      {
        id: "att-x",
        org_id: "org-a",
        lease_id: "lease-1",
        tenant_id: "t1",
        invoice_key: "i1,i2",
        stripe_account_id: "acct_a",
        payment_intent_id: null,
        method: "card",
        amount_cents: 100000,
        status: "creating",
      },
    ],
  });
  const s = fakeIntents();
  const a = await openPaymentIntent(db, s.stripe, input());
  const b = await openPaymentIntent(db, s.stripe, input());
  expect("intent" in a && "intent" in b && a.intent.id === b.intent.id).toBe(true);
  expect(s.intents.size).toBe(1);
});
