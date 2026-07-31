import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  getDay,
  getISOWeek,
  parseISO,
  startOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import {
  calculateAbsentFractionForDay,
  calculateAbsentWorkingDays,
  countWorkingDaysInRange,
  getAbsentHalfForDay,
  type AbsentDayHalf,
} from "./absenceMapper";
import { BackendClient, mapUser } from "./backendClient";
import {
  auslastungPercent,
  isOverCapacity,
  isOverbooked,
  kundenzielPercent,
} from "./capacityMetrics";
import {
  mapProjectTaskResponse,
  mapProjectTasksResponse,
} from "./projectTaskMapper";
import { enrichSchedulesWithProjectTasks } from "./scheduleEnrichment";
import { isOwnSchedule, mapTaskSchedulesResponse } from "./scheduleMapper";
import { mergeUnresolvedHints } from "./capacityFormat";
import type {
  AworkAbsence,
  AworkProjectTask,
  AworkTaskSchedule,
  AworkUser,
  AworkUserCapacity,
} from "../types/awork";

export interface CapacityInputs {
  weeklyHours: number;
  customerPercent: number;
}

export interface ProjectTotal {
  key: string;
  name: string;
  minutes: number;
  blockerCount: number;
  unresolvedHint?: string;
}

export interface UserCapacityRow {
  user: AworkUser;
  schedules: AworkTaskSchedule[];
  inputs: CapacityInputs;
  plannedMinutes: number;
  blockerCount: number;
  projectTotals: ProjectTotal[];
}

export interface CapacityWeek {
  key: string;
  label: string;
  from: Date;
  to: Date;
  dayCount: number;
}

export interface WeekProjectTotal extends ProjectTotal {}

export interface UserCapacityWeek {
  week: CapacityWeek;
  totalCapacityHours: number;
  absentHours: number;
  absentDays: number;
  effectiveCapacityHours: number;
  targetHours: number;
  plannedMinutes: number;
  /** Auslastung: planned / effective capacity × 100. */
  utilizationPercent: number;
  /** Kundenziel-Erfüllung: planned / targetHours × 100 (100 % = on target). */
  kundenzielPercent: number;
  /** Überbucht: planned exceeds the Kunden-Ziel share of available time. */
  isOverbooked: boolean;
  /** Über Kapazität: planned exceeds the full available capacity. */
  isOverCapacity: boolean;
  projectTotals: WeekProjectTotal[];
}

export type UserExpandMode = "weeks" | "days";

export interface DayScheduleDetail {
  scheduleId: string;
  taskId: string;
  projectKey: string;
  projectName: string;
  taskName?: string;
  startHHmm: string;
  endHHmm: string;
  minutes: number;
  unresolvedHint?: string;
}

export interface UserCapacityDay {
  key: string;
  date: Date;
  label: string;
  isWeekend: boolean;
  dayCapacityHours: number;
  absentFraction: number;
  absentHalf: AbsentDayHalf;
  absentHours: number;
  effectiveCapacityHours: number;
  plannedMinutes: number;
  utilizationPercent: number;
  segments: DayScheduleDetail[];
}

export interface CapacityResponse {
  users: unknown[];
  userCapacities?: Record<string, unknown>;
  userSchedules?: Array<{
    userId?: string;
    schedules?: unknown[];
  }>;
}

export interface SelectedRowSummary {
  row: UserCapacityRow;
  weekRows: UserCapacityWeek[];
  projectTotals: ProjectTotal[];
  totals: ReturnType<typeof summarizeWeekRows>;
}

export interface LoadSchedulesForUsersResult {
  schedulesByUser: Record<string, AworkTaskSchedule[]>;
  unresolvedHintsByTaskId: Record<string, string>;
  /** The users' assigned tasks (already fetched for project resolution) —
   * reused for deadline-risk computation. */
  assignedTasksByUser: Record<string, AworkProjectTask[]>;
}

export interface MissingTaskResolutionResult {
  projectTasks: AworkProjectTask[];
  unresolvedHintsByTaskId: Record<string, string>;
}

export interface DeadlineRisk {
  taskId: string;
  taskName?: string;
  projectId?: string;
  projectName?: string;
  /** ISO due date of the task. */
  dueOn: string;
  plannedSeconds: number;
  /** Minutes already scheduled for this task within the analysis range. */
  scheduledMinutesInRange: number;
}

