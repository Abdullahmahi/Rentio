import type { Portfolio } from "@/lib/queries";
import type { Tables, Views } from "@/lib/database.types";

export interface LeaseContext {
  lease: Tables<"leases">;
  unit: Tables<"units"> | undefined;
  property: Tables<"properties"> | undefined;
  primaryTenant: Tables<"tenants"> | undefined;
  coTenants: Tables<"tenants">[];
  guarantors: Tables<"tenants">[];
  parking: Tables<"parking_spaces">[];
  balance: Views<"lease_balances"> | undefined;
}

export interface UnitContext {
  unit: Tables<"units">;
  property: Tables<"properties"> | undefined;
  activeLease: Tables<"leases"> | undefined;
  tenant: Tables<"tenants"> | undefined;
}

const ACTIVE: Tables<"leases">["status"][] = ["activo", "por_vencer"];

export function leaseContexts(portfolio: Portfolio): LeaseContext[] {
  const unitById = new Map(portfolio.units.map((unit) => [unit.id, unit]));
  const propertyById = new Map(portfolio.properties.map((property) => [property.id, property]));
  const tenantById = new Map(portfolio.tenants.map((tenant) => [tenant.id, tenant]));
  const balanceByLease = new Map(portfolio.balances.map((row) => [row.lease_id, row]));

  const linksByLease = new Map<string, Tables<"lease_tenants">[]>();
  for (const link of portfolio.leaseTenants) {
    const list = linksByLease.get(link.lease_id) ?? [];
    list.push(link);
    linksByLease.set(link.lease_id, list);
  }

  const parkingByLease = new Map<string, Tables<"parking_spaces">[]>();
  for (const space of portfolio.parking) {
    if (!space.lease_id) continue;
    const list = parkingByLease.get(space.lease_id) ?? [];
    list.push(space);
    parkingByLease.set(space.lease_id, list);
  }

  return portfolio.leases.map((lease) => {
    const links = linksByLease.get(lease.id) ?? [];
    const pick = (role: Tables<"lease_tenants">["role"]) =>
      links.filter((link) => link.role === role)
        .map((link) => tenantById.get(link.tenant_id))
        .filter((tenant): tenant is Tables<"tenants"> => Boolean(tenant));
    const unit = unitById.get(lease.unit_id);

    return {
      lease,
      unit,
      property: unit ? propertyById.get(unit.property_id) : undefined,
      primaryTenant: pick("primary")[0],
      coTenants: pick("co_tenant"),
      guarantors: pick("guarantor"),
      parking: parkingByLease.get(lease.id) ?? [],
      balance: balanceByLease.get(lease.id),
    };
  });
}

export function unitContexts(portfolio: Portfolio): UnitContext[] {
  const contexts = leaseContexts(portfolio);
  const activeByUnit = new Map<string, LeaseContext>();
  for (const context of contexts) {
    if (ACTIVE.includes(context.lease.status)) activeByUnit.set(context.lease.unit_id, context);
  }
  const propertyById = new Map(portfolio.properties.map((property) => [property.id, property]));

  return portfolio.units.map((unit) => {
    const active = activeByUnit.get(unit.id);
    return {
      unit,
      property: propertyById.get(unit.property_id),
      activeLease: active?.lease,
      tenant: active?.primaryTenant,
    };
  });
}

export function isActive(lease: Tables<"leases">) {
  return ACTIVE.includes(lease.status);
}

/** Days until a lease ends. Negative once it has already ended. */
export function daysUntilEnd(lease: Tables<"leases">, today = new Date()) {
  const end = new Date(`${lease.end_date}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** A lease inside its final 60 days is flagged "Por vencer" in every list. */
export function isExpiringSoon(lease: Tables<"leases">, today = new Date()) {
  if (!isActive(lease)) return false;
  const days = daysUntilEnd(lease, today);
  return days >= 0 && days <= 60;
}

export function occupancy(portfolio: Portfolio, propertyId?: string) {
  const units = propertyId
    ? portfolio.units.filter((unit) => unit.property_id === propertyId)
    : portfolio.units;
  const occupied = units.filter((unit) => unit.status === "ocupada").length;
  return {
    total: units.length,
    occupied,
    vacant: units.filter((unit) => unit.status === "vacante").length,
    rate: units.length === 0 ? 0 : occupied / units.length,
  };
}

export function balanceOf(context: LeaseContext) {
  return Number(context.balance?.balance ?? 0);
}

/** "Unidad 302 — Juan Pérez", the label every lease picker uses. */
export function leaseLabel(context: LeaseContext, unitWord = "Unidad") {
  const unit = context.unit ? `${unitWord} ${context.unit.unit_number}` : unitWord;
  return context.primaryTenant ? `${unit} — ${context.primaryTenant.full_name}` : unit;
}
