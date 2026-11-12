import { expect, test } from "bun:test";
import { lateFeeWarningEmail } from "@/lib/server/late-fee-email";

const warning = {
  tenant_name: "Ana <b>",
  locale: "es-MX",
  company_name: "Hayen",
  unit_number: "104",
  period_month: "2026-11-01",
  eligible_on: "2026-11-04",
  fee: 50,
  balance: 1200.5,
};

test("Spanish by default, with the fee, the date and the balance", () => {
  const { subject, html } = lateFeeWarningEmail(warning, "https://x/sign-in");
  expect(subject).toContain("Noviembre");
  expect(html).toContain("$50.00");
  expect(html).toContain("11/04/2026");
  expect(html).toContain("$1,200.50");
  expect(html).toContain("Ana &lt;b&gt;");
  expect(html).toContain('lang="es-MX"');
});

test("English when the tenant chose English", () => {
  const { subject, html } = lateFeeWarningEmail({ ...warning, locale: "en" }, "");
  expect(subject).toBe("Reminder: your November 2026 rent is still open");
  expect(html).toContain(
    "A late fee of <strong>$50.00</strong> may be charged on <strong>11/04/2026</strong>",
  );
  expect(html).not.toContain("Open my portal");
});
