/**
 * Maps awork time-tracking entries ("erfasste Zeiten") into a minimal shape
 * for Plan-vs-Actual displays. Field names vary slightly across awork
 * endpoints, so every accessor tries candidate paths.
 */

export interface MappedTimeEntry {
  id: string;
  userId?: string;
  taskId?: string;
  projectId?: string;
  /** Local calendar day the entry belongs to, as yyyy-MM-dd. */
  day?: string;
  seconds: number;
}

type UnknownRecord = Record<string, unknown>;

export function mapTimeEntriesResponse(raw: unknown): MappedTimeEntry[] {
  const items = extractArray(raw);
  const result: MappedTimeEntry[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = firstString(item, ["id", "timeEntryId"]);
    if (!id) continue;
    const seconds = firstNumber(item, ["duration", "durationSeconds"]) ?? 0;
    const dateValue = firstString(item, [
      "startDateLocal",
      "startDateUtc",
      "startDate",
      "date",
      "createdOn",
    ]);
    result.push({
      id,
      userId: firstString(item, ["userId", "user.id"]),
      taskId: firstString(item, ["taskId", "task.id"]),
      projectId: firstString(item, [
        "projectId",
        "project.id",
        "task.projectId",
        "task.entityId",
      ]),
      day: dateValue ? dateValue.slice(0, 10) : undefined,
      seconds,
    });
  }
  return result;
}

/** Sums entry seconds; entries without a duration count as 0. */
export function sumTimeEntrySeconds(entries: MappedTimeEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.seconds, 0);
}

function extractArray(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  if (!isRecord(response)) {
    return [];
  }
  const candidates = [response.items, response.data, response.results];
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
