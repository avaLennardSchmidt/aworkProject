import type { AworkTaskSchedule, AworkUser, MappingResult } from "../types/awork";
import { isValid, parseISO } from "date-fns";

type UnknownRecord = Record<string, unknown>;

export function mapTaskSchedulesResponse(response: unknown): MappingResult {
  const rawSchedules = extractScheduleArray(response);
  const warnings: MappingResult["warnings"] = [];
  const schedules: AworkTaskSchedule[] = [];

  rawSchedules.forEach((raw, index) => {
    const mapped = mapOneSchedule(raw);
    if (mapped) {
      schedules.push(mapped);
      return;
    }

    warnings.push({
      index,
      reason: "Schedule is missing required id, task id, start, or end fields.",
      raw,
    });
  });

  return {
    schedules,
    warnings,
    firstRawSchedule: rawSchedules[0],
  };
}

export function isOwnSchedule(schedule: AworkTaskSchedule, currentUser: AworkUser): boolean {
  // awork task schedule ownership field names should be adjusted here after testing with
  // real responses. Candidate raw fields include userId, user.id, assignedUserId,
  // taskScheduleUserId, task.userId, and user.id nested under taskSchedule.user.
  return schedule.userId === currentUser.id;
}

function mapOneSchedule(raw: unknown): AworkTaskSchedule | null {
  if (!isRecord(raw)) {
    return null;
  }

  // Candidate awork fields are intentionally centralized here so API shape fixes stay small.
  const id = firstString(raw, ["id", "taskScheduleId"]);
  const taskId = firstString(raw, ["taskId", "task.id"]);
  const start = firstString(raw, ["start", "startDate", "startDateTime", "from"]);
  const end = firstString(raw, ["end", "endDate", "endDateTime", "to"]);

  if (!id || !taskId || !start || !end || !isValid(parseISO(start)) || !isValid(parseISO(end))) {
    return null;
  }

  return {
    id,
    taskId,
    taskName: firstString(raw, ["taskName", "task.name", "task.title", "name"]),
    projectId: firstString(raw, ["projectId", "project.id", "task.projectId", "task.project.id"]),
    projectName: firstString(raw, ["projectName", "project.name", "task.projectName", "task.project.name"]),
    userId: firstString(raw, [
      "userId",
      "user.id",
      "assignedUserId",
      "taskScheduleUserId",
      "task.userId",
      "task.user.id",
    ]),
    start,
    end,
    raw,
  };
}

function extractScheduleArray(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (!isRecord(response)) {
    return [];
  }

  const candidates = [response.items, response.data, response.results, response.taskSchedules];
  const arrayCandidate = candidates.find(Array.isArray);

  return arrayCandidate ?? [];
}

function firstString(record: UnknownRecord, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function getPath(record: UnknownRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!isRecord(value)) {
      return undefined;
    }
    return value[key];
  }, record);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
