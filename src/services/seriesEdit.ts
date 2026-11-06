import { addMinutes, format, getDay, parseISO } from "date-fns";
import type { AworkTaskSchedule, AworkUser } from "../types/awork";
import type { BlockerOperation, ScheduleGroup } from "../types/planner";
import { isOwnSchedule } from "./scheduleMapper";
import {
  calculateDurationMinutes,
  formatScheduleDateLabel,
  getTimeHHmm,
  setTimeOnSameDate,
  setWeekdayPreservingTime,
  shiftIsoByDays,
} from "./scheduleTimeCalculator";

/**
 * Everything the "Serie bearbeiten" dialog lets the user set for one or more
 * series. Empty strings mean "leave as it is" for that value.
 */
export interface SeriesEditDraft {
  weekday: string;
  startTime: string;
  endTime: string;
  direction: ShiftDirection;
  weeks: string;
  days: string;
  hours: string;
  minutes: string;
  until: string;
}

export type ShiftDirection = "later" | "earlier";

export interface SeriesGroupPlan {
  group: ScheduleGroup;
  oldPattern: string;
  newPattern: string;
  patternChanged: boolean;
  updatedCount: number;
  createdDates: string[];
  deletedDates: string[];
}

export interface SeriesEditPlan {
  operations: BlockerOperation[];
  groups: SeriesGroupPlan[];
  error: string;
}

/** Upper bound for blockers one "Laufzeit" change may create per series. */
const MAX_CREATED_PER_SERIES = 260;

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Montag" },
  { value: 2, label: "Dienstag" },
  { value: 3, label: "Mittwoch" },
  { value: 4, label: "Donnerstag" },
  { value: 5, label: "Freitag" },
  { value: 6, label: "Samstag" },
  { value: 0, label: "Sonntag" },
];

/**
 * Pre-fills weekday, start and end with the value all selected series share.
 * A value the series do not share stays empty and is shown as "unterschiedlich".
 */
export function getInitialSeriesDraft(groups: ScheduleGroup[]): SeriesEditDraft {
  return {
    weekday: sharedValue(groups.map((group) => String(group.weekday))),
    startTime: sharedValue(groups.map((group) => group.startTime)),
    endTime: sharedValue(groups.map((group) => group.endTime)),
    direction: "later",
    weeks: "0",
    days: "0",
    hours: "0",
    minutes: "0",
    until: "",
  };
}

export function hasShift(draft: SeriesEditDraft): boolean {
  const { days, minutes } = getShift(draft);
  return days !== 0 || minutes !== 0;
}

/** Shift as whole calendar days plus minutes, signed by the direction. */
export function getShift(draft: SeriesEditDraft): { days: number; minutes: number } {
  const sign = draft.direction === "later" ? 1 : -1;
  const days = toCount(draft.weeks) * 7 + toCount(draft.days);
  const minutes = toCount(draft.hours) * 60 + toCount(draft.minutes);
  return { days: sign * days, minutes: sign * minutes };
}

