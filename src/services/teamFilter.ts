import type { AworkUser } from "../types/awork";

const TEAM_PATH_SEGMENT_PATTERN = /(team|group|department|unit|organization|organisation)/i;
const ALLOWED_TEAM_PATTERN = /\b(pds|sim)\b/i;
const MAX_DEPTH = 6;
const MAX_VISITED = 500;

export function isUserInPdsOrSimTeam(user: AworkUser): boolean {
  const candidates = collectTeamCandidates(user.raw);
  return candidates.some((candidate) => ALLOWED_TEAM_PATTERN.test(candidate));
}

function collectTeamCandidates(raw: unknown): string[] {
  const candidates: string[] = [];
  const visited = { count: 0 };
  walk(raw, [], candidates, visited, 0);
  return candidates;
}

function walk(
  value: unknown,
  path: string[],
  candidates: string[],
  visited: { count: number },
  depth: number,
): void {
  if (depth > MAX_DEPTH || visited.count >= MAX_VISITED) {
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
      walk(item, [...path, String(index)], candidates, visited, depth + 1);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  Object.entries(value).forEach(([key, nested]) => {
    walk(nested, [...path, key], candidates, visited, depth + 1);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}