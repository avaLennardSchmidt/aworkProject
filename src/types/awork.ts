export interface AworkUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  raw?: unknown;
}

export interface AworkProject {
  id: string;
  name: string;
  // awork project key (e.g. "APUA") — used for the awork web deep link.
  key?: string;
  statusId?: string;
  statusName?: string;
  statusType?: string;
  closedOn?: string;
  isActive?: boolean;
  raw: unknown;
}

export interface AworkProjectTask {
  id: string;
  name?: string;
  // awork task key (e.g. "HAUS-6") — used for the awork web deep link.
  key?: string;
  // Missing for private tasks — they belong to a user, not a project.
  projectId?: string;
  projectName?: string;
  // awork baseType "private": personal task, visible only to its owner.
  isPrivate?: boolean;
  statusId?: string;
  statusName?: string;
  statusType?: string;
  statusIcon?: string;
  startOn?: string;
  dueOn?: string;
  plannedDurationSeconds?: number;
  scheduledCount?: number;
  listName?: string;
  raw: unknown;
}

export interface AworkTaskSchedule {
  id: string;
  taskId: string;
  taskName?: string;
  projectId?: string;
  projectName?: string;
  userId?: string;
  start: string;
  end: string;
  taskStatusType?: string;
  raw: unknown;
}

export interface MappingWarning {
  index: number;
  reason: string;
  raw: unknown;
}

export interface MappingResult {
  schedules: AworkTaskSchedule[];
  warnings: MappingWarning[];
  firstRawSchedule?: unknown;
}

export interface CreateTaskSchedulePayload {
  taskId: string;
  userId: string;
  startDate: string;
  endDate: string;
  plannedDuration: number;
}

export interface AworkAbsence {
  id: string;
  userId: string | null;
  startOn: string;
  endOn: string;
  isHalfDayOnStart: boolean;
  isHalfDayOnEnd: boolean;
}

export interface AworkUserCapacity {
  userId: string;
  weeklyCapacity?: Partial<
    Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", number>
  >;
  capacityPerWeek?: number;
}

export interface CreateProjectTaskPayload {
  name: string;
  plannedDuration?: number;
  userId?: string;
}
