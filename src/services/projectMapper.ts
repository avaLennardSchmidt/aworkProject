import type { AworkProject } from "../types/awork";

type UnknownRecord = Record<string, unknown>;

export function mapProjectsResponse(response: unknown): AworkProject[] {
  return extractArray(response)
    .map(mapOneProject)
    .filter((project): project is AworkProject => Boolean(project))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapOneProject(raw: unknown): AworkProject | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = firstString(raw, ["id", "projectId"]);
  const name = firstString(raw, ["name", "projectName"]);

  if (!id || !name) {
    return null;
  }

  const statusId = firstString(raw, ["projectStatusId", "statusId", "status.id", "projectStatus.id"]);
  const statusName = firstString(raw, ["projectStatus.name", "status.name", "statusName", "projectStatusName"]);
  const statusType = firstString(raw, ["projectStatus.type", "status.type", "statusType", "projectStatusType"]);
  const closedOn = firstString(raw, ["closedOn", "closedDate", "completedOn", "archivedOn"]);

  return {
    id,
    name,
    key: firstString(raw, ["key", "projectKey"]),
    statusId,
    statusName,
    statusType,
    closedOn,
    isActive: isProjectActive({ closedOn, statusName, statusType }),
    raw,
  };
}

function extractArray(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  if (!isRecord(response)) {
    return [];
  }

  const candidates = [response.items, response.data, response.results, response.projects];
  const arrayCandidate = candidates.find(Array.isArray);
  return arrayCandidate ?? [];
}

function firstString(record: UnknownRecord, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (!isRecord(current)) {
        return undefined;
      }
      return current[key];
    }, record);

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function isProjectActive({
  closedOn,
  statusName,
  statusType,
}: {
  closedOn?: string;
  statusName?: string;
  statusType?: string;
}): boolean {
  if (closedOn) {
    return false;
  }

  const normalizedType = statusType?.trim().toLocaleLowerCase();
  if (normalizedType && ["closed", "completed", "cancelled", "canceled", "done", "archived"].includes(normalizedType)) {
    return false;
  }

  const normalizedName = statusName?.trim().toLocaleLowerCase();
  if (normalizedName && ["completed", "complete", "cancelled", "canceled", "closed", "archived"].includes(normalizedName)) {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
