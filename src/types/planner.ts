import type { AworkTaskSchedule, CreateTaskSchedulePayload } from "./awork";

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
  taskStatusType?: string;
}

export interface PlannerFilters {
  from: string;
  to: string;
  hidePast: boolean;
  projectId: string;
  onlyAssigned: boolean;
}


export interface PreviewChange {
  schedule: AworkTaskSchedule;
  dateLabel: string;
  newDateLabel?: string;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
  newStartIso: string;
  newEndIso: string;
  beforeMinutes: number;
  afterMinutes: number;
}

export type BlockerOperationKind = "update" | "create" | "delete";

export type BlockerOperation =
  | {
      kind: "update";
      schedule: AworkTaskSchedule;
      dateLabel: string;
      newDateLabel?: string;
      oldStart: string;
      oldEnd: string;
      newStart: string;
      newEnd: string;
      newStartIso: string;
      newEndIso: string;
      beforeMinutes: number;
      afterMinutes: number;
    }
  | {
      kind: "delete";
      schedule: AworkTaskSchedule;
      dateLabel: string;
      oldStart: string;
      oldEnd: string;
      beforeMinutes: number;
    }
  | {
      kind: "create";
      tempId: string;
      taskId: string;
      dateLabel: string;
      newStart: string;
      newEnd: string;
      payload: CreateTaskSchedulePayload;
      afterMinutes: number;
    };

export interface BlockerOperationResult {
  operationId: string;
  kind: BlockerOperationKind;
  success: boolean;
  error?: string;
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
