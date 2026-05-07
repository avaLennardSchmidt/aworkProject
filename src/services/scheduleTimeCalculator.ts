import {
  addMinutes,
  differenceInMinutes,
  format,
  getISOWeek,
  isValid,
  parse,
  parseISO,
  set,
} from "date-fns";
import type { AworkTaskSchedule } from "../types/awork";

export function getTimeHHmm(iso: string): string {
  return format(parseISO(iso), "HH:mm");
}

export function setTimeOnSameDate(iso: string, hhmm: string): string {
  const original = parseISO(iso);
  const parsedTime = parse(hhmm, "HH:mm", original);

  if (!isValid(original) || !isValid(parsedTime)) {
    throw new Error("Invalid date or time value.");
  }

  const updated = set(original, {
    hours: parsedTime.getHours(),
    minutes: parsedTime.getMinutes(),
    seconds: 0,
    milliseconds: 0,
  });

  return toLocalIsoWithOffset(updated);
}

export function calculateDurationMinutes(startIso: string, endIso: string): number {
  return differenceInMinutes(parseISO(endIso), parseISO(startIso));
}

export function formatMinutesAsHours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;

  if (remainder === 0) {
    return `${sign}${hours}h`;
  }

  if (hours === 0) {
    return `${sign}${remainder}m`;
  }

  return `${sign}${hours}h ${remainder}m`;
}

export function buildUpdatedTimeWindow(
  schedule: AworkTaskSchedule,
  newStartTime: string,
  newEndTime: string,
): { newStartIso: string; newEndIso: string } {
  return {
    newStartIso: setTimeOnSameDate(schedule.start, newStartTime),
    newEndIso: setTimeOnSameDate(schedule.end, newEndTime),
  };
}

export function buildUpdatedTimeWindowKeepStart(
  schedule: AworkTaskSchedule,
  newDurationMinutes: number,
): { newStartIso: string; newEndIso: string } {
  const start = parseISO(schedule.start);
  const end = addMinutes(start, newDurationMinutes);

  return {
    newStartIso: toLocalIsoWithOffset(start),
    newEndIso: toLocalIsoWithOffset(end),
  };
}

export function buildUpdatedTimeWindowKeepEnd(
  schedule: AworkTaskSchedule,
  newDurationMinutes: number,
): { newStartIso: string; newEndIso: string } {
  const end = parseISO(schedule.end);
  const start = addMinutes(end, -newDurationMinutes);

  return {
    newStartIso: toLocalIsoWithOffset(start),
    newEndIso: toLocalIsoWithOffset(end),
  };
}

export function formatScheduleDateLabel(iso: string): string {
  const date = parseISO(iso);
  return `KW ${getISOWeek(date)} ${format(date, "EEEE, dd.MM.yyyy")}`;
}

export function formatDate(iso: string): string {
  return format(parseISO(iso), "dd.MM.yyyy");
}

export function isSameLocalDate(firstIso: string, secondIso: string): boolean {
  return format(parseISO(firstIso), "yyyy-MM-dd") === format(parseISO(secondIso), "yyyy-MM-dd");
}

function toLocalIsoWithOffset(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ssxxx");
}
