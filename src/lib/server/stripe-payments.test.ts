import { expect, test } from "bun:test";
import type Stripe from "stripe";
import type { Db } from "@/lib/server/session";

process.env["POSTGREST_JWT_SECRET"] = "test-secret-at-least-thirty-two-characters-long";
const { chargedMethod, computeCharge, handleStripeEvent, intentMetadata } =
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

test("the recorded method is what Stripe charged, metadata only as a last resort", () => {
  const meta = { method: "card" as const };
  const charged = (type: string) =>
    ({
      latest_charge: { payment_method_details: { type } },
      payment_method_types: ["card"],
    }) as never;
  expect(chargedMethod(charged("us_bank_account"), meta)).toBe("ach");
  expect(chargedMethod(charged("card"), { method: "ach" })).toBe("card");
  expect(
    chargedMethod(
      { latest_charge: "ch_1", payment_method_types: ["us_bank_account"] } as never,
      meta,
    ),
  ).toBe("ach");
  expect(
    chargedMethod({ latest_charge: "ch_1", payment_method_types: [] } as never, { method: "ach" }),
  ).toBe("ach");
});

// ------------------------------------------------------------ fake database
// Stateful stripe_events (so a retry sees the first delivery's row), records
// every call, answers like PostgREST would. Never a network.
function fakeDb(options: { org?: string | null; rpcFailsFirst?: boolean } = {}) {
  const calls: { table?: string; op: string; args: unknown }[] = [];
  const events = new Map<string, { processed_at: string | null }>();
  let rpcCalls = 0;
  const chain = (table: string, op: string, args: unknown) => {
    calls.push({ table, op, args });
    let eventId: string | null = null;
    const result = () => {
      if (table === "stripe_events") {
        const row = args as { event_id?: string; processed_at?: string };
        if (op === "insert") {
          if (events.has(row.event_id!))
            return { data: null, error: { code: "23505", message: "dup" } };
          events.set(row.event_id!, { processed_at: null });
          return { data: null, error: null };
        }
        if (op === "update" && eventId)
          events.set(eventId, { processed_at: row.processed_at ?? null });
        if (op === "select" && eventId) return { data: events.get(eventId) ?? null, error: null };
        return { data: null, error: null };
      }
      if (op === "select")
        return {
          data: options.org === null ? null : { org_id: options.org ?? "org-a" },
          error: null,
        };
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      eq: (column: string, value: string) => {
        if (column === "event_id") eventId = value;
        return builder;
      },
      maybeSingle: () => Promise.resolve(result()),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
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
      rpcCalls += 1;
      if (options.rpcFailsFirst && rpcCalls === 1)
        return Promise.resolve({
          data: null,
          error: { code: "57P01", message: "connection lost" },
        });
      return Promise.resolve({ data: { payment_id: "pay-1" }, error: null });
    },
  } as unknown as Db;
  return { db, calls, events };
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
        payment_method_types: ["card"],
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

const rpcCalls = (calls: { op: string }[]) =>
  calls.filter((call) => call.op === "rpc:record_online_payment").length;

test("a succeeded intent records the RENT, not the fee, through record_online_payment", async () => {
  const { db, calls, events } = fakeDb();
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
  expect(events.get("evt_1")?.processed_at).toBeTruthy();
});

test("a redelivery of a processed event is a no-op", async () => {
  const { db, calls } = fakeDb();
  await handleStripeEvent(succeeded(), db);
  expect(await handleStripeEvent(succeeded(), db)).toEqual({ duplicate: true });
  expect(rpcCalls(calls)).toBe(1);
});

test("when the first delivery throws after the event row, the retry records the rent", async () => {
  const { db, calls, events } = fakeDb({ rpcFailsFirst: true });
  await expect(handleStripeEvent(succeeded(), db)).rejects.toMatchObject({ code: "57P01" });
  expect(events.get("evt_1")?.processed_at).toBeNull();
  expect(await handleStripeEvent(succeeded(), db)).toEqual({
    processed: "payment_intent.succeeded",
    payment_id: "pay-1",
  });
  expect(rpcCalls(calls)).toBe(2);
  expect(events.get("evt_1")?.processed_at).toBeTruthy();
});

test("an unknown account, or metadata naming another org, books nothing", async () => {
  const unknown = fakeDb({ org: null });
  expect(await handleStripeEvent(succeeded(), unknown.db)).toEqual({
    ignored: "unknown connected account",
  });
  const mismatch = fakeDb({ org: "org-b" });
  const outcome = await handleStripeEvent(succeeded(), mismatch.db);
  expect(outcome).toEqual({ ignored: "metadata does not match the account's org" });
  expect(rpcCalls(mismatch.calls)).toBe(0);
});

test("an intent that received less than the rent is not recorded", async () => {
  const { db, calls } = fakeDb();
  const event = succeeded();
  (event.data.object as Stripe.PaymentIntent).amount_received = 100;
  expect(await handleStripeEvent(event, db)).toEqual({
    ignored: "rent amount missing or not covered",
  });
  expect(rpcCalls(calls)).toBe(0);
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
  expect(rpcCalls(calls)).toBe(0);
});
