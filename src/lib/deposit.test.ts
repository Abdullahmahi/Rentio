import { expect, test } from "bun:test";
import {
  deductionsExceedDeposit,
  depositClock,
  depositDueDate,
  itemizationTotal,
  parseItemization,
  refundDue,
} from "@/lib/deposit";

const lease = (over: Partial<Parameters<typeof depositClock>[0]> = {}) =>
  ({
    surrender_date: null,
    forwarding_address_received_at: null,
    deposit_due_date: null,
    deposit_settled_at: null,
    ...over,
  }) as Parameters<typeof depositClock>[0];

test("the clock starts at the forwarding address, not at move-out", () => {
  // This is the whole point of the two-stage flow. A tenant can move out in
  // October and send the address in December; the 30 days run from December.
  expect(depositClock(lease(), "2026-10-15").stage).toBe("active");
  expect(depositClock(lease({ surrender_date: "2026-10-01" }), "2026-11-20").stage).toBe(
    "awaiting_forwarding",
  );
  expect(depositClock(lease({ surrender_date: "2026-10-01" }), "2026-11-20").daysRemaining).toBe(
    null,
  );
});

test("the deadline is 30 days after the address arrives", () => {
  expect(depositDueDate("2026-10-15")).toBe("2026-11-14");
  expect(depositDueDate("2026-02-15")).toBe("2026-03-17"); // across a short month
  expect(depositDueDate("2026-10-20")).toBe("2026-11-19"); // across the DST change
});

test("the countdown turns amber at 7 days and red at 3", () => {
  const started = (today: string) =>
    depositClock(
      lease({
        surrender_date: "2026-10-01",
        forwarding_address_received_at: "2026-10-15",
        deposit_due_date: "2026-11-14",
      }),
      today,
    );
  expect(started("2026-11-01")).toMatchObject({
    stage: "running",
    daysRemaining: 13,
    tone: "neutral",
  });
  expect(started("2026-11-07")).toMatchObject({ daysRemaining: 7, tone: "warning" });
  expect(started("2026-11-11")).toMatchObject({ daysRemaining: 3, tone: "danger" });
  expect(started("2026-11-14")).toMatchObject({ daysRemaining: 0, tone: "danger" });
  // Past the deadline and unsettled — statutory penalties territory.
  expect(started("2026-11-15")).toMatchObject({
    stage: "overdue",
    daysRemaining: -1,
    tone: "danger",
  });
});

test("a settled deposit stops the clock whatever the date", () => {
  const clock = depositClock(
    lease({
      surrender_date: "2026-10-01",
      forwarding_address_received_at: "2026-10-15",
      deposit_due_date: "2026-11-14",
      deposit_settled_at: "2026-11-02",
    }),
    "2027-01-01",
  );
  expect(clock.stage).toBe("settled");
  expect(clock.tone).toBe("neutral");
});

test("the itemization totals and the refund never go negative", () => {
  const items = [
    { description: "Carpet cleaning", amount: 150 },
    { description: "Unpaid rent November", amount: 400 },
  ];
  expect(itemizationTotal(items)).toBe(550);
  expect(refundDue(1250, items)).toBe(700);
  expect(refundDue(500, items)).toBe(0); // deductions exceed the deposit
  expect(deductionsExceedDeposit(500, items)).toBe(true);
  expect(deductionsExceedDeposit(550, items)).toBe(false);
  expect(
    itemizationTotal([
      { description: "x", amount: 0.1 },
      { description: "y", amount: 0.2 },
    ]),
  ).toBe(0.3);
});

test("a malformed itemization column does not crash the page", () => {
  expect(parseItemization(null)).toEqual([]);
  expect(parseItemization("not an array")).toEqual([]);
  expect(parseItemization([{ description: "Paint" }])).toEqual([
    { description: "Paint", amount: 0 },
  ]);
  expect(parseItemization([null, 3, { description: "Keys", amount: "25" }])).toEqual([
    { description: "Keys", amount: 25 },
  ]);
});
