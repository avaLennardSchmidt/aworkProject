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

  const id = firstString(raw, ["id", "taskId"]);
  const projectId = firstString(raw, ["projectId", "project.id", "entityId"]);

  if (!id || !projectId) {
    return null;
  }

  return {
    id,
    name: firstString(raw, ["name", "title", "task.name"]),
    projectId,
    projectName: firstString(raw, ["projectName", "project.name"]),
    statusId: firstString(raw, ["taskStatusId", "statusId", "task.statusId", "task.taskStatusId", "taskStatus.id", "status.id"]),
    statusName: firstString(raw, ["taskStatus.name", "status.name", "task.taskStatus.name", "task.status.name", "statusName", "taskStatusName"]),
    statusType: firstString(raw, ["taskStatus.type", "status.type", "task.taskStatus.type", "task.status.type", "statusType", "taskStatusType"]),
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
