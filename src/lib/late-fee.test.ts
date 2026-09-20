import { expect, test } from "bun:test";
import {
  capPercentFor,
  exceedsCap,
  lateFeeAmount,
  lateFeeEligibility,
  lateFeeEligibleFrom,
  lateFeePercentOfRent,
  unitsInStructure,
} from "@/lib/late-fee";

const percent = (rent: number, pct: number) =>
  ({
    late_fee_type: "percent",
    late_fee_percent: pct,
    late_fee_amount: 0,
    rent_amount: rent,
  }) as const;
const fixed = (rent: number, amount: number) =>
  ({
    late_fee_type: "fixed",
    late_fee_percent: 0,
    late_fee_amount: amount,
    rent_amount: rent,
  }) as const;

test("the cap is 12% at four units or fewer, 10% above", () => {
  expect(capPercentFor(1)).toBe(12);
  expect(capPercentFor(4)).toBe(12);
  expect(capPercentFor(5)).toBe(10);
  expect(capPercentFor(40)).toBe(10);
  // Unknown structure size takes the stricter cap.
  expect(capPercentFor(null)).toBe(10);
  expect(capPercentFor(0)).toBe(10);
});

test("a hand-set structure size beats the derived unit count", () => {
  // An app "property" may be four separate fourplexes.
  expect(unitsInStructure({ units_in_structure: 4 }, 16)).toBe(4);
  expect(unitsInStructure({ units_in_structure: null }, 16)).toBe(16);
  expect(unitsInStructure(undefined, 16)).toBe(16);
});

test("a percentage fee computes to dollars and back", () => {
  expect(lateFeeAmount(percent(1250, 10))).toBe(125);
  expect(lateFeeAmount(percent(1075, 10))).toBe(107.5);
  expect(lateFeeAmount(percent(999.99, 12))).toBe(120); // rounded to cents
  expect(lateFeeAmount(fixed(1250, 75))).toBe(75);
  expect(lateFeePercentOfRent(fixed(1250, 125))).toBeCloseTo(10);
  expect(lateFeePercentOfRent(fixed(0, 125))).toBe(0); // no divide by zero
});

test("the cap warning trips only above the presumption", () => {
  expect(exceedsCap(percent(1250, 10), 10)).toBe(false); // exactly at the cap
  expect(exceedsCap(percent(1250, 10.01), 10)).toBe(true);
  expect(exceedsCap(percent(1250, 12), 12)).toBe(false);
  expect(exceedsCap(percent(1250, 12), 10)).toBe(true); // large structure
  // A flat fee is measured against the same cap.
  expect(exceedsCap(fixed(1250, 125), 10)).toBe(false);
  expect(exceedsCap(fixed(1250, 200), 10)).toBe(true);
});

test("a fee cannot be applied before the end of the second full day", () => {
  // Rent due 09/01. The two full days after it are the 2nd and the 3rd. The
  // fee becomes chargeable at the END of the 3rd, so the first date the
  // button may fire is the 4th.
  expect(lateFeeEligibleFrom("2026-09-01", 2)).toBe("2026-09-04");
  // A grace period shorter than the statutory minimum cannot shorten it.
  expect(lateFeeEligibleFrom("2026-09-01", 0)).toBe("2026-09-04");
  expect(lateFeeEligibleFrom("2026-09-01", 1)).toBe("2026-09-04");
  // A longer lease grace period does apply.
  expect(lateFeeEligibleFrom("2026-09-01", 5)).toBe("2026-09-07");
  // Across a month boundary.
  expect(lateFeeEligibleFrom("2026-01-31", 2)).toBe("2026-02-03");
});

test("eligibility reports the date and the wait", () => {
  expect(lateFeeEligibility("2026-09-01", 2, "2026-09-02")).toEqual({
    eligible: false,
    eligibleFrom: "2026-09-04",
    daysRemaining: 2,
  });
  expect(lateFeeEligibility("2026-09-01", 2, "2026-09-03").eligible).toBe(false);
  expect(lateFeeEligibility("2026-09-01", 2, "2026-09-04").eligible).toBe(true);
  expect(lateFeeEligibility("2026-09-01", 2, "2026-09-30").eligible).toBe(true);
});