/** "1 h 30 min später", or "keine Änderung" when nothing is set. */
export function describeShift(draft: SeriesEditDraft): string {
  const parts: string[] = [];
  const weeks = toCount(draft.weeks);
  const days = toCount(draft.days);
  const hours = toCount(draft.hours);
  const minutes = toCount(draft.minutes);
  if (weeks) parts.push(`${weeks} ${weeks === 1 ? "Woche" : "Wochen"}`);
  if (days) parts.push(`${days} ${days === 1 ? "Tag" : "Tage"}`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (parts.length === 0) return "keine Änderung";
  return `${parts.join(" ")} ${draft.direction === "later" ? "später" : "früher"}`;
}

export function formatPattern(weekday: number, startTime: string, endTime: string): string {
  return `${WEEKDAY_SHORT[weekday] ?? "?"} ${startTime}–${endTime}`;
}

/**
 * Turns the dialog values into blocker operations for every selected series.
 *
 * Weekday, start and end are applied only where the user changed them against
 * `initial`, so blockers that were moved one by one keep their own times.
 * Then the shift is applied: whole days move the calendar date (the wall-clock
 * time stays the same across daylight-saving changes), hours and minutes move
 * the time. Finally "until" cuts blockers after that date and continues the
 * series weekly up to it, with the time of its last blocker.
 */
export function planSeriesEdit(
  groups: ScheduleGroup[],
  draft: SeriesEditDraft,
  initial: SeriesEditDraft,
  currentUser: AworkUser,
): SeriesEditPlan {
  const operations: BlockerOperation[] = [];
  const plans: SeriesGroupPlan[] = [];
  let error = "";

  const shift = getShift(draft);
  const weekday = draft.weekday !== initial.weekday && draft.weekday !== "" ? Number(draft.weekday) : undefined;
  const startTime = draft.startTime !== initial.startTime && draft.startTime !== "" ? draft.startTime : undefined;
  const endTime = draft.endTime !== initial.endTime && draft.endTime !== "" ? draft.endTime : undefined;

  for (const group of groups) {
    const transformed = group.schedules.map((schedule) => ({
      schedule,
      ...transformSchedule(schedule, { weekday, startTime, endTime, shift }),
    }));

    if (transformed.some((item) => calculateDurationMinutes(item.startIso, item.endIso) <= 0)) {
      error ||= "Die Startzeit muss vor der Endzeit liegen.";
    }
    if (group.schedules.some((schedule) => !isOwnSchedule(schedule, currentUser))) {
      error ||= "Berechtigung konnte nicht für jeden Blocker geprüft werden.";
    }

    const kept = draft.until ? transformed.filter((item) => dateKey(item.startIso) <= draft.until) : transformed;
    const removed = draft.until ? transformed.filter((item) => dateKey(item.startIso) > draft.until) : [];

    let updatedCount = 0;
    for (const item of kept) {
      if (item.startIso === item.schedule.start && item.endIso === item.schedule.end) continue;
      updatedCount += 1;
      operations.push(buildUpdateOperation(item.schedule, item.startIso, item.endIso));
    }
    for (const item of removed) {
      operations.push(buildDeleteOperation(item.schedule));
    }

    const createdDates: string[] = [];
    const last = latest(transformed);
    if (draft.until && last && dateKey(last.startIso) < draft.until) {
      for (let week = 1; week <= MAX_CREATED_PER_SERIES; week += 1) {
        const startIso = shiftIsoByDays(last.startIso, week * 7);
        if (dateKey(startIso) > draft.until) break;
        const endIso = shiftIsoByDays(last.endIso, week * 7);
        createdDates.push(dateKey(startIso));
        operations.push(buildCreateOperation(group.taskId, currentUser.id, startIso, endIso));
        if (week === MAX_CREATED_PER_SERIES) {
          error ||= `Pro Serie können höchstens ${MAX_CREATED_PER_SERIES} Blocker auf einmal angelegt werden.`;
        }
      }
    }

    const oldPattern = formatPattern(group.weekday, group.startTime, group.endTime);
    const sample = transformed[0];
    const newPattern = sample
      ? formatPattern(getDay(parseISO(sample.startIso)), getTimeHHmm(sample.startIso), getTimeHHmm(sample.endIso))
      : oldPattern;

    plans.push({
      group,
      oldPattern,
      newPattern,
      patternChanged: newPattern !== oldPattern,
      updatedCount,
      createdDates,
      deletedDates: removed.map((item) => dateKey(item.startIso)),
    });
  }

  return { operations, groups: plans, error };
}

/** Delete operations for every blocker of the given series. */
export function buildUnplanOperations(groups: ScheduleGroup[]): BlockerOperation[] {
  return groups.flatMap((group) => group.schedules.map(buildDeleteOperation));
}

export function buildDeleteOperation(schedule: AworkTaskSchedule): BlockerOperation {
  return {
    kind: "delete",
    schedule,
    dateLabel: formatScheduleDateLabel(schedule.start),
    oldStart: getTimeHHmm(schedule.start),
    oldEnd: getTimeHHmm(schedule.end),
    beforeMinutes: calculateDurationMinutes(schedule.start, schedule.end),
  };
}

export function buildUpdateOperation(
  schedule: AworkTaskSchedule,
  newStartIso: string,
  newEndIso: string,
): BlockerOperation {
  return {
    kind: "update",
    schedule,
    dateLabel: formatScheduleDateLabel(schedule.start),
    newDateLabel: formatScheduleDateLabel(newStartIso),
    oldStart: getTimeHHmm(schedule.start),
    oldEnd: getTimeHHmm(schedule.end),
    newStart: getTimeHHmm(newStartIso),
    newEnd: getTimeHHmm(newEndIso),
    newStartIso,
    newEndIso,
    beforeMinutes: calculateDurationMinutes(schedule.start, schedule.end),
    afterMinutes: calculateDurationMinutes(newStartIso, newEndIso),
  };
}

export function buildCreateOperation(
  taskId: string,
  userId: string,
  startIso: string,
  endIso: string,
): BlockerOperation {
  const minutes = calculateDurationMinutes(startIso, endIso);
  return {
    kind: "create",
    tempId: `new-${taskId}-${startIso}`,
    taskId,
    dateLabel: formatScheduleDateLabel(startIso),
    newStart: getTimeHHmm(startIso),
    newEnd: getTimeHHmm(endIso),
    payload: {
      taskId,
      userId,
      startDate: startIso,
      endDate: endIso,
      plannedDuration: Math.max(0, minutes * 60),
    },
    afterMinutes: minutes,
  };
}

export function dateKey(iso: string): string {
  return format(parseISO(iso), "yyyy-MM-dd");
}

function transformSchedule(
  schedule: AworkTaskSchedule,
  options: {
    weekday?: number;
    startTime?: string;
    endTime?: string;
    shift: { days: number; minutes: number };
  },
): { startIso: string; endIso: string } {
  let startIso = schedule.start;
  let endIso = schedule.end;

  if (options.weekday !== undefined) {
    startIso = setWeekdayPreservingTime(startIso, options.weekday);
    endIso = setWeekdayPreservingTime(endIso, options.weekday);
  }
  if (options.startTime) startIso = setTimeOnSameDate(startIso, options.startTime);
  if (options.endTime) endIso = setTimeOnSameDate(endIso, options.endTime);
  if (options.shift.days) {
    startIso = shiftIsoByDays(startIso, options.shift.days);
    endIso = shiftIsoByDays(endIso, options.shift.days);
  }
  if (options.shift.minutes) {
    startIso = addMinutesIso(startIso, options.shift.minutes);
    endIso = addMinutesIso(endIso, options.shift.minutes);
  }

  return { startIso, endIso };
}

function addMinutesIso(iso: string, minutes: number): string {
  return format(addMinutes(parseISO(iso), minutes), "yyyy-MM-dd'T'HH:mm:ssxxx");
}

function latest<T extends { startIso: string }>(items: T[]): T | undefined {
  return items.reduce<T | undefined>(
    (best, item) => (!best || parseISO(item.startIso) > parseISO(best.startIso) ? item : best),
    undefined,
  );
}

function sharedValue(values: string[]): string {
  return values.length > 0 && values.every((value) => value === values[0]) ? values[0] : "";
}

function toCount(value: string): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
