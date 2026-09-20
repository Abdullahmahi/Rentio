/**
 * Texas Property Code §92.103–92.109 — security deposit returns.
 *
 * Build specification, not legal advice. The client's attorney should review
 * the disposition template before it goes to a real tenant.
 */
import { addDays, daysBetween, todayIso } from "@/lib/format";
import type { Tables } from "@/lib/database.types";

/** §92.103(a): 30 days after surrender AND a forwarding address. */
export const DEPOSIT_RETURN_DAYS = 30;

/** Thresholds the countdown changes colour at. */
export const DEPOSIT_AMBER_DAYS = 7;
export const DEPOSIT_RED_DAYS = 3;

export interface DepositItem {
  description: string;
  amount: number;
}

/** Whatever is in the jsonb column, defensively — it is user-entered. */
export function parseItemization(value: unknown): DepositItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const { description, amount } = row as Record<string, unknown>;
    return [{ description: String(description ?? ""), amount: Number(amount) || 0 }];
  });
}

export function itemizationTotal(items: DepositItem[]) {
  return Math.round(items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) * 100) / 100;
}

/** Deposit held less the deductions. Never negative — you cannot refund debt. */
export function refundDue(depositHeld: number, items: DepositItem[]) {
  return Math.max(0, Math.round((depositHeld - itemizationTotal(items)) * 100) / 100);
}

export function deductionsExceedDeposit(depositHeld: number, items: DepositItem[]) {
  return itemizationTotal(items) > depositHeld + 0.005;
}

export function depositDueDate(forwardingReceivedAt: string) {
  return addDays(forwardingReceivedAt, DEPOSIT_RETURN_DAYS);
}

export type DepositStage =
  | "active" // lease still running
  | "awaiting_forwarding" // moved out, clock has NOT started
  | "running" // clock started, still inside 30 days
  | "overdue" // past the deadline, unsettled — this is the expensive one
  | "settled";

export interface DepositClock {
  stage: DepositStage;
  dueDate: string | null;
  daysRemaining: number | null;
  /** "neutral" | "warning" | "danger", for the countdown badge. */
  tone: "neutral" | "warning" | "danger";
}

type DepositLease = Pick<
  Tables<"leases">,
  "surrender_date" | "forwarding_address_received_at" | "deposit_due_date" | "deposit_settled_at"
>;

export function depositClock(lease: DepositLease, today = todayIso()): DepositClock {
  if (lease.deposit_settled_at) {
    return {
      stage: "settled",
      dueDate: lease.deposit_due_date,
      daysRemaining: null,
      tone: "neutral",
    };
  }
  if (!lease.surrender_date) {
    return { stage: "active", dueDate: null, daysRemaining: null, tone: "neutral" };
  }
  if (!lease.forwarding_address_received_at) {
    // Deliberately not a countdown: the statute's clock has not started, and
    // showing "30 days left" here would be wrong in the dangerous direction.
    return { stage: "awaiting_forwarding", dueDate: null, daysRemaining: null, tone: "warning" };
  }

  const dueDate = lease.deposit_due_date ?? depositDueDate(lease.forwarding_address_received_at);
  const daysRemaining = daysBetween(today, dueDate);
  if (daysRemaining < 0) return { stage: "overdue", dueDate, daysRemaining, tone: "danger" };
  return {
    stage: "running",
    dueDate,
    daysRemaining,
    tone:
      daysRemaining <= DEPOSIT_RED_DAYS
        ? "danger"
        : daysRemaining <= DEPOSIT_AMBER_DAYS
          ? "warning"
          : "neutral",
  };
}

/** Anything a manager has to act on: the dashboard card and the report. */
export function needsAttention(clock: DepositClock) {
  return clock.stage === "awaiting_forwarding" || clock.stage === "running"
    ? true
    : clock.stage === "overdue";
}
