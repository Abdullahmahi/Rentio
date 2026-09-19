/**
 * The monthly generation is the one action that can silently double-bill a
 * whole building, so its plan is pinned down here before anything is written.
 */
import { expect, test } from "bun:test";
import { dueDateFor, periodKey, planMonthlyInvoices, shiftPeriod } from "@/lib/invoicing";
import type { Portfolio } from "@/lib/queries";
import type { Tables } from "@/lib/database.types";

const PERIOD = "2026-09-01";

const labels = { rent: "Renta mensual", parking: (label: string) => `Estacionamiento ${label}` };

function fixture(): Portfolio {
  return {
    properties: [{ id: "p1", name: "Edificio Roma 214" } as never],
    units: [
      { id: "u1", property_id: "p1", unit_number: "101" } as never,
      { id: "u2", property_id: "p1", unit_number: "102" } as never,
      { id: "u3", property_id: "p1", unit_number: "103" } as never,
    ],
    parking: [
      { id: "e1", property_id: "p1", label: "E-01", lease_id: "l1", monthly_fee: 1200 } as never,
      { id: "e2", property_id: "p1", label: "E-02", lease_id: "l1", monthly_fee: 800 } as never,
      { id: "e3", property_id: "p1", label: "E-03", lease_id: null, monthly_fee: 900 } as never,
    ],
    leases: [
      { id: "l1", unit_id: "u1", status: "activo", rent_amount: 15000, rent_due_day: 1, end_date: "2027-01-31" } as never,
      { id: "l2", unit_id: "u2", status: "activo", rent_amount: 9000, rent_due_day: 5, end_date: "2027-01-31" } as never,
      // Ended: must never be billed.
      { id: "l3", unit_id: "u3", status: "terminado", rent_amount: 8000, rent_due_day: 1, end_date: "2026-05-31" } as never,
    ],
    leaseTenants: [
      { id: "lt1", lease_id: "l1", tenant_id: "t1", role: "primary" } as never,
      { id: "lt2", lease_id: "l2", tenant_id: "t2", role: "primary" } as never,
      { id: "lt3", lease_id: "l3", tenant_id: "t3", role: "primary" } as never,
    ],
    tenants: [
      { id: "t1", full_name: "Juan Pérez" } as never,
      { id: "t2", full_name: "Ana Ruiz" } as never,
      { id: "t3", full_name: "Luis Mora" } as never,
    ],
    balances: [],
  };
}

const utility = (over: Partial<Tables<"utility_charges">>): Tables<"utility_charges"> => ({
  id: "uc1", unit_id: "u1", lease_id: "l1", type: "agua", period_month: PERIOD,
  amount: 250, status: "pendiente", invoice_id: null, notes: null,
  created_at: "", updated_at: null, ...over,
} as Tables<"utility_charges">);

test("bills rent plus every assigned parking space", () => {
  const plan = planMonthlyInvoices({
    portfolio: fixture(), period: PERIOD, invoicedLeaseIds: new Set(), pendingUtilities: [], labels,
  });

  const first = plan.toCreate.find((invoice) => invoice.leaseId === "l1")!;
  expect(first.lines.map((line) => line.description)).toEqual([
    "Renta mensual", "Estacionamiento E-01", "Estacionamiento E-02",
  ]);
  expect(first.total).toBe(17000);

  // E-03 is unassigned, so nobody pays for it.
  const second = plan.toCreate.find((invoice) => invoice.leaseId === "l2")!;
  expect(second.lines).toHaveLength(1);
  expect(second.total).toBe(9000);
});

test("skips leases already invoiced for the period instead of duplicating", () => {
  const plan = planMonthlyInvoices({
    portfolio: fixture(), period: PERIOD,
    invoicedLeaseIds: new Set(["l1"]), pendingUtilities: [], labels,
  });

  expect(plan.toCreate.map((invoice) => invoice.leaseId)).toEqual(["l2"]);
  expect(plan.skipped).toEqual([
    { leaseId: "l1", unitNumber: "101", tenantName: "Juan Pérez", reason: "already_invoiced" },
  ]);
  expect(plan.total).toBe(9000);
});

test("never bills an inactive lease", () => {
  const plan = planMonthlyInvoices({
    portfolio: fixture(), period: PERIOD, invoicedLeaseIds: new Set(), pendingUtilities: [], labels,
  });
  expect(plan.toCreate.map((invoice) => invoice.leaseId)).not.toContain("l3");
  expect(plan.toCreate).toHaveLength(2);
});

test("pulls in pending utility charges for the same unit and period only", () => {
  const plan = planMonthlyInvoices({
    portfolio: fixture(),
    period: PERIOD,
    invoicedLeaseIds: new Set(),
    pendingUtilities: [
      utility({ id: "uc1", type: "agua", amount: 250 }),
      utility({ id: "uc2", type: "cuota_mantenimiento", amount: 950 }),
      // Wrong month — must be ignored.
      utility({ id: "uc3", type: "gas", amount: 400, period_month: "2026-08-01" }),
      // Different unit — belongs to the other lease.
      utility({ id: "uc4", unit_id: "u2", type: "luz", amount: 310 }),
    ],
    labels,
  });

  const first = plan.toCreate.find((invoice) => invoice.leaseId === "l1")!;
  expect(first.lines.map((line) => line.description)).toEqual([
    "Renta mensual", "Estacionamiento E-01", "Estacionamiento E-02", "Agua", "Cuota de mantenimiento",
  ]);
  expect(first.lines.find((line) => line.description === "Cuota de mantenimiento")?.category).toBe("cuota_mantenimiento");
  expect(first.lines.find((line) => line.description === "Agua")?.category).toBe("servicios");
  expect(first.total).toBe(15000 + 1200 + 800 + 250 + 950);

  // Only the charges actually consumed get flipped to facturado later.
  expect(first.lines.map((line) => line.utilityChargeId).filter(Boolean)).toEqual(["uc1", "uc2"]);

  const second = plan.toCreate.find((invoice) => invoice.leaseId === "l2")!;
  expect(second.total).toBe(9000 + 310);
  expect(plan.total).toBe(15000 + 1200 + 800 + 250 + 950 + 9000 + 310);
});

test("dueDateFor clamps a day-31 lease to the end of a short month", () => {
  expect(dueDateFor("2026-09-01", 1)).toBe("2026-09-01");
  expect(dueDateFor("2026-09-01", 5)).toBe("2026-09-05");
  expect(dueDateFor("2026-09-01", 31)).toBe("2026-09-30"); // September has 30 days
  expect(dueDateFor("2026-02-01", 31)).toBe("2026-02-28");
  expect(dueDateFor("2028-02-01", 31)).toBe("2028-02-29"); // leap year
  expect(dueDateFor("2026-01-01", 0)).toBe("2026-01-01");  // clamped up
});

test("period helpers roll across year boundaries", () => {
  expect(periodKey(new Date(2026, 8, 19))).toBe("2026-09-01");
  expect(shiftPeriod("2026-01-01", -1)).toBe("2025-12-01");
  expect(shiftPeriod("2026-12-01", 1)).toBe("2027-01-01");
  expect(shiftPeriod("2026-09-01", -3)).toBe("2026-06-01");
});
