import { expect, test } from "bun:test";
import { insuranceStatus } from "@/lib/vendors";

test("insurance is flagged expired, expiring within 30 days, or ok", () => {
  const today = "2026-11-21";
  expect(insuranceStatus(null, today)).toBe("missing");
  expect(insuranceStatus("2026-11-20", today)).toBe("expired");
  expect(insuranceStatus("2026-11-21", today)).toBe("expiring");
  expect(insuranceStatus("2026-12-21", today)).toBe("expiring");
  expect(insuranceStatus("2026-12-22", today)).toBe("ok");
});
