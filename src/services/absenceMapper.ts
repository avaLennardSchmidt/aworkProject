import { addDays, getDay, parseISO, startOfDay } from "date-fns";
import type { AworkAbsence } from "../types/awork";

// awork encodes absence boundaries as UTC timestamps on the intended calendar
// day (e.g. endOn "2026-07-15T23:59:59Z"). Parsing them as local timestamps
// shifts the end into the next local day east of UTC, inflating every absence
// by one day — so only the UTC date portion may be used.
function parseAworkAbsenceDay(isoTimestamp: string): Date {
  return startOfDay(parseISO(isoTimestamp.slice(0, 10)));
}

export function mapAbsencesResponse(raw: unknown): AworkAbsence[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const absence = mapAbsence(item);
    return absence ? [absence] : [];
  });
}

export function groupAbsencesByUserId(absences: AworkAbsence[]): Record<string, AworkAbsence[]> {
  const grouped: Record<string, AworkAbsence[]> = {};
  for (const absence of absences) {
    if (!absence.userId) continue;
    (grouped[absence.userId] ??= []).push(absence);
  }
  return grouped;
}

export function countWorkingDaysInRange(from: Date, to: Date): number {
  let count = 0;
  let day = startOfDay(from);
  const end = startOfDay(to);
  while (day <= end) {
    const dow = getDay(day);
    if (dow >= 1 && dow <= 5) count++;
    day = addDays(day, 1);
  }
  return count;
}

export function calculateAbsentFractionForDay(
  absences: AworkAbsence[],
  userId: string,
  day: Date,
): number {
  const dow = getDay(day);
  if (dow < 1 || dow > 5) return 0;

  const dayStart = startOfDay(day);
  let totalFraction = 0;

  for (const absence of absences) {
    if (absence.userId !== userId) continue;

    const absenceStart = parseAworkAbsenceDay(absence.startOn);
    const absenceEnd = parseAworkAbsenceDay(absence.endOn);
    if (dayStart < absenceStart || dayStart > absenceEnd) continue;

    let fraction = 1.0;
    const isFirstDay = dayStart.getTime() === absenceStart.getTime();
    const isLastDay = dayStart.getTime() === absenceEnd.getTime();
    if (absence.isHalfDayOnStart && isFirstDay) fraction -= 0.5;
    if (absence.isHalfDayOnEnd && isLastDay) fraction -= 0.5;
    totalFraction += Math.max(0, fraction);
  }

  return totalFraction;
}

export type AbsentDayHalf = "morning" | "afternoon" | null;

// For a half-day absence, awork encodes which half in the UTC time portion:
// 00:00–12:00Z is the morning, 12:00–23:59Z the afternoon. Returns which half
// of `day` is absent, or null when the day is fully absent, not absent, or
// the covered interval doesn't line up with a clear half.
export function getAbsentHalfForDay(
  absences: AworkAbsence[],
  userId: string,
  day: Date,
): AbsentDayHalf {
  const dow = getDay(day);
  if (dow < 1 || dow > 5) return null;

  const dayStart = startOfDay(day);
  let half: AbsentDayHalf = null;
  let totalFraction = 0;

  for (const absence of absences) {
    if (absence.userId !== userId) continue;

    const absenceStart = parseAworkAbsenceDay(absence.startOn);
    const absenceEnd = parseAworkAbsenceDay(absence.endOn);
    if (dayStart < absenceStart || dayStart > absenceEnd) continue;

    let fraction = 1.0;
    const isFirstDay = dayStart.getTime() === absenceStart.getTime();
    const isLastDay = dayStart.getTime() === absenceEnd.getTime();
    if (absence.isHalfDayOnStart && isFirstDay) fraction -= 0.5;
    if (absence.isHalfDayOnEnd && isLastDay) fraction -= 0.5;
    fraction = Math.max(0, fraction);
    totalFraction += fraction;

    if (fraction === 0.5) {
      const startHour = isFirstDay ? readUtcHour(absence.startOn, 0) : 0;
      const endHour = isLastDay ? readUtcHour(absence.endOn, 24) : 24;
      if (startHour >= 12) half = "afternoon";
      else if (endHour <= 12) half = "morning";
    }
  }

  return totalFraction === 0.5 ? half : null;
}

function readUtcHour(isoTimestamp: string, fallback: number): number {
  const hour = Number.parseInt(isoTimestamp.slice(11, 13), 10);
  return Number.isNaN(hour) ? fallback : hour;
}

export function calculateAbsentWorkingDays(
  absences: AworkAbsence[],
  userId: string,
  weekFrom: Date,
  weekTo: Date,
): number {
  let totalDays = 0;
  let day = startOfDay(weekFrom);
  const end = startOfDay(weekTo);
  while (day <= end) {
    totalDays += calculateAbsentFractionForDay(absences, userId, day);
    day = addDays(day, 1);
  }
  return totalDays;
}

function mapAbsence(raw: unknown): AworkAbsence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const startOn = typeof r.startOn === "string" ? r.startOn : null;
  const endOn = typeof r.endOn === "string" ? r.endOn : null;
  if (!id || !startOn || !endOn) return null;
  return {
    id,
    userId: typeof r.userId === "string" ? r.userId : null,
    startOn,
    endOn,
    isHalfDayOnStart: r.isHalfDayOnStart === true,
    isHalfDayOnEnd: r.isHalfDayOnEnd === true,
  };
}
