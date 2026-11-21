import { expect, test } from "bun:test";
import type Stripe from "stripe";
import type { Db } from "@/lib/server/session";

process.env["POSTGREST_JWT_SECRET"] = "test-secret-at-least-thirty-two-characters-long";
const { runAutopay } = await import("@/lib/server/autopay");

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

/** Never a network: the account row, the due list and an insert log. */
function fakeDb(account: Record<string, unknown> | null, rows = due) {
  const inserts: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: account, error: null }) }),
      }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, ...row });
        return Promise.resolve({ data: null, error: null });
      },
    }),
    rpc: () => Promise.resolve({ data: rows, error: null }),
  } as unknown as Db;
  return { db, inserts };
}

function fakeStripe(behaviour: (params: Stripe.PaymentIntentCreateParams) => Stripe.PaymentIntent) {
  const created: { params: Stripe.PaymentIntentCreateParams; options: Stripe.RequestOptions }[] =
    [];
  const stripe = {
    paymentIntents: {
      create: (params: Stripe.PaymentIntentCreateParams, options: Stripe.RequestOptions) => {
        created.push({ params, options });
        return Promise.resolve(behaviour(params));
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
  expect(inserts.map((row) => [row["table"], row["invoice_id"], row["status"]])).toEqual([
    ["autopay_runs", "inv-1", "created"],
    ["autopay_runs", "inv-2", "created"],
  ]);
});

test("a refused charge is recorded as failed with Stripe's reason, and the run goes on", async () => {
  const { db, inserts } = fakeDb(ready);
  const { stripe } = fakeStripe((params) => {
    if (params.customer === "cus_1") {
      const error = Object.assign(new Error("Your card was declined."), {
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
