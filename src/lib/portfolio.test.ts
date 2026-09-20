/**
 * Derived-data checks. Run with `bun test`.
 *
 * These four functions decide what every list, badge and balance card shows,
 * so they are the ones worth pinning down.
 */
import { expect, test } from "bun:test";
import {
  daysUntilEnd,
  isExpiringSoon,
  leaseContexts,
  occupancy,
  unitContexts,
} from "@/lib/portfolio";
import { effectiveInvoiceStatus } from "@/components/rentio/status";
import type { Portfolio } from "@/lib/queries";

const TODAY = "2026-09-19";

function fixture(): Portfolio {
  return {
    properties: [{ id: "p1", name: "Mesa Hills Apartments" } as never],
    units: [
      { id: "u1", property_id: "p1", unit_number: "101", status: "ocupada" } as never,
      { id: "u2", property_id: "p1", unit_number: "102", status: "vacante" } as never,
      { id: "u3", property_id: "p1", unit_number: "103", status: "mantenimiento" } as never,
    ],
    parking: [{ id: "e1", property_id: "p1", label: "E-01", lease_id: "l1" } as never],
    leases: [
      { id: "l1", unit_id: "u1", status: "activo", end_date: "2026-10-31" } as never,
      { id: "l2", unit_id: "u2", status: "terminado", end_date: "2026-01-31" } as never,
    ],
    leaseTenants: [
      { id: "lt1", lease_id: "l1", tenant_id: "t1", role: "primary" } as never,
      { id: "lt2", lease_id: "l1", tenant_id: "t2", role: "co_tenant" } as never,
      { id: "lt3", lease_id: "l1", tenant_id: "t3", role: "guarantor" } as never,
    ],
    tenants: [
      { id: "t1", full_name: "Juan Pérez" } as never,
      { id: "t2", full_name: "Ana Ruiz" } as never,
      { id: "t3", full_name: "Luis Mora" } as never,
    ],
    balances: [{ lease_id: "l1", balance: 4500, total_invoiced: 12000, total_paid: 7500 } as never],
  };
}

test("leaseContexts joins unit, property, roles, parking and balance", () => {
  const lease = leaseContexts(fixture())[0]!;
  expect(lease.unit?.unit_number).toBe("101");
  expect(lease.property?.name).toBe("Mesa Hills Apartments");
  expect(lease.primaryTenant?.full_name).toBe("Juan Pérez");
  expect(lease.coTenants.map((t) => t.full_name)).toEqual(["Ana Ruiz"]);
  expect(lease.guarantors.map((t) => t.full_name)).toEqual(["Luis Mora"]);
  expect(lease.parking.map((p) => p.label)).toEqual(["E-01"]);
  expect(Number(lease.balance?.balance)).toBe(4500);
});

test("unitContexts attaches only the ACTIVE lease's tenant", () => {
  const units = unitContexts(fixture());
  expect(units.find((u) => u.unit.id === "u1")?.tenant?.full_name).toBe("Juan Pérez");
  // u2's only lease is `terminado`, so the unit must read as having no tenant.
  expect(units.find((u) => u.unit.id === "u2")?.tenant).toBeUndefined();
  expect(units.find((u) => u.unit.id === "u2")?.activeLease).toBeUndefined();
});

test("occupancy counts only `ocupada` as occupied", () => {
  const stats = occupancy(fixture());
  expect(stats.total).toBe(3);
  expect(stats.occupied).toBe(1);
  expect(stats.vacant).toBe(1); // `mantenimiento` is neither occupied nor vacant
  expect(stats.rate).toBeCloseTo(1 / 3);
});

test("isExpiringSoon covers the 60-day window and both of its edges", () => {
  const lease = (end_date: string, status = "activo") =>
    ({ id: "x", unit_id: "u1", status, end_date }) as never;
  expect(daysUntilEnd(lease("2026-10-31"), TODAY)).toBe(42);
  expect(isExpiringSoon(lease("2026-10-31"), TODAY)).toBe(true);
  expect(isExpiringSoon(lease("2026-11-18"), TODAY)).toBe(true); // day 60
  expect(isExpiringSoon(lease("2026-11-19"), TODAY)).toBe(false); // day 61
  expect(isExpiringSoon(lease("2026-09-19"), TODAY)).toBe(true); // ends today
  expect(isExpiringSoon(lease("2026-09-18"), TODAY)).toBe(false); // already ended
  expect(isExpiringSoon(lease("2026-10-31", "terminado"), TODAY)).toBe(false);
});

test("effectiveInvoiceStatus derives vencido from the due date, not the stored value", () => {
  const past = "2026-01-05";
  const future = "2099-01-05";

  expect(effectiveInvoiceStatus({ status: "enviado", due_date: past, total: 1000 }, 0)).toBe(
    "vencido",
  );
  expect(effectiveInvoiceStatus({ status: "enviado", due_date: past, total: 1000 }, 400)).toBe(
    "vencido",
  );
  expect(effectiveInvoiceStatus({ status: "enviado", due_date: past, total: 1000 }, 1000)).toBe(
    "pagado",
  );
  expect(effectiveInvoiceStatus({ status: "enviado", due_date: future, total: 1000 }, 400)).toBe(
    "pagado_parcial",
  );
  expect(effectiveInvoiceStatus({ status: "enviado", due_date: future, total: 1000 }, 0)).toBe(
    "enviado",
  );

  // Cancelled and draft invoices are never re-derived.
  expect(effectiveInvoiceStatus({ status: "cancelado", due_date: past, total: 1000 }, 0)).toBe(
    "cancelado",
  );
  expect(effectiveInvoiceStatus({ status: "borrador", due_date: past, total: 1000 }, 0)).toBe(
    "borrador",
  );

  // Floating point: 999.995 of 1000 must still read as paid.
  expect(effectiveInvoiceStatus({ status: "enviado", due_date: past, total: 1000 }, 999.9999)).toBe(
    "pagado",
  );
});
