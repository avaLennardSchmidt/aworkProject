import { formatMinutesAsHours } from "./scheduleTimeCalculator";

/** Format an awork ISO date/datetime as dd.MM.yyyy, or undefined if invalid. */
export function formatDetailDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

/** Format an awork duration in seconds as a compact hours string (e.g. "1,5h"). */
export function formatDetailHours(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return undefined;
  }
  return formatMinutesAsHours(Math.round(seconds / 60));
}
