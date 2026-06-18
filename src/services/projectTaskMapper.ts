import type { AworkProjectTask } from "../types/awork";

type UnknownRecord = Record<string, unknown>;

export function mapProjectTasksResponse(response: unknown): AworkProjectTask[] {
  return extractArray(response)
    .map(mapOneProjectTask)
    .filter((task): task is AworkProjectTask => Boolean(task));
}

export function mapProjectTaskResponse(response: unknown): AworkProjectTask | null {
  return mapOneProjectTask(unwrapRecord(response) ?? response);
}

function mapOneProjectTask(raw: unknown): AworkProjectTask | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = firstString(raw, ["id", "taskId", "task.id"]);
  const projectId = firstString(raw, ["projectId", "project.id", "entityId", "task.projectId", "task.project.id", "entity.id"]);

  if (!id || !projectId) {
    return null;
  }

  return {
    id,
    name: firstString(raw, ["name", "title", "task.name"]),
    projectId,
    projectName: firstString(raw, ["projectName", "project.name", "entityName", "entity.name", "task.projectName", "task.project.name"]),
    statusId: firstString(raw, ["taskStatusId", "statusId", "task.statusId", "task.taskStatusId", "taskStatus.id", "status.id"]),
    statusName: firstString(raw, ["taskStatus.name", "status.name", "task.taskStatus.name", "task.status.name", "statusName", "taskStatusName"]),
    statusType: firstString(raw, ["taskStatus.type", "status.type", "task.taskStatus.type", "task.status.type", "statusType", "taskStatusType"]),
    statusIcon: firstString(raw, ["taskStatus.icon", "status.icon", "task.taskStatus.icon", "task.status.icon", "statusIcon", "taskStatusIcon"]),
    startOn: firstString(raw, ["startOn", "startDate", "task.startOn"]),
    dueOn: firstString(raw, ["dueOn", "dueDate", "task.dueOn"]),
    plannedDurationSeconds: firstNumber(raw, ["plannedDuration", "totalPlannedDuration", "task.plannedDuration"]),
    scheduledCount: firstNumber(raw, ["taskSchedulesCount", "task.taskSchedulesCount"]),
    listName: extractListName(raw),
    raw,
  };
}

function unwrapRecord(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isRecord(value.data)) {
    return value.data;
  }
  return value;
}

function extractArray(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (!isRecord(response)) {
    return [];
  }

  const candidates = [response.items, response.data, response.results, response.projectTasks];
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

function firstNumber(record: UnknownRecord, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

/**
 * awork embeds the task's list memberships under `lists` (each with a `name`).
 * Prefer the entry matching `primaryTaskListId`, else the first list. Tasks with
 * no list belong to "Ohne Liste" (handled by the caller via undefined).
 */
function extractListName(record: UnknownRecord): string | undefined {
  const lists = record.lists;
  if (!Array.isArray(lists) || lists.length === 0) {
    return undefined;
  }

  const primaryId = getPath(record, "primaryTaskListId");
  const primary = lists.find(
    (entry) => isRecord(entry) && entry.id === primaryId,
  );
  const chosen = isRecord(primary) ? primary : lists[0];
  if (isRecord(chosen) && typeof chosen.name === "string" && chosen.name.trim()) {
    return chosen.name;
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
