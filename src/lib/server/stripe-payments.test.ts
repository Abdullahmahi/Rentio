import { expect, test } from "bun:test";
import type Stripe from "stripe";
import type { Db } from "@/lib/server/session";

process.env["POSTGREST_JWT_SECRET"] = "test-secret-at-least-thirty-two-characters-long";
const { computeCharge, handleStripeEvent, intentMetadata } =
  await import("@/lib/server/stripe-payments");

test("the card fee applies only to card, only when the company turned it on", () => {
  const on = { card_fee_enabled: true, card_fee_percent: "3.00" };
  const off = { card_fee_enabled: false, card_fee_percent: "3.00" };
  expect(computeCharge(1170, "card", on)).toEqual({
    rentCents: 117000,
    feeCents: 3510,
    totalCents: 120510,
    feePercent: 3,
  });
  expect(computeCharge(1170, "ach", on).feeCents).toBe(0);
  expect(computeCharge(1170, "card", off).feeCents).toBe(0);
  // half-cent rounding on the fee, never on the rent
  expect(computeCharge(10.01, "card", on)).toMatchObject({ rentCents: 1001, feeCents: 30 });
});

test("metadata carries rent and fee as money strings", () => {
  const meta = intentMetadata({
    orgId: "o",
    leaseId: "l",
    tenantId: "t",
    invoiceIds: ["i1", "i2"],
    charge: computeCharge(1000, "card", { card_fee_enabled: true, card_fee_percent: 2 }),
    method: "card",
  });
  expect(meta).toEqual({
    org_id: "o",
    lease_id: "l",
    tenant_id: "t",
    invoice_ids: "i1,i2",
    rent_amount: "1000.00",
    fee_amount: "20.00",
    method: "card",
  });
});

// ------------------------------------------------------------ fake database
// Records every call; answers like PostgREST would. Never a network.
function fakeDb(options: { org?: string | null; duplicate?: boolean } = {}) {
  const calls: { table?: string; op: string; args: unknown }[] = [];
  const chain = (table: string, op: string, args: unknown) => {
    calls.push({ table, op, args });
    const result = {
      data:
        op === "select" ? (options.org === null ? null : { org_id: options.org ?? "org-a" }) : null,
      error: op === "insert" && options.duplicate ? { code: "23505", message: "dup" } : null,
    };
    const builder: Record<string, unknown> = {
      eq: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  };
  const db = {
    from: (table: string) => ({
      select: (args: unknown) => chain(table, "select", args),
      insert: (args: unknown) => chain(table, "insert", args),
      update: (args: unknown) => chain(table, "update", args),
    }),
    rpc: (name: string, args: unknown) => {
      calls.push({ op: `rpc:${name}`, args });
      return Promise.resolve({ data: { payment_id: "pay-1" }, error: null });
    },
  } as unknown as Db;
  return { db, calls };
}

const succeeded = (overrides: Partial<Stripe.PaymentIntent["metadata"]> = {}) =>
  ({
    id: "evt_1",
    type: "payment_intent.succeeded",
    account: "acct_a",
    data: {
      object: {
        id: "pi_1",
        amount_received: 120510,
        latest_charge: "ch_1",
        metadata: {
          org_id: "org-a",
          lease_id: "lease-1",
          tenant_id: "t",
          invoice_ids: "i1",
          rent_amount: "1170.00",
          fee_amount: "35.10",
          method: "card",
          ...overrides,
        },
      },
    },
  }) as unknown as Stripe.Event;

test("a succeeded intent records the RENT, not the fee, through record_online_payment", async () => {
  const { db, calls } = fakeDb();
  const outcome = await handleStripeEvent(succeeded(), db);
  expect(outcome).toEqual({ processed: "payment_intent.succeeded", payment_id: "pay-1" });
  const rpc = calls.find((call) => call.op === "rpc:record_online_payment");
  expect(rpc?.args).toMatchObject({
    p_org: "org-a",
    p_lease: "lease-1",
    p_amount: 1170,
    p_method: "card",
    p_payment_intent: "pi_1",
    p_charge: "ch_1",
  });
  expect(calls[1]).toMatchObject({ table: "stripe_events", op: "insert" });
  expect(calls.at(-1)).toMatchObject({ table: "stripe_events", op: "update" });
});

test("a redelivered event is a no-op", async () => {
  const { db, calls } = fakeDb({ duplicate: true });
  expect(await handleStripeEvent(succeeded(), db)).toEqual({ duplicate: true });
  expect(calls.some((call) => call.op.startsWith("rpc:"))).toBe(false);
});

test("an unknown account, or metadata naming another org, books nothing", async () => {
  const unknown = fakeDb({ org: null });
  expect(await handleStripeEvent(succeeded(), unknown.db)).toEqual({
    ignored: "unknown connected account",
  });
  const mismatch = fakeDb({ org: "org-b" });
  const outcome = await handleStripeEvent(succeeded(), mismatch.db);
  expect(outcome).toEqual({ ignored: "metadata does not match the account's org" });
  expect(mismatch.calls.some((call) => call.op.startsWith("rpc:"))).toBe(false);
});

test("an intent that received less than the rent is not recorded", async () => {
  const { db, calls } = fakeDb();
  const event = succeeded();
  (event.data.object as Stripe.PaymentIntent).amount_received = 100;
  expect(await handleStripeEvent(event, db)).toEqual({
    ignored: "rent amount missing or not covered",
  });
  expect(calls.some((call) => call.op.startsWith("rpc:"))).toBe(false);
});

test("events without a connected account, and other types, are only logged", async () => {
  const { db, calls } = fakeDb();
  expect(
    await handleStripeEvent({ id: "evt_p", type: "ping" } as unknown as Stripe.Event, db),
  ).toEqual({ ignored: "no connected account on event" });
  const failed = {
    id: "evt_2",
    type: "payment_intent.payment_failed",
    account: "acct_a",
    data: { object: {} },
  } as unknown as Stripe.Event;
  expect(await handleStripeEvent(failed, db)).toEqual({
    processed: "payment_intent.payment_failed",
  });
  expect(calls.some((call) => call.op.startsWith("rpc:"))).toBe(false);
});
