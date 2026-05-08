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
  projectId: string;
  projectName?: string;
  statusId?: string;
  statusName?: string;
  statusType?: string;
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

export interface CreateProjectTaskPayload {
  name: string;
  plannedDuration?: number;
  userId?: string;
}
