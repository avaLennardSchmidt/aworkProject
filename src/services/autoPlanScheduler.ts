import {
  addDays,
  eachDayOfInterval,
  format,
  getDay,
  isAfter,
  parseISO,
  set,
  startOfWeek,
  startOfDay,
} from "date-fns";
import type {
  AworkTaskSchedule,
  AworkUser,
  AworkUserCapacity,
  CreateTaskSchedulePayload,
} from "../types/awork";

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface PayloadOverlap {
  payload: CreateTaskSchedulePayload;
  overlaps: AworkTaskSchedule[];
}

export type AutoPlanDistributionMode = "packed" | "even";

export interface AutoPlanInput {
  currentUser: AworkUser;
  taskId: string;
  from: string;
  to: string;
  weekdayValues: number[];
  startTime: string;
  endTime: string;
  requestedMinutes: number;
  existingSchedules: AworkTaskSchedule[];
  userCapacity?: AworkUserCapacity;
  distributionMode?: AutoPlanDistributionMode;
  allowOverbooking?: boolean;
}

export interface AutoPlanDay {
  date: Date;
  existingSchedules: AworkTaskSchedule[];
  freeSlots: TimeSlot[];
  plannedPayloads: CreateTaskSchedulePayload[];
  capacityMinutes?: number;
  existingPlannedMinutes: number;
  availableMinutes: number;
  largestFreeSlotMinutes: number;
  plannedMinutes: number;
  skippedReason?: "full" | "not-needed";
}

export interface AutoPlanWeek {
  weekStart: Date;
  weekEnd: Date;
  requestedMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
  days: AutoPlanDay[];
}

export interface AutoPlanResult {
  requestedMinutes: number;
  weeklyRequestedMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
  payloads: CreateTaskSchedulePayload[];
  weeks: AutoPlanWeek[];
  days: AutoPlanDay[];
  skippedDays: Array<{
    date: Date;
    reason: "full" | "not-needed";
  }>;
}

export const MIN_AUTO_PLAN_BLOCKER_MINUTES = 30;

const WEEKDAY_KEYS: Record<number, keyof NonNullable<AworkUserCapacity["weeklyCapacity"]>> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

export function findPayloadOverlaps(
  payloads: CreateTaskSchedulePayload[],
  existingSchedules: AworkTaskSchedule[],
): PayloadOverlap[] {
  return payloads
    .map((payload) => ({
      payload,
      overlaps: existingSchedules.filter((schedule) =>
        intervalsOverlap(
          parseISO(payload.startDate),
          parseISO(payload.endDate),
          parseISO(schedule.start),
          parseISO(schedule.end),
        ),
      ),
    }))
    .filter((entry) => entry.overlaps.length > 0);
}

