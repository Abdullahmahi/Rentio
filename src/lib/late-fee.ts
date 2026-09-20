/**
 * Texas Property Code §92.019 — residential late fees.
 *
 * Every rule lives here so the lease form, the invoice action and the
 * dashboard cannot disagree about what is lawful. This is a build
 * specification, not legal advice; have the client's attorney review it.
 */
import { addDays, daysBetween, todayIso } from "@/lib/format";
import type { Tables } from "@/lib/database.types";

/**
 * §92.019(a): a late fee may not be charged unless the rent remains unpaid
 * at the end of the second full day after it was due. Two days is therefore
 * the floor, whatever a manager types in.
 */
export const MINIMUM_GRACE_DAYS = 2;

/**
 * §92.019(a-1): presumed reasonable at 12% of one month's rent for a dwelling
 * in a structure of 4 or fewer units, 10% for a larger structure.
 */
export const SMALL_STRUCTURE_CAP_PERCENT = 12;
export const LARGE_STRUCTURE_CAP_PERCENT = 10;
export const SMALL_STRUCTURE_MAX_UNITS = 4;

export function capPercentFor(unitsInStructure: number | null | undefined) {
  // Unknown structure size takes the stricter cap. Guessing 12% and being
  // wrong is the expensive direction.
  if (!unitsInStructure) return LARGE_STRUCTURE_CAP_PERCENT;
  return unitsInStructure <= SMALL_STRUCTURE_MAX_UNITS
    ? SMALL_STRUCTURE_CAP_PERCENT
    : LARGE_STRUCTURE_CAP_PERCENT;
}

/**
 * How many dwelling units are in the physical structure. `units_in_structure`
 * wins when set, because an app "property" may be several separate buildings
 * and only a human knows that.
 */
export function unitsInStructure(
  property: Pick<Tables<"properties">, "units_in_structure"> | undefined,
  unitCountOnProperty: number,
) {
  return property?.units_in_structure ?? unitCountOnProperty ?? 0;
}

export interface LateFeeTerms {
  late_fee_type: Tables<"leases">["late_fee_type"];
  late_fee_percent: number;
  late_fee_amount: number;
  rent_amount: number;
}

/** The dollar amount this lease's late fee works out to. */
export function lateFeeAmount(terms: LateFeeTerms) {
  const value =
    terms.late_fee_type === "percent"
      ? (Number(terms.rent_amount) * Number(terms.late_fee_percent)) / 100
      : Number(terms.late_fee_amount);
  return Math.round(value * 100) / 100;
}

/** The same fee expressed as a percentage of one month's rent. */
export function lateFeePercentOfRent(terms: LateFeeTerms) {
  const rent = Number(terms.rent_amount);
  if (rent <= 0) return 0;
  return (lateFeeAmount(terms) / rent) * 100;
}

export function exceedsCap(terms: LateFeeTerms, capPercent: number) {
  // A hundredth of a percent of slack, so 10.00% configured against 10% does
  // not trip on a rounding artefact.
  return lateFeePercentOfRent(terms) > capPercent + 0.005;
}

/**
 * The first date a late fee may lawfully be applied: the day AFTER the second
 * full day following the due date. A lease may set a longer grace period, and
 * the longer of the two wins.
 */
export function lateFeeEligibleFrom(dueDate: string, graceDays: number) {
  return addDays(dueDate, Math.max(graceDays, MINIMUM_GRACE_DAYS) + 1);
}

export interface LateFeeEligibility {
  /** True once the fee may lawfully be applied. */
  eligible: boolean;
  /** The date it becomes available, for the tooltip. */
  eligibleFrom: string;
  /** Days still to wait. Zero or negative once eligible. */
  daysRemaining: number;
}

export function lateFeeEligibility(
  dueDate: string,
  graceDays: number,
  today = todayIso(),
): LateFeeEligibility {
  const eligibleFrom = lateFeeEligibleFrom(dueDate, graceDays);
  const daysRemaining = daysBetween(today, eligibleFrom);
  return { eligible: daysRemaining <= 0, eligibleFrom, daysRemaining };
}
