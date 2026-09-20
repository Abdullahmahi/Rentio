/**
 * Texas Property Code obligations around repairs, notices and turnover.
 *
 * Build specification, not legal advice. Have the client's attorney review
 * the notice template before it is served on a real tenant.
 */
import { addDays, daysBetween, todayIso } from "@/lib/format";
import type { Enums } from "@/lib/database.types";

/** §92.056: 7 days is presumed a reasonable time to repair. */
export const REPAIR_WINDOW_DAYS = 7;
export const REPAIR_AMBER_DAY = 5;

/** §92.156: security devices must be rekeyed by the 7th day of possession. */
export const REKEY_WINDOW_DAYS = 7;

/**
 * §24.005: absent a longer period in the lease, 3 days' notice to vacate is
 * the statutory default.
 */
export const DEFAULT_VACATE_NOTICE_DAYS = 3;

export interface RepairClock {
  /** 1-based day within the window. Day 1 is the day notice was given. */
  day: number;
  overdue: boolean;
  tone: "neutral" | "warning" | "danger";
}

/**
 * Where a health-and-safety repair sits against its 7-day window.
 * `writtenNoticeAt` is a timestamp; the window is counted in calendar days.
 */
export function repairClock(
  writtenNoticeAt: string,
  today = todayIso(),
  resolvedAt: string | null = null,
): RepairClock {
  const from = writtenNoticeAt.slice(0, 10);
  const to = (resolvedAt ?? today).slice(0, 10);
  const day = daysBetween(from, to) + 1;
  const overdue = day > REPAIR_WINDOW_DAYS;
  return {
    day,
    overdue,
    tone: overdue ? "danger" : day >= REPAIR_AMBER_DAY ? "warning" : "neutral",
  };
}

/** Days left to rekey, counted from the day the tenant took possession. */
export function rekeyDeadline(leaseStartDate: string) {
  return addDays(leaseStartDate, REKEY_WINDOW_DAYS);
}

export function rekeyClock(leaseStartDate: string, today = todayIso()) {
  const deadline = rekeyDeadline(leaseStartDate);
  const daysRemaining = daysBetween(today, deadline);
  return { deadline, daysRemaining, overdue: daysRemaining < 0 };
}

/**
 * The move-in checklist created when a lease is activated. `item_key` is
 * stable so the rekey row stays identifiable and re-running is idempotent.
 */
export const TURNOVER_ITEMS = [
  "rekey_locks",
  "test_smoke_alarms",
  "verify_deadbolt_keyless",
  "verify_window_latches",
  "document_condition_photos",
  "collect_renters_insurance",
] as const;

export type TurnoverItemKey = (typeof TURNOVER_ITEMS)[number];

export const REKEY_ITEM_KEY: TurnoverItemKey = "rekey_locks";

/**
 * English fallback labels. The UI renders `turnover.items.<key>` from the
 * locale files; this is what lands in the `item` column so a raw row, a CSV
 * export or a database query still reads as something.
 */
const TURNOVER_LABELS: Record<TurnoverItemKey, string> = {
  rekey_locks: "Rekey locks (required within 7 days)",
  test_smoke_alarms: "Test smoke alarms",
  verify_deadbolt_keyless: "Verify deadbolt and keyless bolting device",
  verify_window_latches: "Verify window latches",
  document_condition_photos: "Document unit condition with photos",
  collect_renters_insurance: "Collect renters insurance certificate",
};

/** The rows to insert when a lease is activated. Safe to upsert twice. */
export function turnoverRowsFor(unitId: string, leaseId: string) {
  return TURNOVER_ITEMS.map((key, index) => ({
    unit_id: unitId,
    lease_id: leaseId,
    item_key: key,
    item: TURNOVER_LABELS[key],
    position: index,
  }));
}

export type NoticeType = Enums<"notice_type">;
export type NoticeDelivery = Enums<"notice_delivery">;

export const NOTICE_TYPES: NoticeType[] = ["non_payment", "lease_violation", "end_of_term"];
export const NOTICE_DELIVERY: NoticeDelivery[] = ["in_person", "mail", "affixed_to_door"];

/** The default vacate date offered on the form. */
export function defaultVacateDate(today = todayIso()) {
  return addDays(today, DEFAULT_VACATE_NOTICE_DAYS);
}
