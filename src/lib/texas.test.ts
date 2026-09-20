import { expect, test } from "bun:test";
import { defaultVacateDate, rekeyClock, rekeyDeadline, repairClock } from "@/lib/texas";

test("the repair window counts from the written notice, day 1 inclusive", () => {
  // §92.056 presumes 7 days reasonable. The day notice arrives is day 1.
  expect(repairClock("2026-09-01T09:00:00Z", "2026-09-01")).toMatchObject({
    day: 1,
    overdue: false,
    tone: "neutral",
  });
  expect(repairClock("2026-09-01T09:00:00Z", "2026-09-05").tone).toBe("warning"); // day 5
  expect(repairClock("2026-09-01T09:00:00Z", "2026-09-07")).toMatchObject({
    day: 7,
    overdue: false,
    tone: "warning",
  });
  // Day 8 is past the presumed-reasonable window.
  expect(repairClock("2026-09-01T09:00:00Z", "2026-09-08")).toMatchObject({
    day: 8,
    overdue: true,
    tone: "danger",
  });
});

test("a resolved repair is measured to its resolution, not to today", () => {
  const clock = repairClock("2026-09-01T09:00:00Z", "2026-12-25", "2026-09-04T16:00:00Z");
  expect(clock).toMatchObject({ day: 4, overdue: false });
});

test("the rekey deadline is the 7th day of possession", () => {
  // §92.156 — no later than the 7th day after the tenant takes possession.
  expect(rekeyDeadline("2026-09-01")).toBe("2026-09-08");
  expect(rekeyClock("2026-09-01", "2026-09-03")).toMatchObject({
    deadline: "2026-09-08",
    daysRemaining: 5,
    overdue: false,
  });
  expect(rekeyClock("2026-09-01", "2026-09-08").overdue).toBe(false);
  expect(rekeyClock("2026-09-01", "2026-09-09")).toMatchObject({
    daysRemaining: -1,
    overdue: true,
  });
});

test("the vacate date defaults to the §24.005 three days", () => {
  expect(defaultVacateDate("2026-09-01")).toBe("2026-09-04");
  expect(defaultVacateDate("2026-10-30")).toBe("2026-11-02"); // across the DST change
});
