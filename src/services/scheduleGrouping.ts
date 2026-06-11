import { format, getDay, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import type { AworkTaskSchedule } from "../types/awork";
import type { ScheduleGroup } from "../types/planner";
import {
  calculateDurationMinutes,
  formatDate,
  getTimeHHmm,
} from "./scheduleTimeCalculator";

/**
 * Splits a group of schedules by continuity gaps.
 * If same weekday appears every 7 days, they're continuous.
 * If a week is skipped (gap > 7 days for same weekday), creates separate group.
 */
function splitByContinuity(
  schedules: AworkTaskSchedule[],
): AworkTaskSchedule[][] {
  if (schedules.length === 0) return [];
  if (schedules.length === 1) return [schedules];

  const sorted = [...schedules].sort(
    (a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime(),
  );

  const result: AworkTaskSchedule[][] = [];
  let currentGroup: AworkTaskSchedule[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = parseISO(sorted[i - 1].start);
    const curr = parseISO(sorted[i].start);

    // Calculate days difference
    const daysDiff = Math.round(
      (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24),
    );

    // If exactly 7 days apart, they're continuous (same weekday next week)
    // Allow small tolerance for DST changes (6-8 days)
    if (daysDiff >= 6 && daysDiff <= 8) {
      currentGroup.push(sorted[i]);
    } else {
      // Gap found - start new group
      result.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }

  result.push(currentGroup);
  return result;
}

export function groupSchedules(
  schedules: AworkTaskSchedule[],
): ScheduleGroup[] {
  const groups = new Map<string, AworkTaskSchedule[]>();

  schedules.forEach((schedule) => {
    const weekday = getDay(parseISO(schedule.start));
    const startTime = getTimeHHmm(schedule.start);
    const endTime = getTimeHHmm(schedule.end);
    const key = [
      schedule.projectId ?? "no-project",
      schedule.taskId,
      weekday,
      startTime,
      endTime,
    ].join("|");

    groups.set(key, [...(groups.get(key) ?? []), schedule]);
  });

  const result: ScheduleGroup[] = [];

  Array.from(groups.entries()).forEach(([groupId, groupSchedulesForKey]) => {
    // Split by continuity gaps within the group
    const continuousSubGroups = splitByContinuity(groupSchedulesForKey);

    continuousSubGroups.forEach((subGroup, subGroupIndex) => {
      const first = subGroup[0];
      const sorted = subGroup;
      const weekday = getDay(parseISO(first.start));
      const startTime = getTimeHHmm(first.start);
      const endTime = getTimeHHmm(first.end);
      const totalMinutes = sorted.reduce(
        (sum, schedule) =>
          sum + calculateDurationMinutes(schedule.start, schedule.end),
        0,
      );

      // If multiple sub-groups, append index to make groupId unique
      const uniqueGroupId =
        continuousSubGroups.length > 1
          ? `${groupId}#${subGroupIndex}`
          : groupId;

      result.push({
        groupId: uniqueGroupId,
        taskId: first.taskId,
        taskName: first.taskName ?? "Aufgabe ohne Namen",
        projectId: first.projectId,
        projectName: first.projectName,
        weekday,
        weekdayLabel: format(parseISO(first.start), "EEEE", { locale: de }),
        startTime,
        endTime,
        schedules: sorted,
        totalMinutes,
        firstDate: formatDate(sorted[0].start),
        lastDate: formatDate(sorted[sorted.length - 1].start),
      });
    });
  });

  return result.sort(
    (a, b) => a.taskName.localeCompare(b.taskName) || a.weekday - b.weekday,
  );
}
