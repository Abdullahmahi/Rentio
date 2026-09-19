import type { Portfolio } from "@/lib/queries";
import { isActive, leaseContexts, type LeaseContext } from "@/lib/portfolio";
import type { Enums, Tables } from "@/lib/database.types";

export interface PlannedLine {
  description: string;
  category: Enums<"line_category">;
  amount: number;
  /** Set when the line came from a utility_charge, which is then marked facturado. */
  utilityChargeId?: string;
}

export interface PlannedInvoice {
  leaseId: string;
  unitNumber: string;
  tenantName: string;
  propertyName: string;
  dueDate: string;
  lines: PlannedLine[];
  total: number;
}

export interface SkippedLease {
  leaseId: string;
  unitNumber: string;
  tenantName: string;
  reason: "already_invoiced";
}

export interface GenerationPlan {
  toCreate: PlannedInvoice[];
  skipped: SkippedLease[];
  total: number;
}

/** First day of a month, as the `period_month` date column stores it. */
export function periodKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export function shiftPeriod(period: string, months: number) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(year!, month! - 1 + months, 1);
  return periodKey(date);
}

/**
 * The lease's payment day inside this period, clamped to the last day of the
 * month — a lease due on the 31st must not roll into March in February.
 */
export function dueDateFor(period: string, rentDueDay: number) {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year!, month!, 0).getDate();
  const day = Math.min(Math.max(rentDueDay, 1), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const UTILITY_LABELS: Record<Enums<"utility_type">, string> = {
  agua: "Agua",
  luz: "Luz",
  gas: "Gas",
  cuota_mantenimiento: "Cuota de mantenimiento",
  otro: "Servicio",
};

function utilityCategory(type: Enums<"utility_type">): Enums<"line_category"> {
  return type === "cuota_mantenimiento" ? "cuota_mantenimiento" : "servicios";
}

interface PlanInput {
  portfolio: Portfolio;
  period: string;
  /** Lease ids that already have an invoice for this period. */
  invoicedLeaseIds: Set<string>;
  /** Only `pendiente` charges — billed ones must never be charged twice. */
  pendingUtilities: Tables<"utility_charges">[];
  labels: {
    rent: string;
    parking: (label: string) => string;
  };
}

/**
 * What "Generar recibos del mes" will create, worked out before anything is
 * written. Every active lease without an invoice for the period gets rent,
 * a line per assigned parking space, and a line per pending utility charge
 * on its unit for that month.
 */
export function planMonthlyInvoices({
  portfolio,
  period,
  invoicedLeaseIds,
  pendingUtilities,
  labels,
}: PlanInput): GenerationPlan {
  const contexts = leaseContexts(portfolio).filter((context) => isActive(context.lease));

  const utilitiesByUnit = new Map<string, Tables<"utility_charges">[]>();
  for (const charge of pendingUtilities) {
    if (charge.period_month !== period) continue;
    const list = utilitiesByUnit.get(charge.unit_id) ?? [];
    list.push(charge);
    utilitiesByUnit.set(charge.unit_id, list);
  }

  const toCreate: PlannedInvoice[] = [];
  const skipped: SkippedLease[] = [];

  for (const context of contexts) {
    const describe = (context: LeaseContext) => ({
      leaseId: context.lease.id,
      unitNumber: context.unit?.unit_number ?? "—",
      tenantName: context.primaryTenant?.full_name ?? "—",
    });

    if (invoicedLeaseIds.has(context.lease.id)) {
      skipped.push({ ...describe(context), reason: "already_invoiced" });
      continue;
    }

    const lines: PlannedLine[] = [
      { description: labels.rent, category: "renta", amount: Number(context.lease.rent_amount) },
    ];

    for (const space of context.parking) {
      lines.push({
        description: labels.parking(space.label),
        category: "estacionamiento",
        amount: Number(space.monthly_fee),
      });
    }

    for (const charge of utilitiesByUnit.get(context.lease.unit_id) ?? []) {
      lines.push({
        description: UTILITY_LABELS[charge.type],
        category: utilityCategory(charge.type),
        amount: Number(charge.amount),
        utilityChargeId: charge.id,
      });
    }

    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    toCreate.push({
      ...describe(context),
      propertyName: context.property?.name ?? "",
      dueDate: dueDateFor(period, context.lease.rent_due_day),
      lines,
      total,
    });
  }

  return {
    toCreate,
    skipped,
    total: toCreate.reduce((sum, invoice) => sum + invoice.total, 0),
  };
}

export interface OpenInvoice {
  id: string;
  invoiceNumber: string | null;
  dueDate: string;
  balance: number;
}

export interface Allocation {
  invoiceId: string;
  amount: number;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Money left over once every open invoice is covered — a saldo a favor. */
  credit: number;
}

/**
 * Spread a payment across open invoices, oldest due date first.
 *
 * Staff can override the result in the UI; this is only the default. Amounts
 * are rounded to centavos so repeated splits cannot drift a peso.
 */
export function allocateOldestFirst(amount: number, openInvoices: OpenInvoice[]): AllocationResult {
  const cents = (value: number) => Math.round(value * 100);
  let remaining = cents(amount);

  const ordered = [...openInvoices]
    .filter((invoice) => cents(invoice.balance) > 0)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  const allocations: Allocation[] = [];
  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, cents(invoice.balance));
    allocations.push({ invoiceId: invoice.id, amount: applied / 100 });
    remaining -= applied;
  }

  return { allocations, credit: remaining / 100 };
}
