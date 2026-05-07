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

  return { id, name };
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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