/**
 * Termin-Risiko: assigned tasks due within the analysis range whose planned
 * workload is not fully scheduled (within the range). The scheduled sum only
 * sees the loaded range, so pre-range blockers are not counted — the hint
 * wording reflects that ("im Zeitraum eingeplant").
 */
export function computeDeadlineRisks(
  tasks: AworkProjectTask[],
  schedules: AworkTaskSchedule[],
  from: string,
  to: string,
): DeadlineRisk[] {
  const scheduledMinutesByTask = new Map<string, number>();
  for (const schedule of schedules) {
    const minutes = Math.max(
      0,
      Math.round(
        (parseISO(schedule.end).getTime() -
          parseISO(schedule.start).getTime()) /
          60000,
      ),
    );
    scheduledMinutesByTask.set(
      schedule.taskId,
      (scheduledMinutesByTask.get(schedule.taskId) ?? 0) + minutes,
    );
  }

  const risks: DeadlineRisk[] = [];
  for (const task of tasks) {
    if (!task.dueOn || !task.plannedDurationSeconds) continue;
    const dueDay = task.dueOn.slice(0, 10);
    if (dueDay < from || dueDay > to) continue;
    // Closed tasks are no longer a risk.
    const statusType = task.statusType?.trim().toLowerCase();
    if (statusType && ["done", "closed", "completed"].includes(statusType)) {
      continue;
    }
    const scheduledMinutes = scheduledMinutesByTask.get(task.id) ?? 0;
    if (scheduledMinutes * 60 < task.plannedDurationSeconds) {
      risks.push({
        taskId: task.id,
        taskName: task.name,
        projectId: task.projectId,
        projectName: task.projectName,
        dueOn: task.dueOn,
        plannedSeconds: task.plannedDurationSeconds,
        scheduledMinutesInRange: scheduledMinutes,
      });
    }
  }

  return risks.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export interface ProjectMilestone {
  id: string;
  name: string;
  /** Milestone day as yyyy-MM-dd. */
  day: string;
  color?: string;
  projectId: string;
  projectName?: string;
}

/** Maps a raw awork /projects/{id}/milestones response. */
export function mapProjectMilestones(
  raw: unknown,
  projectId: string,
  projectName?: string,
): ProjectMilestone[] {
  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.items)
      ? raw.items
      : [];
  const milestones: ProjectMilestone[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id : undefined;
    const name = typeof item.name === "string" ? item.name : undefined;
    const dateValue = [item.dueDate, item.date, item.dueOn].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (!id || !name || !dateValue) continue;
    milestones.push({
      id,
      name,
      day: dateValue.slice(0, 10),
      color: typeof item.color === "string" ? item.color : undefined,
      projectId,
      projectName,
    });
  }
  return milestones;
}

export const DEFAULT_WEEKLY_HOURS = 40;
export const DEFAULT_CUSTOMER_PERCENT = 70;
export const CAPACITY_STORAGE_KEY = "awork_capacity_inputs";
const TEAM_PATH_SEGMENT_PATTERN =
  /(team|group|department|unit|organization|organisation)/i;
const MAX_TEAM_WALK_DEPTH = 6;
const MAX_TEAM_WALK_VISITED = 500;

export function mapCapacityUsers(response: unknown): AworkUser[] {
  if (!isCapacityResponse(response)) {
    throw new Error(
      "Kapazitätsanalyse-Antwort konnte nicht verarbeitet werden.",
    );
  }

  return response.users
    .map((user) => {
      try {
        return mapUser(user);
      } catch {
        return null;
      }
    })
    .filter((user): user is AworkUser => Boolean(user));
}

export function mapCapacityDefaults(response: unknown): Record<string, number> {
  if (!isCapacityResponse(response) || !isRecord(response.userCapacities)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(response.userCapacities).flatMap(([userId, rawCapacity]) => {
      const capacity = mapUserCapacity(rawCapacity);
      const weeklyHours = capacity ? getWeeklyCapacityHours(capacity) : null;
      return typeof weeklyHours === "number" ? [[userId, weeklyHours]] : [];
    }),
  );
}

