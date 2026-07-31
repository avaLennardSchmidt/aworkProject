import { format, getISOWeek } from "date-fns";
import type { AworkUser } from "../types/awork";
import type {
  ProjectTotal,
  UserCapacityRow,
  UserCapacityWeek,
} from "./capacityModel";

export type ProjectColorResolver = (projectKey: string) => string;

export const PROJECT_COLORS = [
  "#1e7a5f",
  "#3567a8",
  "#b45b2c",
  "#7d5bc7",
  "#2b7d8f",
  "#a13f5f",
  "#67752e",
  "#8c6d1f",
  "#226f7a",
  "#9c4f2f",
];

export function buildProjectColorResolver(
  projectTotals: ProjectTotal[],
): ProjectColorResolver {
  const projectKeys = Array.from(
    new Set(projectTotals.map((project) => project.key)),
  ).sort((a, b) => a.localeCompare(b));
  const colorsByProjectKey = new Map<string, string>();

  projectKeys.forEach((projectKey, index) => {
    colorsByProjectKey.set(projectKey, getDistinctProjectColor(index));
  });

  return (projectKey: string) =>
    colorsByProjectKey.get(projectKey) ?? "#52606d";
}

export function getDistinctProjectColor(index: number): string {
  if (index < PROJECT_COLORS.length) {
    return PROJECT_COLORS[index];
  }

  const fallbackIndex = index - PROJECT_COLORS.length;
  const hue = (fallbackIndex * 47) % 360;
  return `hsl(${hue}, 58%, 44%)`;
}

export function buildColorMap(
  projectEntries: ProjectTotal[],
): Map<string, string> {
  const sorted = [...projectEntries].sort((a, b) => a.key.localeCompare(b.key));
  const map = new Map<string, string>();
  sorted.forEach((p, i) => map.set(p.key, getDistinctProjectColor(i)));
  return map;
}

export function formatUserName(user: AworkUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const label = name || user.email || user.id;
  return user.email && name ? `${label} (${user.email})` : label;
}

export function shortUserName(user: AworkUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email || user.id;
}

export function formatHours(hours: number): string {
  return `${formatDecimal(hours)} h`;
}

export function formatDecimal(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(".", ",");
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? `${rounded}%`
    : `${rounded.toFixed(1).replace(".", ",")}%`;
}

export function formatAbsentDays(days: number): string {
  if (days <= 0) return "";
  const rounded = Math.round(days * 2) / 2;
  if (rounded === 0.5) return "½ Tag";
  const whole = Math.floor(rounded);
  const half = rounded - whole === 0.5;
  if (whole === 0) return "½ Tag";
  return half ? `${whole}½ Tage` : `${whole} ${whole === 1 ? "Tag" : "Tage"}`;
}

export function buildUnresolvedProjectsTooltip(
  projects: ProjectTotal[],
): string | undefined {
  const unresolvedProjects = projects.filter(
    (project) => project.key === "unresolved-project",
  );

  if (unresolvedProjects.length === 0) {
    return undefined;
  }

  const details = unresolvedProjects
    .map((project) => project.unresolvedHint)
    .filter((value): value is string => Boolean(value));

  if (details.length === 0) {
    return "Project details could not be resolved for one or more tasks.";
  }

  return `Unresolved project reasons: ${Array.from(new Set(details)).join(" | ")}`;
}

export function mergeUnresolvedHints(
  existingHint: string | undefined,
  nextHint: string,
): string {
  if (!existingHint) {
    return nextHint;
  }

  if (existingHint.includes(nextHint)) {
    return existingHint;
  }

  return `${existingHint} | ${nextHint}`;
}

export function getWorkloadColor(
  workloadPercent: number,
  customerTargetPercent = 100,
): string {
  const target = Math.max(1, Math.min(100, customerTargetPercent));
  const clamped = Math.max(0, workloadPercent);

  let progress: number;
  if (clamped <= target) {
    // 0 → target maps to 0 → 1 (orange → green)
    progress = clamped / target;
  } else {
    // above target: 1 → 0 (green → orange/red)
    const overshoot = (clamped - target) / target;
    progress = Math.max(0, 1 - overshoot);
  }

  const hue = 18 + progress * 110;
  const saturation = 58 - progress * 12;
  const lightness = 56 - progress * 14;
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

export function getWorkloadSurface(
  workloadPercent: number,
  customerTargetPercent = 100,
): string {
  const target = Math.max(1, Math.min(100, customerTargetPercent));
  const clamped = Math.max(0, workloadPercent);
  const isOverbooked = clamped > 100;

  if (isOverbooked) {
    return "linear-gradient(180deg, #fff3f1 0%, #ffe7e3 100%)";
  }

  const workloadColor = getWorkloadColor(workloadPercent, customerTargetPercent);
  return `color-mix(in srgb, ${workloadColor} 12%, white)`;
}

export function getPlannerHref(): string {
  return import.meta.env.BASE_URL || "/";
}

// Canonical ISO week key. Uses the ISO week-numbering year (RRRR), so it is
// correct at ISO-year boundaries — unlike the previous hand-rolled version in
// CapacityTableView, which combined the calendar year with the ISO week
// number (deliberate bug fix).
export function currentIsoWeekKey(): string {
  const now = new Date();
  return `${format(now, "RRRR")}-${getISOWeek(now)}`;
}

export function exportCapacityCsv(
  entries: Array<{ row: UserCapacityRow; weekRows: UserCapacityWeek[] }>,
  filenameBase: string,
) {
  const header = [
    "Nutzer",
    "Woche",
    "Von",
    "Bis",
    "Geplant (h)",
    "Verfügbare Kapazität (h)",
    "Abwesenheit (h)",
    "Kundenziel (h)",
    "Auslastung (%)",
  ];

  const rows: (string | number)[][] = [];
  entries.forEach(({ row, weekRows }) => {
    const userName = formatUserName(row.user);
    weekRows.forEach((week) => {
      rows.push([
        userName,
        week.week.label,
        format(week.week.from, "dd.MM.yyyy"),
        format(week.week.to, "dd.MM.yyyy"),
        csvNumber(week.plannedMinutes / 60),
        csvNumber(week.effectiveCapacityHours),
        csvNumber(week.absentHours),
        csvNumber(week.targetHours),
        csvNumber(week.customerTargetPercent),
      ]);
    });
  });

  const csv = [header, ...rows]
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"),
    )
    .join("\n");

  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenameBase}-${format(new Date(), "yyyy-MM-dd")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function csvNumber(value: number): string {
  return (Math.round(value * 10) / 10).toString().replace(".", ",");
}

export function slugifyName(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "nutzer"
  );
}
