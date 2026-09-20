import { expect, test } from "bun:test";
import { addDays, daysBetween, formatDate, formatMoney, todayIso } from "@/lib/format";
import { formatCityStateZip, formatUsPhone, toE164 } from "@/lib/us";

test("money is USD with no currency suffix", () => {
  expect(formatMoney(1250)).toBe("$1,250.00");
  expect(formatMoney(0)).toBe("$0.00");
  expect(formatMoney(-125.5)).toBe("-$125.50");
});

test("a date column renders as its own calendar day, not shifted west", () => {
  // The whole point: `new Date("2026-09-01")` is UTC midnight, which is
  // 08/31 in Mountain Time. A `date` column is a calendar date, not an instant.
  expect(formatDate("2026-09-01")).toBe("09/01/2026");
  expect(formatDate("2026-12-31")).toBe("12/31/2026");
});

test("a timestamp renders in El Paso's zone, not the browser's", () => {
  // 2026-09-02T04:30:00Z is still 09/01 at 22:30 in Mountain Time.
  expect(formatDate("2026-09-02T04:30:00Z")).toBe("09/01/2026");
  // ...and 06:30Z has already tipped over into 09/02.
  expect(formatDate("2026-09-02T06:30:00Z")).toBe("09/02/2026");
});

test("todayIso answers in El Paso, so the evening does not roll the day early", () => {
  // 11pm in El Paso on Sept 1 is already Sept 2 in UTC. The naive
  // `toISOString().slice(0,10)` returned 09-02 here, aging every invoice a day.
  expect(todayIso(new Date("2026-09-02T05:00:00Z"))).toBe("2026-09-01");
  expect(todayIso(new Date("2026-09-02T06:00:00Z"))).toBe("2026-09-02");
});

test("day arithmetic survives a DST boundary", () => {
  // US DST ends 11/01/2026. A UTC-millisecond subtraction gets this wrong.
  expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  expect(daysBetween("2026-09-05", "2026-09-01")).toBe(-4);
  expect(addDays("2026-02-27", 2)).toBe("2026-03-01"); // 2026 is not a leap year
});

test("phones format as (915) 555-0123 while you type", () => {
  expect(formatUsPhone("9155550123")).toBe("(915) 555-0123");
  expect(formatUsPhone("+1 915 555 0123")).toBe("(915) 555-0123");
  expect(formatUsPhone("915")).toBe("915");
  expect(formatUsPhone("91555")).toBe("(915) 55");
  expect(formatUsPhone("915555012399")).toBe("(915) 555-0123"); // extra digits dropped
  expect(toE164("(915) 555-0123")).toBe("+19155550123");
  expect(toE164("555")).toBe("");
});

test("city/state/zip drops whatever is missing", () => {
  expect(formatCityStateZip("El Paso", "TX", "79912")).toBe("El Paso, TX 79912");
  expect(formatCityStateZip("El Paso", null, null)).toBe("El Paso");
  expect(formatCityStateZip(null, "TX", "79912")).toBe("TX 79912");
  expect(formatCityStateZip(null, null, null)).toBe("");
});