export function mapUserCapacity(rawCapacity: unknown): AworkUserCapacity | null {
  if (!isRecord(rawCapacity)) {
    return null;
  }

  const userId = typeof rawCapacity.userId === "string" ? rawCapacity.userId : "";
  const weeklyCapacity = isRecord(rawCapacity.weeklyCapacity)
    ? Object.fromEntries(
        Object.entries(rawCapacity.weeklyCapacity).filter(
          ([, value]) => typeof value === "number",
        ),
      )
    : undefined;
  const capacityPerWeek =
    typeof rawCapacity.capacityPerWeek === "number"
      ? rawCapacity.capacityPerWeek
      : undefined;

  return { userId, weeklyCapacity, capacityPerWeek };
}

export function getWeeklyCapacityHours(capacity: AworkUserCapacity): number | null {
  if (typeof capacity.capacityPerWeek === "number") {
    return capacity.capacityPerWeek / 3600;
  }

  if (capacity.weeklyCapacity) {
    const seconds = Object.values(capacity.weeklyCapacity).reduce(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0,
    );
    return seconds > 0 ? seconds / 3600 : null;
  }

  return null;
}

export function getUserTeamNames(user: AworkUser): string[] {
  const candidates = collectTeamCandidates(user.raw);
  const normalized = candidates
    .flatMap((candidate) =>
      candidate
        .split(/[\/|;,]/)
        .map((value) => value.trim())
        .filter(Boolean),
    )
    .filter((candidate) => isValidTeamCandidate(candidate))
    .map((candidate) => normalizeTeamName(candidate));

  return Array.from(new Set(normalized));
}

export function collectUsersMatchingTeams(
  users: AworkUser[],
  selectedTeamNames: Set<string>,
): Set<string> {
  return new Set(
    users
      .filter((user) => {
        const userTeamNames = new Set(
          getUserTeamNames(user).map((teamName) => teamName.toLowerCase()),
        );
        return Array.from(selectedTeamNames).some((teamName) =>
          userTeamNames.has(teamName),
        );
      })
      .map((user) => user.id),
  );
}

export function toTeamLabel(teamName: string): string {
  return teamName
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 4) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isValidTeamCandidate(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 48) {
    return false;
  }

  if (!/[a-zA-Z]/.test(normalized)) {
    return false;
  }

  // Drop unresolved ids (UUID-like values and long hash-like tokens).
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
      normalized,
    )
  ) {
    return false;
  }

  if (/^[0-9a-fA-F_-]{20,}$/.test(normalized)) {
    return false;
  }

  return true;
}

export function collectTeamCandidates(raw: unknown): string[] {
  const candidates: string[] = [];
  const visited = { count: 0 };
  walkTeamPayload(raw, [], candidates, visited, 0);
  return candidates;
}

