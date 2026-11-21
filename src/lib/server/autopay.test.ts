import { expect, test } from "bun:test";
import type Stripe from "stripe";

process.env["POSTGREST_JWT_SECRET"] = "test-secret-at-least-thirty-two-characters-long";
const { runAutopay } = await import("@/lib/server/autopay");
const { handleStripeEvent, openPaymentIntent } = await import("@/lib/server/stripe-payments");
const { saveEnrollment } = await import("@/lib/server/stripe-portal");
const { fakeDb: shared } = await import("@/lib/server/testing/fake-db");

const due = [
  {
    enrollment_id: "e1",
    invoice_id: "inv-1",
    lease_id: "lease-1",
    tenant_id: "t1",
    due_date: "2026-12-01",
    balance: "1170.00",
    stripe_customer_id: "cus_1",
    payment_method_id: "pm_card",
    method_type: "card",
  },
  {
    enrollment_id: "e2",
    invoice_id: "inv-2",
    lease_id: "lease-2",
    tenant_id: "t2",
    due_date: "2026-12-01",
    balance: "950.00",
    stripe_customer_id: "cus_2",
    payment_method_id: "pm_bank",
    method_type: "ach",
  },
];

/** Never a network: the account row, the due list, attempts and runs in memory. */
const OPEN = new Set([
  "creating",
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
]);
const sameOpenSlot = (row: Record<string, unknown>, existing: Record<string, unknown>[]) =>
  existing.some(
    (other) =>
      OPEN.has(String(other["status"] ?? "creating")) &&
      ["org_id", "tenant_id", "lease_id", "invoice_key"].every((c) => other[c] === row[c]),
  );

function fakeDb(
  account: Record<string, unknown> | null,
  rows = due,
  attempts: Record<string, unknown>[] = [],
) {
  const fake = shared(
    {
      stripe_accounts: account ? [{ org_id: "org-a", ...account }] : [],
      stripe_payment_attempts: attempts,
    },
    {
      conflict: { stripe_payment_attempts: sameOpenSlot },
      rpc: {
        autopay_due: () => ({ data: rows, error: null }),
        record_online_payment: () => ({ data: { payment_id: "pay-1" }, error: null }),
      },
    },
  );
  // live array: autopay_runs rows as runAutopay inserts them
  return { db: fake.db, rows: fake.rows, inserts: fake.rows("autopay_runs") };
}

function fakeStripe(behaviour: (params: Stripe.PaymentIntentCreateParams) => Stripe.PaymentIntent) {
  const created: { params: Stripe.PaymentIntentCreateParams; options: Stripe.RequestOptions }[] =
    [];
  const stripe = {
    paymentIntents: {
      create: (params: Stripe.PaymentIntentCreateParams, options: Stripe.RequestOptions) => {
        created.push({ params, options });
        return Promise.resolve().then(() => behaviour(params));
      },
    },
  } as unknown as Stripe;
  return { stripe, created };
}

const ready = {
  stripe_account_id: "acct_1",
  charges_enabled: true,
  card_fee_enabled: true,
  card_fee_percent: "3",
};

test("charges each due invoice off-session on the connected account, once per invoice", async () => {
  const { db, inserts } = fakeDb(ready);
  const { stripe, created } = fakeStripe(
    (params) => ({ id: `pi_${params.customer}`, status: "succeeded" }) as Stripe.PaymentIntent,
  );
  expect(await runAutopay("org-a", { stripe, db })).toEqual({ created: 2, failed: 0 });

  expect(created).toHaveLength(2);
  const [card, bank] = created as [(typeof created)[0], (typeof created)[0]];
  expect(card.options).toEqual({
    stripeAccount: "acct_1",
    idempotencyKey: "autopay:inv-1:2026-12-01",
  });
  expect(card.params).toMatchObject({
    amount: 120510, // 1170 + 3% card fee
    customer: "cus_1",
    payment_method: "pm_card",
    off_session: true,
    confirm: true,
    error_on_requires_action: true,
    metadata: {
      org_id: "org-a",
      lease_id: "lease-1",
      rent_amount: "1170.00",
      fee_amount: "35.10",
      autopay: "1",
    },
  });
  expect(bank.params.amount).toBe(95000); // ACH never carries the fee
  expect(inserts.map((row) => [row["invoice_id"], row["status"]])).toEqual([
    ["inv-1", "created"],
    ["inv-2", "created"],
  ]);
});

