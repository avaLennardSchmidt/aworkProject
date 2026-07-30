/**
 * Shared helpers for making capacity project segments open the project detail
 * modal. Kept in its own module so both CapacityAnalysisPage and
 * CapacityTableView can import them without a circular dependency.
 */

/** A capacity segment's project id, or undefined when unresolved (not clickable). */
export function capacityProjectId(key: string | undefined): string | undefined {
  return key && key !== "unresolved-project" ? key : undefined;
}

/** Tooltip hint appended to clickable capacity segments. */
export const CAPACITY_DETAIL_HINT = "Klicken für Projektdetails";