export function buildAutoPlan(input: AutoPlanInput): AutoPlanResult {
  const selectedWeekdays = new Set(input.weekdayValues);
  const weeklyRequestedMinutes = Math.max(0, Math.round(input.requestedMinutes));
  const distributionMode = input.distributionMode ?? "packed";
  const startDate = parseISO(input.from);
  const endDate = parseISO(input.to);

  if (
    !input.taskId ||
    !input.from ||
    !input.to ||
    !input.startTime ||
    !input.endTime ||
    weeklyRequestedMinutes < MIN_AUTO_PLAN_BLOCKER_MINUTES ||
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    isAfter(startDate, endDate)
  ) {
    return emptyAutoPlan(weeklyRequestedMinutes);
  }

  const allDays = eachDayOfInterval({ start: startDate, end: endDate })
    .filter((date) => selectedWeekdays.has(getDay(date)))
    .map((date) =>
      buildAutoPlanDay(
        input.currentUser,
        input.taskId,
        date,
        input.startTime,
        input.endTime,
        input.existingSchedules,
        input.userCapacity,
        input.allowOverbooking,
      ),
    );
  const weeksByKey = new Map<string, AutoPlanDay[]>();
  allDays.forEach((day) => {
    const weekStart = getIsoWeekStart(day.date);
    const weekKey = format(weekStart, "yyyy-MM-dd");
    weeksByKey.set(weekKey, [...(weeksByKey.get(weekKey) ?? []), day]);
  });

  const plannedPayloads: CreateTaskSchedulePayload[] = [];
  const plannedWeeks = [...weeksByKey.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([weekKey, weekDays]) => {
      let weekRemainingMinutes = weeklyRequestedMinutes;
      const candidateDays = weekDays
        .filter((day) => day.availableMinutes > 0)
        .sort((first, second) =>
          distributionMode === "even"
            ? first.date.getTime() - second.date.getTime()
            : second.availableMinutes - first.availableMinutes ||
              second.largestFreeSlotMinutes - first.largestFreeSlotMinutes ||
              first.date.getTime() - second.date.getTime(),
        );

      let remainingCandidateDays = candidateDays.length;
      const days = candidateDays.map((day) => {
        const plannedForDay: CreateTaskSchedulePayload[] = [];
        const targetMinutes =
          distributionMode === "even" && remainingCandidateDays > 0
            ? Math.ceil(weekRemainingMinutes / remainingCandidateDays)
            : weekRemainingMinutes;
        let dayRemaining = Math.min(targetMinutes, day.availableMinutes);
        const freeSlots = [...day.freeSlots].sort(
          (first, second) =>
            distributionMode === "even"
              ? first.start.getTime() - second.start.getTime()
              : getSlotMinutes(second) - getSlotMinutes(first) ||
                first.start.getTime() - second.start.getTime(),
        );

        for (const slot of freeSlots) {
          if (dayRemaining <= 0) {
            break;
          }

          const slotMinutes = getSlotMinutes(slot);
          const plannedMinutes = Math.min(slotMinutes, dayRemaining);
          if (plannedMinutes < MIN_AUTO_PLAN_BLOCKER_MINUTES) {
            continue;
          }

          const payload = buildPayload(
            input.currentUser,
            input.taskId,
            slot.start,
            addMinutes(slot.start, plannedMinutes),
          );
          plannedPayloads.push(payload);
          plannedForDay.push(payload);
          dayRemaining -= plannedMinutes;
          weekRemainingMinutes -= plannedMinutes;
        }
        remainingCandidateDays -= 1;

        return {
          ...day,
          plannedPayloads: plannedForDay.sort(
            (first, second) =>
              parseISO(first.startDate).getTime() -
              parseISO(second.startDate).getTime(),
          ),
          plannedMinutes: plannedForDay.reduce(
            (sum, payload) => sum + payload.plannedDuration / 60,
            0,
          ),
        };
      });

      const activeDays = days.filter(
        (day) => day.plannedPayloads.length > 0,
      );
      const plannedDateKeys = new Set(
        activeDays.map((day) => format(day.date, "yyyy-MM-dd")),
      );

      return {
        weekStart: parseISO(weekKey),
        weekEnd: addDays(parseISO(weekKey), 6),
        requestedMinutes: weeklyRequestedMinutes,
        plannedMinutes: weeklyRequestedMinutes - weekRemainingMinutes,
        remainingMinutes: weekRemainingMinutes,
        days: activeDays,
        skippedDays: [
          ...weekDays
            .filter(
              (day) =>
                day.availableMinutes === 0 && day.existingSchedules.length > 0,
            )
            .map((day) => ({ date: day.date, reason: "full" as const })),
          ...candidateDays
            .filter(
              (day) => !plannedDateKeys.has(format(day.date, "yyyy-MM-dd")),
            )
            .map((day) => ({ date: day.date, reason: "not-needed" as const })),
        ],
      };
    });

  const weeks: AutoPlanWeek[] = plannedWeeks.map(
    ({ skippedDays: _skippedDays, ...week }) => week,
  );
  const requestedMinutes = weeks.reduce(
    (sum, week) => sum + week.requestedMinutes,
    0,
  );
  const plannedMinutes = weeks.reduce(
    (sum, week) => sum + week.plannedMinutes,
    0,
  );
  const skippedDays = plannedWeeks
    .flatMap((week) => week.skippedDays)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    requestedMinutes,
    weeklyRequestedMinutes,
    plannedMinutes,
    remainingMinutes: requestedMinutes - plannedMinutes,
    payloads: plannedPayloads.sort(
      (first, second) =>
        parseISO(first.startDate).getTime() -
        parseISO(second.startDate).getTime(),
    ),
    weeks,
    days: weeks.flatMap((week) => week.days),
    skippedDays,
  };
}

export interface ProjectPlanTask {
  id: string;
  name?: string;
  startOn?: string;
  dueOn?: string;
  plannedDurationSeconds?: number;
  weeklyBudgetSeconds?: number;
}

