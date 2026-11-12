import { describe, expect, test } from "bun:test";
import { notificationEmail, type NotificationRow } from "@/lib/server/notification-email";

const base = {
  id: "n1",
  tenant_name: "Ana <b>",
  tenant_email: "ana@example.com",
  company_name: "Truman Properties",
  unit_number: "104",
};

const rows: Array<
  [kind: string, payload: Record<string, unknown>, expectEn: string, expectEs: string]
> = [
  [
    "payment_confirmed",
    { amount: 1170, paid_at: "2026-11-01" },
    "Payment of $1,170.00 confirmed",
    "Pago de $1,170.00 confirmado",
  ],
  [
    "payment_rejected",
    { amount: 1170, reason: "wrong amount" },
    "Reason: <strong>wrong amount</strong>",
    "Motivo: <strong>wrong amount</strong>",
  ],
  ["work_order_status", { title: "Leak", status: "en_progreso" }, "In progress", "En proceso"],
  [
    "work_order_note",
    { title: "Leak", body: "Plumber comes Tuesday" },
    "Plumber comes Tuesday",
    "Plumber comes Tuesday",
  ],
  [
    "rent_reminder",
    { period_month: "2026-12-01", due_date: "2026-12-01", balance: 1170 },
    "There is never a fee to pay rent",
    "Pagar tu renta no tiene costo",
  ],
];

describe("notificationEmail", () => {
  for (const [kind, payload, expectEn, expectEs] of rows) {
    test(`${kind} in both languages`, () => {
      const en = notificationEmail(
        { ...base, kind, payload, locale: "en" } as NotificationRow,
        "https://x/sign-in",
      );
      const es = notificationEmail(
        { ...base, kind, payload, locale: "es-MX" } as NotificationRow,
        "",
      );
      expect(en.subject.length).toBeGreaterThan(0);
      expect(en.html).toContain(expectEn);
      expect(es.html).toContain(expectEs);
      expect(en.html).toContain('lang="en"');
      expect(es.html).toContain('lang="es-MX"');
      expect(en.html).toContain("https://x/sign-in");
      // names typed by staff are escaped
      expect(en.html).toContain("Ana &lt;b&gt;");
      expect(en.html).not.toContain("Ana <b>");
    });
  }

  test("unknown locale falls back to Spanish", () => {
    const out = notificationEmail(
      {
        ...base,
        kind: "payment_confirmed",
        payload: { amount: 1, paid_at: "2026-11-01" },
        locale: "xx",
      } as NotificationRow,
      "",
    );
    expect(out.subject).toContain("confirmado");
  });

  test("unknown kind throws", () => {
    expect(() =>
      notificationEmail(
        { ...base, kind: "nope", payload: {}, locale: "en" } as NotificationRow,
        "",
      ),
    ).toThrow();
  });
});