test("a refused charge is recorded as failed with Stripe's reason, and the run goes on", async () => {
  const { db, inserts } = fakeDb(ready);
  const { stripe } = fakeStripe((params) => {
    if (params.customer === "cus_1") {
      const error = Object.assign(new Error("Your card was declined."), {
        type: "StripeCardError",
        payment_intent: { id: "pi_declined" },
      });
      throw error;
    }
    return { id: "pi_ok", status: "processing" } as Stripe.PaymentIntent;
  });
  expect(await runAutopay("org-a", { stripe, db })).toEqual({ created: 1, failed: 1 });
  expect(inserts[0]).toMatchObject({
    invoice_id: "inv-1",
    status: "failed",
    payment_intent_id: "pi_declined",
    error: "Your card was declined.",
  });
  expect(inserts[1]).toMatchObject({ invoice_id: "inv-2", status: "created" });
});

test("nothing happens while the company cannot take charges", async () => {
  const { db, inserts } = fakeDb({ ...ready, charges_enabled: false });
  const { stripe, created } = fakeStripe(() => {
    throw new Error("must not be called");
  });
  expect(await runAutopay("org-a", { stripe, db })).toEqual({
    created: 0,
    failed: 0,
    skipped: "stripe not ready",
  });
  expect(created).toHaveLength(0);
  expect(inserts).toHaveLength(0);
});

// ------------------------------------------- security review on #72

test("an invoice already being paid (open attempt on the slot) is not charged again", async () => {
  const { db, inserts } = fakeDb(
    ready,
    [due[0]!],
    [
      {
        id: "att-paynow",
        org_id: "org-a",
        tenant_id: "t1",
        lease_id: "lease-1",
        invoice_key: "inv-1",
        status: "processing",
      },
    ],
  );
  const { stripe, created } = fakeStripe(() => {
    throw new Error("must not be called");
  });
  expect(await runAutopay("org-a", { stripe, db })).toEqual({ created: 0, failed: 0 });
  expect(created).toHaveLength(0);
  expect(inserts).toHaveLength(0);
});

test("each autopay charge takes the lease's attempt slot with the account it ran on", async () => {
  const { db, rows } = fakeDb(ready, [due[1]!]);
  const { stripe, created } = fakeStripe(
    () => ({ id: "pi_bank", status: "processing" }) as Stripe.PaymentIntent,
  );
  await runAutopay("org-a", { stripe, db });
  const [attempt] = rows("stripe_payment_attempts");
  expect(attempt).toMatchObject({
    lease_id: "lease-2",
    invoice_key: "inv-2",
    stripe_account_id: "acct_1",
    autopay: true,
    payment_intent_id: "pi_bank",
    status: "processing",
  });
  expect(created[0]!.params.metadata).toMatchObject({ attempt_id: attempt!["id"] });
});

test("a Stripe timeout is 'unknown – check Stripe', not failed, and keeps the slot", async () => {
  const { db, inserts, rows } = fakeDb(ready, [due[0]!]);
  const { stripe, created } = fakeStripe(() => {
    throw Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" });
  });
  expect(await runAutopay("org-a", { stripe, db })).toEqual({ created: 0, failed: 0, unknown: 1 });
  expect(created[0]!.options.idempotencyKey).toBe("autopay:inv-1:2026-12-01");
  expect(inserts[0]).toMatchObject({ status: "unknown" });
  expect(String(inserts[0]!["error"])).toStartWith("unknown – check Stripe");
  // the slot stays open, so neither autopay nor Pay now charges again
  expect(rows("stripe_payment_attempts")[0]!["status"] ?? "creating").toBe("creating");
});

