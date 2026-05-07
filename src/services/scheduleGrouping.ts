import { format, getDay, parseISO } from "date-fns";
import type { AworkTaskSchedule } from "../types/awork";
import type { ScheduleGroup } from "../types/planner";
import {
  calculateDurationMinutes,
  formatDate,
  getTimeHHmm,
} from "./scheduleTimeCalculator";

export function groupSchedules(schedules: AworkTaskSchedule[]): ScheduleGroup[] {
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

  return Array.from(groups.entries())
    .map(([groupId, groupSchedulesForKey]) => {
      const first = groupSchedulesForKey[0];
      const sorted = [...groupSchedulesForKey].sort(
        (a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime(),
      );
      const weekday = getDay(parseISO(first.start));
      const startTime = getTimeHHmm(first.start);
      const endTime = getTimeHHmm(first.end);
      const totalMinutes = sorted.reduce(
        (sum, schedule) => sum + calculateDurationMinutes(schedule.start, schedule.end),
        0,
      );

      return {
        groupId,
        taskId: first.taskId,
        taskName: first.taskName ?? "Untitled task",
        projectId: first.projectId,
        projectName: first.projectName,
        weekday,
        weekdayLabel: format(parseISO(first.start), "EEEE"),
        startTime,
        endTime,
        schedules: sorted,
        totalMinutes,
        firstDate: formatDate(sorted[0].start),
        lastDate: formatDate(sorted[sorted.length - 1].start),
      };
    })
    .sort((a, b) => a.taskName.localeCompare(b.taskName) || a.weekday - b.weekday);
}