export interface ProjectTaskPlanInput {
  currentUser: AworkUser;
  task: ProjectPlanTask;
  weekdayValues: number[];
  startTime: string;
  endTime: string;
  existingSchedules: AworkTaskSchedule[];
  userCapacity?: AworkUserCapacity;
  distributionMode?: AutoPlanDistributionMode;
  allowOverbooking?: boolean;
  /** yyyy-MM-dd fallback day when the task has neither start nor due date. */
  fallbackDate: string;
}

export interface ProjectTaskPlanResult {
  taskId: string;
  taskName?: string;
  requestedMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
  payloads: CreateTaskSchedulePayload[];
  isSingleDay: boolean;
  rangeStart: Date;
  rangeEnd: Date;
  overlaps: PayloadOverlap[];
  reason?: "no-duration";
}

/**
 * Plans a single project task across its due window. plannedDuration is treated
 * as a total budget. If weeklyBudgetSeconds is present, multi-day tasks receive
 * that amount per ISO week instead. A single-day task gets one block at the
 * window start; a multi-day total budget is filled front-loaded respecting
 * existing blockers and capacity.
 */
export function buildProjectTaskPlan(
  input: ProjectTaskPlanInput,
): ProjectTaskPlanResult {
  const startParsed = input.task.startOn ? parseISO(input.task.startOn) : null;
  const dueParsed = input.task.dueOn ? parseISO(input.task.dueOn) : null;
  const hasStart = !!startParsed && !Number.isNaN(startParsed.getTime());
  const hasDue = !!dueParsed && !Number.isNaN(dueParsed.getTime());
  const fallback = parseISO(input.fallbackDate);
  const distributionMode = input.distributionMode ?? "packed";

  const startSrc = hasStart ? startParsed! : hasDue ? dueParsed! : fallback;
  const dueSrc = hasDue ? dueParsed! : hasStart ? startParsed! : fallback;
  let rangeStart = startOfDay(startSrc);
  let rangeEnd = startOfDay(dueSrc);
  if (isAfter(rangeStart, rangeEnd)) {
    const swap = rangeStart;
    rangeStart = rangeEnd;
    rangeEnd = swap;
  }
  const isSingleDay =
    !(hasStart && hasDue) || rangeStart.getTime() === rangeEnd.getTime();
  const weeklyBudgetMinutes = Math.max(
    0,
    Math.round((input.task.weeklyBudgetSeconds ?? 0) / 60),
  );
  const usesWeeklyBudget = weeklyBudgetMinutes > 0;
  const requestedMinutes = usesWeeklyBudget
    ? weeklyBudgetMinutes * countIsoWeeksInRange(rangeStart, rangeEnd)
    : Math.max(0, Math.round((input.task.plannedDurationSeconds ?? 0) / 60));

  const base = {
    taskId: input.task.id,
    taskName: input.task.name,
    requestedMinutes,
    isSingleDay,
    rangeStart,
    rangeEnd,
  };

  if (requestedMinutes <= 0) {
    return {
      ...base,
      plannedMinutes: 0,
      remainingMinutes: 0,
      payloads: [],
      overlaps: [],
      reason: "no-duration",
    };
  }

  if (!isSingleDay && usesWeeklyBudget) {
    const result = buildAutoPlan({
      currentUser: input.currentUser,
      taskId: input.task.id,
      from: format(rangeStart, "yyyy-MM-dd"),
      to: format(rangeEnd, "yyyy-MM-dd"),
      weekdayValues: input.weekdayValues,
      startTime: input.startTime,
      endTime: input.endTime,
      requestedMinutes: weeklyBudgetMinutes,
      existingSchedules: input.existingSchedules,
      userCapacity: input.userCapacity,
      distributionMode,
      allowOverbooking: input.allowOverbooking,
    });

    return {
      ...base,
      requestedMinutes: result.requestedMinutes,
      plannedMinutes: result.plannedMinutes,
      remainingMinutes: result.remainingMinutes,
      payloads: result.payloads,
      overlaps: findPayloadOverlaps(result.payloads, input.existingSchedules),
    };
  }

  if (isSingleDay) {
    // One block on the due day (or the only known date), at the window start.
    const day = hasDue ? rangeEnd : rangeStart;
    const blockStart = setTime(day, input.startTime);
    const blockEnd = addMinutes(blockStart, requestedMinutes);
    const payload = buildPayload(
      input.currentUser,
      input.task.id,
      blockStart,
      blockEnd,
    );
    return {
      ...base,
      plannedMinutes: requestedMinutes,
      remainingMinutes: 0,
      payloads: [payload],
      overlaps: findPayloadOverlaps([payload], input.existingSchedules),
    };
  }

  // Multi-day window: fill chronologically, front-loaded.
  const selectedWeekdays = new Set(input.weekdayValues);
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd })
    .filter((date) => selectedWeekdays.has(getDay(date)))
    .map((date) =>
      buildAutoPlanDay(
        input.currentUser,
        input.task.id,
        date,
        input.startTime,
        input.endTime,
        input.existingSchedules,
        input.userCapacity,
        input.allowOverbooking,
      ),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const payloads: CreateTaskSchedulePayload[] = [];
  let remaining = requestedMinutes;
  let remainingCandidateDays = days.filter((day) => day.availableMinutes > 0).length;
  for (const day of days) {
    if (remaining <= 0) break;
    if (day.availableMinutes <= 0) continue;
    const targetMinutes =
      distributionMode === "even" && remainingCandidateDays > 0
        ? Math.ceil(remaining / remainingCandidateDays)
        : remaining;
    let dayRemaining = Math.min(targetMinutes, day.availableMinutes);
    const slots = [...day.freeSlots].sort(
      (first, second) =>
        distributionMode === "even"
          ? first.start.getTime() - second.start.getTime()
          : getSlotMinutes(second) - getSlotMinutes(first) ||
            first.start.getTime() - second.start.getTime(),
    );
    for (const slot of slots) {
      if (dayRemaining <= 0) break;
      const slotMinutes = getSlotMinutes(slot);
      const plannedMinutes = Math.min(slotMinutes, dayRemaining);
      if (plannedMinutes < MIN_AUTO_PLAN_BLOCKER_MINUTES) continue;
      payloads.push(
        buildPayload(
          input.currentUser,
          input.task.id,
          slot.start,
          addMinutes(slot.start, plannedMinutes),
        ),
      );
      dayRemaining -= plannedMinutes;
      remaining -= plannedMinutes;
    }
    remainingCandidateDays -= 1;
  }

  return {
    ...base,
    plannedMinutes: requestedMinutes - remaining,
    remainingMinutes: remaining,
    payloads: payloads.sort(
      (first, second) =>
        parseISO(first.startDate).getTime() -
        parseISO(second.startDate).getTime(),
    ),
    overlaps: findPayloadOverlaps(payloads, input.existingSchedules),
  };
}

