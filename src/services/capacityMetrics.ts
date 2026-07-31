/**
 * Single source of truth for the capacity metrics. Three distinct concepts
 * that were previously conflated:
 *
 * - Auslastung: planned hours as a share of the available (effective)
 *   capacity. Purely "how full is the calendar".
 * - Kundenziel-Erfüllung: planned hours as a share of the Kunden-Ziel
 *   (targetHours = effectiveCapacity × Kunden %). 100 % = exactly on target.
 * - Überbucht: the confirmed business rule — a user is overbooked when the
 *   planned time exceeds the Kunden-Ziel share of their available time.
 *   Example: Kunden % = 70, planned = 77 % of available time → überbucht.
 * - Über Kapazität: the extreme case — planned exceeds the full available
 *   capacity (>100 % Auslastung). Physically impossible to work off.
 */

/** Planned / effective capacity × 100. Degenerate guard: a fully absent user
 * with planning reads exactly 100 %, not infinity. */
export function auslastungPercent(
  plannedHours: number,
  effectiveCapacityHours: number,
): number {
  if (effectiveCapacityHours > 0) {
    return (plannedHours / effectiveCapacityHours) * 100;
  }
  return plannedHours > 0 ? 100 : 0;
}

/** Planned / Kunden-Ziel hours × 100 (100 % = exactly on target). */
export function kundenzielPercent(
  plannedHours: number,
  targetHours: number,
): number {
  if (targetHours > 0) {
    return (plannedHours / targetHours) * 100;
  }
  return plannedHours > 0 ? 100 : 0;
}

/**
 * Überbucht: planned time exceeds the Kunden-Ziel share of available time.
 * No targetHours > 0 guard on purpose: a fully absent user with planned hours
 * (or a 0 %-goal user with any planning) counts as overbooked too.
 */
export function isOverbooked(
  plannedHours: number,
  targetHours: number,
): boolean {
  return plannedHours > targetHours;
}

/** Über Kapazität: planned time exceeds the full available capacity. */
export function isOverCapacity(
  plannedHours: number,
  effectiveCapacityHours: number,
): boolean {
  return plannedHours > effectiveCapacityHours;
}
