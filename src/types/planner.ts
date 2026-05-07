import type { AworkTaskSchedule } from "./awork";

export interface ScheduleGroup {
  groupId: string;
  taskId: string;
  taskName: string;
  projectId?: string;
  projectName?: string;
  weekday: number;
  weekdayLabel: string;
  startTime: string;
  endTime: string;
  schedules: AworkTaskSchedule[];
  totalMinutes: number;
  firstDate: string;
  lastDate: string;
}

export interface PlannerFilters {
  from: string;
  to: string;
  hidePast: boolean;
  projectId: string;
}

export type BulkEditMode = "manual" | "keep-start" | "keep-end";

export interface PreviewChange {
  schedule: AworkTaskSchedule;
  dateLabel: string;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
  newStartIso: string;
  newEndIso: string;
  beforeMinutes: number;
  afterMinutes: number;
}

export interface UpdateResult {
  scheduleId: string;
  success: boolean;
  error?: string;
}

export interface DeleteResult {
  scheduleId: string;
  success: boolean;
  error?: string;
}