export function walkTeamPayload(
  value: unknown,
  path: string[],
  candidates: string[],
  visited: { count: number },
  depth: number,
): void {
  if (depth > MAX_TEAM_WALK_DEPTH || visited.count >= MAX_TEAM_WALK_VISITED) {
    return;
  }

  visited.count += 1;

  if (typeof value === "string") {
    if (path.some((segment) => TEAM_PATH_SEGMENT_PATTERN.test(segment))) {
      candidates.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkTeamPayload(
        item,
        [...path, String(index)],
        candidates,
        visited,
        depth + 1,
      );
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  Object.entries(value).forEach(([key, nested]) => {
    walkTeamPayload(nested, [...path, key], candidates, visited, depth + 1);
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function loadSchedulesForUsers(
  backendClient: BackendClient,
  users: AworkUser[],
  _currentUser: AworkUser | undefined,
  from: string,
  to: string,
): Promise<LoadSchedulesForUsersResult> {
  const schedulesByUser: Record<string, AworkTaskSchedule[]> = {};
  const assignedTasksByUser: Record<string, AworkProjectTask[]> = {};
  const allSchedules: AworkTaskSchedule[] = [];
  const allProjectTasks: AworkProjectTask[] = [];

  await Promise.all(
    users.map(async (user) => {
      const [scheduleResponse, projectTaskResponse] = await Promise.all([
        backendClient.getTaskSchedules({
          from,
          to,
          userId: user.id,
        }),
        backendClient.getUserAssignedTasks(user.id),
      ]);
      const mapped = mapTaskSchedulesResponse(scheduleResponse);
      const schedules = mapped.schedules
        .map((schedule) => ({
          ...schedule,
          // For user-scoped requests we trust backend filtering completely.
          userId: user.id,
        }))
        .filter((schedule) => isOwnSchedule(schedule, user));
      const userProjectTasks = mapProjectTasksResponse(projectTaskResponse);

      schedulesByUser[user.id] = schedules;
      assignedTasksByUser[user.id] = userProjectTasks;
      allSchedules.push(...schedules);
      allProjectTasks.push(...userProjectTasks);
    }),
  );

  const missingTaskResolution = await loadMissingProjectTasks(
    backendClient,
    allProjectTasks,
    allSchedules,
  );
  Object.entries(schedulesByUser).forEach(([userId, schedules]) => {
    schedulesByUser[userId] = enrichSchedulesWithProjectTasks(
      schedules,
      missingTaskResolution.projectTasks,
    );
  });

  return {
    schedulesByUser,
    unresolvedHintsByTaskId: missingTaskResolution.unresolvedHintsByTaskId,
    assignedTasksByUser,
  };
}

export async function loadMissingProjectTasks(
  backendClient: BackendClient,
  projectTasks: AworkProjectTask[],
  schedules: AworkTaskSchedule[],
): Promise<MissingTaskResolutionResult> {
  const tasksById = new Map(projectTasks.map((task) => [task.id, task]));
  const unresolvedHintsByTaskId: Record<string, string> = {};

  const taskIdsNeedingLookup = Array.from(
    new Set(schedules.map((schedule) => schedule.taskId)),
  ).filter((taskId) => {
    const task = tasksById.get(taskId);
    return !task || !task.projectId || !task.projectName;
  });

  if (taskIdsNeedingLookup.length > 0) {
    const resolvedTasks = await Promise.all(
      taskIdsNeedingLookup.map(async (taskId) => {
        try {
          const mappedTask = mapProjectTaskResponse(
            await backendClient.getTask(taskId),
          );
          if (!mappedTask) {
            unresolvedHintsByTaskId[taskId] =
              "Aufgaben-Details konnten nicht aus der awork-Antwort verarbeitet werden.";
          }
          return mappedTask;
        } catch {
          unresolvedHintsByTaskId[taskId] =
            "Aufgaben-Details konnten nicht von awork geladen werden — " +
            "vermutlich eine private Aufgabe oder ein Projekt ohne Zugriff.";
          return null;
        }
      }),
    );

    resolvedTasks.forEach((task) => {
      if (task && !tasksById.has(task.id)) {
        tasksById.set(task.id, task);
      }
    });
  }

  schedules.forEach((schedule) => {
    if (schedule.projectId && schedule.projectName) {
      return;
    }

    const task = tasksById.get(schedule.taskId);
    if (!task) {
      unresolvedHintsByTaskId[schedule.taskId] =
        unresolvedHintsByTaskId[schedule.taskId] ??
        "Aufgaben-ID wurde nicht in den zugewiesenen Aufgaben gefunden und Einzelabruf schlug fehl.";
      return;
    }

    if (task.isPrivate) {
      unresolvedHintsByTaskId[schedule.taskId] =
        "Private Aufgabe — gehört keinem Projekt und ist nur für die Person selbst sichtbar.";
      return;
    }

    if (!task.projectId) {
      unresolvedHintsByTaskId[schedule.taskId] =
        "Aufgabe hat keine Projekt-ID.";
      return;
    }

    if (!task.projectName) {
      unresolvedHintsByTaskId[schedule.taskId] =
        "Aufgabe hat keinen Projektnamen.";
    }
  });

  return {
    projectTasks: Array.from(tasksById.values()),
    unresolvedHintsByTaskId,
  };
}

export function isCapacityResponse(response: unknown): response is CapacityResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    Array.isArray((response as CapacityResponse).users)
  );
}

export function buildUserCapacityWeeks(
  row: UserCapacityRow,
  weeks: CapacityWeek[],
  userAbsences: AworkAbsence[],
  unresolvedHintsByTaskId: Record<string, string>,
): UserCapacityWeek[] {
  return weeks.map((week) => {
    const projectTotalsByKey = new Map<string, WeekProjectTotal>();
    const weekEndExclusive = addDays(startOfLocalDay(week.to), 1);
    let plannedMinutes = 0;

    row.schedules.forEach((schedule) => {
      // The backend returns schedules that merely overlap the range; count
      // only the minutes falling inside this week, so range-spanning and
      // multi-day schedules are neither dropped nor booked fully into their
      // start week.
      const duration = getScheduleOverlapMinutes(
        schedule,
        week.from,
        weekEndExclusive,
      );
      if (duration <= 0) {
        return;
      }
      plannedMinutes += duration;

      const key = schedule.projectId ?? "unresolved-project";
      const name = schedule.projectName ?? "Projekt nicht aufgelöst";
      const unresolvedHint =
        key === "unresolved-project"
          ? unresolvedHintsByTaskId[schedule.taskId]
          : undefined;
      const current = projectTotalsByKey.get(key) ?? {
        key,
        name,
        minutes: 0,
        blockerCount: 0,
        unresolvedHint,
      };
      current.minutes += duration;
      current.blockerCount += 1;
      if (unresolvedHint) {
        current.unresolvedHint = mergeUnresolvedHints(
          current.unresolvedHint,
          unresolvedHint,
        );
      }
      projectTotalsByKey.set(key, current);
    });

    const totalCapacityHours = calculateWeekCapacityHours(
      row.inputs.weeklyHours,
      week,
    );
    const absentDays = calculateAbsentWorkingDays(
      userAbsences,
      row.user.id,
      week.from,
      week.to,
    );
    const absentHours = Math.min(
      totalCapacityHours,
      absentDays * (row.inputs.weeklyHours / 5),
    );
    const effectiveCapacityHours = Math.max(
      0,
      totalCapacityHours - absentHours,
    );
    const targetHours =
      effectiveCapacityHours * (row.inputs.customerPercent / 100);
    const plannedHours = plannedMinutes / 60;

    return {
      week,
      totalCapacityHours,
      absentHours,
      absentDays,
      effectiveCapacityHours,
      targetHours,
      plannedMinutes,
      utilizationPercent: auslastungPercent(
        plannedHours,
        effectiveCapacityHours,
      ),
      kundenzielPercent: kundenzielPercent(plannedHours, targetHours),
      isOverbooked: isOverbooked(plannedHours, targetHours),
      isOverCapacity: isOverCapacity(plannedHours, effectiveCapacityHours),
      projectTotals: Array.from(projectTotalsByKey.values()).sort(
        (a, b) => b.minutes - a.minutes,
      ),
    };
  });
}

// Mirrors buildUserCapacityWeeks day by day: schedules are split into per-day
// segments with only the overlapping minutes, and the shared per-day absence
// fraction is used, so the day rows of a week always sum to that week's
// numbers.
export function buildUserCapacityDays(
  row: UserCapacityRow,
  week: CapacityWeek,
  userAbsences: AworkAbsence[],
  unresolvedHintsByTaskId: Record<string, string>,
): UserCapacityDay[] {
  const segmentsByDay = new Map<string, DayScheduleDetail[]>();

  row.schedules.forEach((schedule) => {
    const scheduleStart = parseISO(schedule.start);
    const scheduleEnd = parseISO(schedule.end);
    const key = schedule.projectId ?? "unresolved-project";

    let day = startOfLocalDay(week.from);
    while (day <= week.to) {
      const dayEndExclusive = addDays(day, 1);
      const segmentStart = scheduleStart > day ? scheduleStart : day;
      const segmentEnd =
        scheduleEnd < dayEndExclusive ? scheduleEnd : dayEndExclusive;
      const minutes = Math.max(
        0,
        Math.round((segmentEnd.getTime() - segmentStart.getTime()) / 60000),
      );

      if (minutes > 0) {
        const segment: DayScheduleDetail = {
          scheduleId: schedule.id,
          taskId: schedule.taskId,
          projectKey: key,
          projectName: schedule.projectName ?? "Projekt nicht aufgelöst",
          taskName: schedule.taskName,
          startHHmm: format(segmentStart, "HH:mm"),
          endHHmm:
            segmentEnd.getTime() === dayEndExclusive.getTime()
              ? "24:00"
              : format(segmentEnd, "HH:mm"),
          minutes,
          unresolvedHint:
            key === "unresolved-project"
              ? unresolvedHintsByTaskId[schedule.taskId]
              : undefined,
        };
        const dayKey = format(day, "yyyy-MM-dd");
        const daySegments = segmentsByDay.get(dayKey) ?? [];
        daySegments.push(segment);
        segmentsByDay.set(dayKey, daySegments);
      }
      day = dayEndExclusive;
    }
  });

  const days: UserCapacityDay[] = [];
  let day = week.from;
  while (day <= week.to) {
    const dayKey = format(day, "yyyy-MM-dd");
    const segments = (segmentsByDay.get(dayKey) ?? []).sort((a, b) =>
      a.startHHmm.localeCompare(b.startHHmm),
    );
    const dow = getDay(day);
    const isWeekend = dow === 0 || dow === 6;
    const plannedMinutes = segments.reduce(
      (sum, segment) => sum + segment.minutes,
      0,
    );

    if (!isWeekend || plannedMinutes > 0) {
      const dayCapacityHours = isWeekend ? 0 : row.inputs.weeklyHours / 5;
      const absentFraction = calculateAbsentFractionForDay(
        userAbsences,
        row.user.id,
        day,
      );
      const absentHalf = getAbsentHalfForDay(userAbsences, row.user.id, day);
      const absentHours = Math.min(
        dayCapacityHours,
        absentFraction * (row.inputs.weeklyHours / 5),
      );
      const effectiveCapacityHours = Math.max(
        0,
        dayCapacityHours - absentHours,
      );
      const plannedHours = plannedMinutes / 60;
      const utilizationPercent = auslastungPercent(
        plannedHours,
        effectiveCapacityHours,
      );

      days.push({
        key: dayKey,
        date: day,
        label: format(day, "EEEEEE dd.MM.", { locale: de }),
        isWeekend,
        dayCapacityHours,
        absentFraction,
        absentHalf,
        absentHours,
        effectiveCapacityHours,
        plannedMinutes,
        utilizationPercent,
        segments,
      });
    }
    day = addDays(day, 1);
  }

  return days;
}

export function summarizeWeekRows(weekRows: UserCapacityWeek[]) {
  const plannedMinutes = weekRows.reduce(
    (sum, week) => sum + week.plannedMinutes,
    0,
  );
  const plannedHours = plannedMinutes / 60;
  const totalCapacityHours = weekRows.reduce(
    (sum, week) => sum + week.totalCapacityHours,
    0,
  );
  const absentHours = weekRows.reduce((sum, week) => sum + week.absentHours, 0);
  const absentDays = weekRows.reduce((sum, week) => sum + week.absentDays, 0);
  const effectiveCapacityHours = Math.max(0, totalCapacityHours - absentHours);
  const targetHours = weekRows.reduce((sum, week) => sum + week.targetHours, 0);
  const blockerCount = weekRows.reduce(
    (sum, week) =>
      sum +
      week.projectTotals.reduce(
        (projectSum, project) => projectSum + project.blockerCount,
        0,
      ),
    0,
  );

  return {
    plannedHours,
    totalCapacityHours,
    absentHours,
    absentDays,
    effectiveCapacityHours,
    targetHours,
    workloadPercent: auslastungPercent(plannedHours, effectiveCapacityHours),
    kundenzielPercent: kundenzielPercent(plannedHours, targetHours),
    blockerCount,
    // Überbucht per confirmed formula: planned exceeds the Kunden-Ziel share
    // of available time (e.g. 77 % planned at 70 % goal).
    isOverbooked: isOverbooked(plannedHours, targetHours),
    isOverCapacity: isOverCapacity(plannedHours, effectiveCapacityHours),
  };
}

export function summarizeWeekProjectTotals(
  weekRows: UserCapacityWeek[],
): ProjectTotal[] {
  const totalsByKey = new Map<string, ProjectTotal>();

  weekRows.forEach((week) => {
    week.projectTotals.forEach((project) => {
      const current = totalsByKey.get(project.key) ?? {
        key: project.key,
        name: project.name,
        minutes: 0,
        blockerCount: 0,
        unresolvedHint: project.unresolvedHint,
      };
      current.minutes += project.minutes;
      current.blockerCount += project.blockerCount;
      if (project.unresolvedHint) {
        current.unresolvedHint = mergeUnresolvedHints(
          current.unresolvedHint,
          project.unresolvedHint,
        );
      }
      totalsByKey.set(project.key, current);
    });
  });

  return Array.from(totalsByKey.values()).sort((a, b) => b.minutes - a.minutes);
}

// Minutes of a schedule that fall inside [intervalStart, intervalEndExclusive).
export function getScheduleOverlapMinutes(
  schedule: AworkTaskSchedule,
  intervalStart: Date,
  intervalEndExclusive: Date,
): number {
  const start = parseISO(schedule.start);
  const end = parseISO(schedule.end);
  const overlapStart = start > intervalStart ? start : intervalStart;
  const overlapEnd = end < intervalEndExclusive ? end : intervalEndExclusive;
  return Math.max(
    0,
    Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60000),
  );
}

export function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function buildCapacityWeeks(from: string, to: string): CapacityWeek[] {
  const rangeStart = parseISO(from);
  const rangeEnd = parseISO(to);

  if (rangeEnd < rangeStart) {
    return [];
  }

  const weeks: CapacityWeek[] = [];
  let currentWeekStart = startOfWeek(rangeStart, { weekStartsOn: 1 });

  while (currentWeekStart <= rangeEnd) {
    const currentWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
    const clippedStart =
      currentWeekStart < rangeStart ? rangeStart : currentWeekStart;
    const clippedEnd = currentWeekEnd > rangeEnd ? rangeEnd : currentWeekEnd;
    const isoWeek = getISOWeek(currentWeekStart);
    const year = format(currentWeekStart, "RRRR");

    weeks.push({
      key: `${year}-${isoWeek}`,
      label: `KW ${isoWeek}`,
      from: clippedStart,
      to: clippedEnd,
      dayCount: differenceInCalendarDays(clippedEnd, clippedStart) + 1,
    });

    currentWeekStart = addDays(currentWeekStart, 7);
  }

  return weeks;
}

export function calculateWeekCapacityHours(
  weeklyHours: number,
  week: CapacityWeek,
): number {
  const workingDays = countWorkingDaysInRange(week.from, week.to);
  return weeklyHours * (workingDays / 5);
}

export function loadCapacityInputs(): Record<string, CapacityInputs> {
  try {
    const raw = localStorage.getItem(CAPACITY_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([userId, value]) => [
        userId,
        normalizeInputs(value),
      ]),
    );
  } catch {
    return {};
  }
}

export function saveCapacityInputs(inputs: Record<string, CapacityInputs>) {
  try {
    // Wochenstunden werden bewusst nicht gespeichert: Nach einem Reload
    // gelten wieder die Arbeitszeiten aus awork.
    const persistable = Object.fromEntries(
      Object.entries(inputs).map(([userId, value]) => [
        userId,
        { customerPercent: value.customerPercent },
      ]),
    );
    localStorage.setItem(CAPACITY_STORAGE_KEY, JSON.stringify(persistable));
  } catch {
    // Keep the analysis usable even when browser storage is unavailable.
  }
}

export function normalizeInputs(value: unknown): CapacityInputs {
  if (!value || typeof value !== "object") {
    return defaultInputs();
  }

  const record = value as Partial<CapacityInputs>;
  return {
    weeklyHours:
      typeof record.weeklyHours === "number"
        ? Math.max(0, record.weeklyHours)
        : DEFAULT_WEEKLY_HOURS,
    customerPercent:
      typeof record.customerPercent === "number"
        ? Math.min(100, Math.max(0, record.customerPercent))
        : DEFAULT_CUSTOMER_PERCENT,
  };
}

export function getInputsForUser(
  inputs: Record<string, CapacityInputs>,
  userId: string,
  defaultWeeklyHours = DEFAULT_WEEKLY_HOURS,
): CapacityInputs {
  return inputs[userId] ?? defaultInputs(defaultWeeklyHours);
}

export function defaultInputs(weeklyHours = DEFAULT_WEEKLY_HOURS): CapacityInputs {
  return {
    weeklyHours,
    customerPercent: DEFAULT_CUSTOMER_PERCENT,
  };
}

export function calculateWeekCount(from: string, to: string): number {
  const fromDate = parseISO(from);
  const toDate = parseISO(to);
  const days = differenceInCalendarDays(toDate, fromDate) + 1;
  return Math.max(0, days / 7);
}

export function readPositiveNumber(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function readPercentNumber(value: string): number {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(100, Math.max(0, parsed));
}

export function isInvalidNumberInput(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  return !Number.isFinite(Number(value.replace(",", ".")));
}