test("a card decline is failed and frees the slot", async () => {
  const { db, inserts, rows } = fakeDb(ready, [due[0]!]);
  const { stripe } = fakeStripe(() => {
    throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
  });
  expect(await runAutopay("org-a", { stripe, db })).toEqual({ created: 0, failed: 1 });
  expect(inserts[0]).toMatchObject({ status: "failed", error: "Your card was declined." });
  expect(rows("stripe_payment_attempts")[0]!["status"]).toBe("canceled");
});

test("a co-tenant cannot replace another tenant's autopay method", async () => {
  const { db, rows } = shared({
    autopay_enrollments: [
      { id: "e1", lease_id: "lease-1", tenant_id: "t1", payment_method_id: "pm_t1" },
    ],
  });
  const row = (tenant: string, pm: string) => ({
    org_id: "org-a",
    tenant_id: tenant,
    lease_id: "lease-1",
    stripe_customer_id: `cus_${tenant}`,
    payment_method_id: pm,
    method_type: "card",
    enabled: true,
  });
  expect(await saveEnrollment(db, row("t2", "pm_t2"))).toBeNull();
  expect(rows("autopay_enrollments")[0]!["payment_method_id"]).toBe("pm_t1");
  // the owner of the enrollment can change their own method
  expect(await saveEnrollment(db, row("t1", "pm_t1b"))).toMatchObject({
    payment_method_id: "pm_t1b",
  });
  // a lease with no enrollment yet takes the first tenant's
  const empty = shared();
  expect(await saveEnrollment(empty.db, row("t2", "pm_t2"))).toMatchObject({ tenant_id: "t2" });
});

test("Pay now waits while autopay is charging the same invoice", async () => {
  const { db } = fakeDb(
    ready,
    [],
    [
      {
        id: "att-auto",
        org_id: "org-a",
        tenant_id: "t1",
        lease_id: "lease-1",
        invoice_key: "inv-1",
        status: "creating",
        autopay: true,
      },
    ],
  );
  const stripe = {
    paymentIntents: {
      create: () => {
        throw new Error("must not be called");
      },
    },
  } as unknown as Stripe;
  const result = await openPaymentIntent(db, stripe, {
    orgId: "org-a",
    leaseId: "lease-1",
    tenantId: "t2",
    stripeAccount: "acct_1",
    invoiceIds: ["inv-1", "inv-0"],
    method: "card",
    params: { amount: 1000, currency: "usd" },
  });
  expect(result).toEqual({ in_progress: true, status: "creating" });
});

test("the webhook links a timed-out autopay charge to its slot through attempt_id", async () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const { db, rows } = fakeDb(
    null,
    [],
    [
      {
        id,
        org_id: "org-a",
        tenant_id: "t1",
        lease_id: "lease-1",
        invoice_key: "inv-1",
        stripe_account_id: "acct_1",
        payment_intent_id: null,
        status: "creating",
        autopay: true,
      },
    ],
  );
  const event = {
    id: "evt_late",
    type: "payment_intent.succeeded",
    account: "acct_1",
    data: {
      object: {
        object: "payment_intent",
        id: "pi_late",
        status: "succeeded",
        amount_received: 117000,
        latest_charge: "ch_late",
        payment_method_types: ["card"],
        metadata: {
          org_id: "org-a",
          lease_id: "lease-1",
          rent_amount: "1170.00",
          fee_amount: "0.00",
          method: "card",
          attempt_id: id,
        },
      },
    },
  } as unknown as Stripe.Event;
  // no stripe_accounts row at all: the attempt alone maps the org
  expect(await handleStripeEvent(event, db, async () => 0)).toMatchObject({
    processed: "payment_intent.succeeded",
  });
  expect(rows("stripe_payment_attempts")[0]).toMatchObject({
    payment_intent_id: "pi_late",
    status: "succeeded",
  });
});
