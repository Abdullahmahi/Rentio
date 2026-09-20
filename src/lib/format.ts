/**
 * El Paso is in the MOUNTAIN time zone — the only major Texas city that is.
 * Every "is this late?" question in the app is a calendar-day question in this
 * zone. Neither the browser's local zone nor raw UTC answers it correctly, so
 * everything that compares a date to "today" goes through here.
 */
export const APP_TIMEZONE = "America/Denver";

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * mm/dd/yyyy.
 *
 * A bare `YYYY-MM-DD` is a calendar date, not an instant — `new Date()` reads
 * it as UTC midnight, which renders as the *previous* day anywhere west of
 * Greenwich. Every `date` column in this schema hit that. Those are formatted
 * verbatim; real timestamps are converted into the app timezone.
 */
export function formatDate(value: Date | string | number) {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    const [year, month, day] = value.split("-");
    return `${month}/${day}/${year}`;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    timeZone: APP_TIMEZONE,
  }).format(new Date(value));
}

/** Today's calendar date in El Paso, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: APP_TIMEZONE,
  }).format(now);
}

/** A `YYYY-MM-DD` as a Date pinned to local noon — safe for day arithmetic. */
export function parseIsoDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12, 0, 0, 0);
}

/** Whole calendar days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string) {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

export function addDays(iso: string, days: number) {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}
