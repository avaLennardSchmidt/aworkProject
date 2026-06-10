import { addDays, getDay, parseISO, startOfDay } from "date-fns";
import type { AworkAbsence } from "../types/awork";

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

export function calculateAbsentWorkingDays(
  absences: AworkAbsence[],
  userId: string,
  weekFrom: Date,
  weekTo: Date,
): number {
  let totalDays = 0;

  for (const absence of absences) {
    if (absence.userId !== userId) continue;

    const absenceStart = startOfDay(parseISO(absence.startOn));
    const absenceEnd = startOfDay(parseISO(absence.endOn));

    const overlapStart = absenceStart < weekFrom ? weekFrom : absenceStart;
    const overlapEnd = absenceEnd > weekTo ? weekTo : absenceEnd;
    if (overlapStart > overlapEnd) continue;

    let day = startOfDay(overlapStart);
    while (day <= overlapEnd) {
      const dow = getDay(day);
      if (dow >= 1 && dow <= 5) {
        let fraction = 1.0;
        const isFirstDay = day.getTime() === absenceStart.getTime();
        const isLastDay = day.getTime() === absenceEnd.getTime();
        if (absence.isHalfDayOnStart && isFirstDay) fraction -= 0.5;
        if (absence.isHalfDayOnEnd && isLastDay) fraction -= 0.5;
        totalDays += Math.max(0, fraction);
      }
      day = addDays(day, 1);
    }
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