export function getDailyCapacityMinutes(
  capacity: AworkUserCapacity | undefined,
  weekday: number,
): number | undefined {
  const key = WEEKDAY_KEYS[weekday];
  const seconds = key ? capacity?.weeklyCapacity?.[key] : undefined;
  return typeof seconds === "number" ? Math.max(0, seconds / 60) : undefined;
}

export function setTime(date: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return set(date, { hours, minutes, seconds: 0, milliseconds: 0 });
}

export function formatPayloadTimeWindow(payload: CreateTaskSchedulePayload): string {
  return `${format(parseISO(payload.startDate), "HH:mm")}-${format(parseISO(payload.endDate), "HH:mm")}`;
}

function buildAutoPlanDay(
  currentUser: AworkUser,
  taskId: string,
  date: Date,
  startTime: string,
  endTime: string,
  existingSchedules: AworkTaskSchedule[],
  userCapacity: AworkUserCapacity | undefined,
  allowOverbooking = false,
): AutoPlanDay {
  const windowStart = setTime(date, startTime);
  const windowEnd = setTime(date, endTime);
  if (!isAfter(windowEnd, windowStart)) {
    return emptyAutoPlanDay(date);
  }

  const capacityMinutes = getDailyCapacityMinutes(userCapacity, getDay(date));
  if (capacityMinutes === 0) {
    return emptyAutoPlanDay(date);
  }

  const dayStart = startOfDay(date);
  const dayEnd = addDays(dayStart, 1);
  const schedulesForDay = existingSchedules
    .filter((schedule) =>
      intervalsOverlap(
        windowStart,
        windowEnd,
        parseISO(schedule.start),
        parseISO(schedule.end),
      ),
    )
    .sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime());

  const blockerSlots = allowOverbooking
    ? []
    : existingSchedules
        .filter((schedule) =>
          intervalsOverlap(dayStart, dayEnd, parseISO(schedule.start), parseISO(schedule.end)),
        )
        .map((schedule) => ({
          start: maxDate(parseISO(schedule.start), windowStart),
          end: minDate(parseISO(schedule.end), windowEnd),
        }))
        .filter((slot) => isAfter(slot.end, slot.start))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

  const freeSlots = subtractSlots({ start: windowStart, end: windowEnd }, blockerSlots)
    .filter((slot) => getSlotMinutes(slot) >= MIN_AUTO_PLAN_BLOCKER_MINUTES);
  const slotMinutes = freeSlots.reduce((sum, slot) => sum + getSlotMinutes(slot), 0);
  const existingPlannedMinutes = existingSchedules
    .filter((schedule) =>
      intervalsOverlap(dayStart, dayEnd, parseISO(schedule.start), parseISO(schedule.end)),
    )
    .reduce(
      (sum, schedule) =>
        sum +
        getSlotMinutes({
          start: maxDate(parseISO(schedule.start), dayStart),
          end: minDate(parseISO(schedule.end), dayEnd),
        }),
      0,
    );
  const capacityRemainingMinutes =
    allowOverbooking || capacityMinutes === undefined
      ? slotMinutes
      : Math.max(0, capacityMinutes - existingPlannedMinutes);
  const cappedAvailableMinutes = Math.min(slotMinutes, capacityRemainingMinutes);
  const availableMinutes =
    cappedAvailableMinutes >= MIN_AUTO_PLAN_BLOCKER_MINUTES
      ? cappedAvailableMinutes
      : 0;
  const largestFreeSlotMinutes = freeSlots.reduce(
    (largest, slot) => Math.max(largest, getSlotMinutes(slot)),
    0,
  );

  return {
    date,
    existingSchedules: schedulesForDay,
    freeSlots,
    plannedPayloads: [],
    capacityMinutes,
    existingPlannedMinutes,
    availableMinutes,
    largestFreeSlotMinutes,
    plannedMinutes: 0,
  };
}

function buildPayload(
  currentUser: AworkUser,
  taskId: string,
  start: Date,
  end: Date,
): CreateTaskSchedulePayload {
  return {
    taskId,
    userId: currentUser.id,
    startDate: format(start, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    endDate: format(end, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    plannedDuration: Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 1000),
    ),
  };
}

function subtractSlots(baseSlot: TimeSlot, blockers: TimeSlot[]): TimeSlot[] {
  let cursor = baseSlot.start;
  const freeSlots: TimeSlot[] = [];

  blockers.forEach((blocker) => {
    if (isAfter(blocker.start, cursor)) {
      freeSlots.push({ start: cursor, end: blocker.start });
    }
    if (isAfter(blocker.end, cursor)) {
      cursor = blocker.end;
    }
  });

  if (isAfter(baseSlot.end, cursor)) {
    freeSlots.push({ start: cursor, end: baseSlot.end });
  }

  return freeSlots;
}

function intervalsOverlap(
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date,
): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function emptyAutoPlan(weeklyRequestedMinutes: number): AutoPlanResult {
  return {
    requestedMinutes: 0,
    weeklyRequestedMinutes,
    plannedMinutes: 0,
    remainingMinutes: 0,
    payloads: [],
    weeks: [],
    days: [],
    skippedDays: [],
  };
}

function emptyAutoPlanDay(date: Date): AutoPlanDay {
  return {
    date,
    existingSchedules: [],
    freeSlots: [],
    plannedPayloads: [],
    capacityMinutes: undefined,
    existingPlannedMinutes: 0,
    availableMinutes: 0,
    largestFreeSlotMinutes: 0,
    plannedMinutes: 0,
  };
}

function getIsoWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

export function countIsoWeeksInRange(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  const firstDay = start < end ? start : end;
  const lastDay = start < end ? end : start;
  let weekStart = getIsoWeekStart(startOfDay(firstDay));
  const lastWeekStart = getIsoWeekStart(startOfDay(lastDay));
  let count = 1;
  while (weekStart < lastWeekStart) {
    weekStart = addDays(weekStart, 7);
    count += 1;
  }
  return count;
}

function getSlotMinutes(slot: TimeSlot): number {
  return Math.max(0, Math.round((slot.end.getTime() - slot.start.getTime()) / 60000));
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

function minDate(first: Date, second: Date): Date {
  return first < second ? first : second;
}

function maxDate(first: Date, second: Date): Date {
  return first > second ? first : second;
}
