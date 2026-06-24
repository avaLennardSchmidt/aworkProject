import { useMemo, useState, type MouseEvent } from "react";
import { format } from "date-fns";
import type { AworkUser } from "../types/awork";

// Minimal structural types matching CapacityAnalysisPage internals
interface CapacityWeek {
  key: string;
  label: string;
  from: Date;
  to: Date;
  dayCount: number;
}

interface ProjectEntry {
  key: string;
  name: string;
  minutes: number;
  blockerCount: number;
}

interface UserCapacityWeekEntry {
  week: CapacityWeek;
  effectiveCapacityHours: number;
  plannedMinutes: number;
  customerTargetPercent: number;
  absentDays: number;
  absentHours: number;
  projectTotals: ProjectEntry[];
}

export interface CapacityTableEntry {
  row: {
    user: AworkUser;
    inputs: { weeklyHours: number; customerPercent: number };
  };
  weekRows: UserCapacityWeekEntry[];
}

interface CapacityTableViewProps {
  readonly entries: CapacityTableEntry[];
  readonly capacityWeeks: CapacityWeek[];
}

interface CapacityTableTooltip {
  text: string;
  x: number;
  y: number;
}

const TABLE_PROJECT_COLORS = [
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

function getProjectColor(index: number): string {
  if (index < TABLE_PROJECT_COLORS.length) {
    return TABLE_PROJECT_COLORS[index];
  }
  const hue = ((index - TABLE_PROJECT_COLORS.length) * 47) % 360;
  return `hsl(${hue}, 58%, 44%)`;
}

function buildColorMap(projectEntries: ProjectEntry[]): Map<string, string> {
  const sorted = [...projectEntries].sort((a, b) => a.key.localeCompare(b.key));
  const map = new Map<string, string>();
  sorted.forEach((p, i) => map.set(p.key, getProjectColor(i)));
  return map;
}

function formatHours(hours: number): string {
  const val = Math.round(hours * 10) / 10;
  return Number.isInteger(val) ? `${val} h` : `${val.toFixed(1).replace(".", ",")} h`;
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? `${rounded}%`
    : `${rounded.toFixed(1).replace(".", ",")}%`;
}

function getWorkloadColor(
  workloadPercent: number,
  customerTargetPercent = 100,
): string {
  const target = Math.max(1, Math.min(100, customerTargetPercent));
  const clamped = Math.max(0, workloadPercent);

  let progress: number;
  if (clamped <= target) {
    progress = clamped / target;
  } else {
    const overshoot = (clamped - target) / target;
    progress = Math.max(0, 1 - overshoot);
  }

  const hue = 18 + progress * 110;
  const saturation = 58 - progress * 12;
  const lightness = 56 - progress * 14;
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function getWorkloadSurface(
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

function formatUserName(user: AworkUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email || user.id;
}

function getUserInitials(user: AworkUser): string {
  const first = user.firstName?.[0] ?? "";
  const last = user.lastName?.[0] ?? "";
  return (first + last).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}

function currentIsoWeekKey(): string {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = Math.floor((now.getTime() - startOfWeek1.getTime()) / (7 * 86400000));
  const isoWeek = diff + 1;
  const year = now.getFullYear();
  return `${year}-${isoWeek}`;
}

export function CapacityTableView({
  entries,
  capacityWeeks,
}: CapacityTableViewProps) {
  const currentWeekKey = useMemo(() => currentIsoWeekKey(), []);
  const [tooltip, setTooltip] = useState<CapacityTableTooltip>();

  function showTooltip(text: string, event: MouseEvent<HTMLElement>) {
    const tooltipWidth = 360;
    const x = Math.max(
      12,
      Math.min(event.clientX + 14, window.innerWidth - tooltipWidth - 12),
    );
    const y = Math.max(12, event.clientY + 18);
    setTooltip({ text, x, y });
  }

  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <p>Keine Nutzer zur Anzeige. Mindestens einen Nutzer auswählen.</p>
      </div>
    );
  }

  return (
    <div className="cap-table-wrap">
      <table className="cap-table">
        <thead>
          <tr className="cap-table-head-row">
            <th className="cap-table-th cap-table-th--user">Nutzer</th>
            {capacityWeeks.map((week) => {
              const isCurrent = week.key === currentWeekKey;
              return (
                <th
                  key={week.key}
                  className={`cap-table-th cap-table-th--week${isCurrent ? " cap-table-th--current" : ""}`}
                >
                  <div className="cap-table-week-label">{week.label}</div>
                  <div className={`cap-table-week-range${isCurrent ? " cap-table-week-range--current" : ""}`}>
                    {isCurrent
                      ? "Aktuelle Woche"
                      : `${format(week.from, "dd.MM")} – ${format(week.to, "dd.MM")}`}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {entries.map(({ row, weekRows }) => {
            const allProjects: ProjectEntry[] = [];
            const seenKeys = new Set<string>();
            weekRows.forEach((wr) => {
              wr.projectTotals.forEach((p) => {
                if (!seenKeys.has(p.key)) {
                  seenKeys.add(p.key);
                  allProjects.push(p);
                }
              });
            });
            const colorMap = buildColorMap(allProjects);
            const weekRowsByKey = new Map(weekRows.map((wr) => [wr.week.key, wr]));

            return (
              <tr key={row.user.id} className="cap-table-row">
                <td className="cap-table-td cap-table-td--user">
                  <div className="cap-table-user">
                    <div className="cap-table-avatar" aria-hidden="true">
                      {getUserInitials(row.user)}
                    </div>
                    <div className="cap-table-user-info">
                      <span className="cap-table-user-name">
                        {formatUserName(row.user)}
                      </span>
                      <span className="cap-table-user-meta">
                        {row.inputs.weeklyHours} h/Woche · {row.inputs.customerPercent} % Kunden
                      </span>
                    </div>
                  </div>
                </td>
                {capacityWeeks.map((week) => {
                  const weekRow = weekRowsByKey.get(week.key);
                  const isCurrent = week.key === currentWeekKey;

                  if (!weekRow) {
                    return (
                      <td
                        key={week.key}
                        className={`cap-table-td cap-table-td--cell${isCurrent ? " cap-table-td--current-week" : ""}`}
                      />
                    );
                  }

                  const isAbsent = weekRow.absentDays >= 4.5;
                  const plannedHours = weekRow.plannedMinutes / 60;
                  const utilPct = weekRow.customerTargetPercent;
                  const customerGoalPercent = row.inputs.customerPercent;
                  const workloadColor = getWorkloadColor(utilPct, customerGoalPercent);
                  const cellSurface = getWorkloadSurface(utilPct, customerGoalPercent);
                  const isOverbooked = utilPct > 100;
                  const hasData = plannedHours > 0;
                  const targetHours =
                    weekRow.effectiveCapacityHours * (customerGoalPercent / 100);
                  const plannedHoursTooltip = hasData
                    ? `Geplante Projektzeit: ${formatHours(plannedHours)}\nKunden-Auslastung: ${formatPercent(utilPct)} von ${formatPercent(customerGoalPercent)} Ziel\n${formatHours(targetHours)} Kunden-Ziel in dieser Woche`
                    : undefined;
                  const percentageTooltip = `Kunden-Auslastung: ${formatPercent(utilPct)} von ${formatPercent(customerGoalPercent)} Ziel\nGeplant: ${formatHours(plannedHours)} von ${formatHours(targetHours)} Kunden-Ziel\n(${formatHours(weekRow.effectiveCapacityHours)} verfügbar × ${formatPercent(customerGoalPercent)} Kunden)`;

                  let hoursMod = " cap-cell-hours--empty";
                  if (isOverbooked) hoursMod = " cap-cell-hours--over-severe";
                  else if (hasData) hoursMod = " cap-cell-hours--normal";

                  let cellClass = "cap-table-td cap-table-td--cell";
                  if (isAbsent) cellClass += " cap-table-td--absent";
                  else if (isOverbooked) cellClass += " cap-table-td--over-severe";
                  else if (hasData) cellClass += " cap-table-td--normal";
                  if (isCurrent) cellClass += " cap-table-td--current-week";

                  return (
                    <td
                      key={week.key}
                      className={cellClass}
                      style={!isAbsent && hasData ? { background: cellSurface } : undefined}
                    >
                      {isAbsent ? (
                        <div className="cap-cell-absent">
                          <span className="cap-cell-absent-badge">Urlaub</span>
                          <span className="cap-cell-muted">
                            {weekRow.absentDays >= 5
                              ? "5 Tage"
                              : `${Math.round(weekRow.absentDays * 2) / 2} Tage`}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="cap-cell-header">
                            <span
                              className={`cap-cell-hours${hoursMod}`}
                              aria-label={plannedHoursTooltip}
                              onMouseEnter={plannedHoursTooltip
                                ? (event) => showTooltip(plannedHoursTooltip, event)
                                : undefined}
                              onMouseMove={plannedHoursTooltip
                                ? (event) => showTooltip(plannedHoursTooltip, event)
                                : undefined}
                              onMouseLeave={() => setTooltip(undefined)}
                            >
                              {hasData ? formatHours(plannedHours) : "—"}
                            </span>
                            {hasData && (() => {
                              return (
                                <span
                                  className={`cap-cell-pct${isOverbooked ? " cap-cell-pct--over-severe" : ""}`}
                                  style={{ color: workloadColor }}
                                  aria-label={percentageTooltip}
                                  onMouseEnter={(event) =>
                                    showTooltip(percentageTooltip, event)
                                  }
                                  onMouseMove={(event) =>
                                    showTooltip(percentageTooltip, event)
                                  }
                                  onMouseLeave={() => setTooltip(undefined)}
                                >
                                  {formatPercent(utilPct)} / {formatPercent(customerGoalPercent)}
                                </span>
                              );
                            })()}
                          </div>
                          {weekRow.absentHours > 0 && weekRow.absentDays > 0 && (
                            <div className="cap-cell-partial-absent">
                              {Math.round(weekRow.absentDays * 2) / 2 === 1
                                ? "1 Tag Abw."
                                : `${Math.round(weekRow.absentDays * 2) / 2} Tage Abw.`}
                            </div>
                          )}
                          {weekRow.projectTotals.length > 0 && (
                            <div className="cap-cell-projects">
                              {weekRow.projectTotals.slice(0, 4).map((project) => {
                                const projectTooltip = `${project.name}: ${formatHours(project.minutes / 60)} · ${project.blockerCount} Blocker`;
                                return (
                                  <div
                                    key={project.key}
                                    className="cap-cell-project-bar"
                                    style={{ backgroundColor: colorMap.get(project.key) ?? "#52606d" }}
                                    aria-label={projectTooltip}
                                    onMouseEnter={(event) =>
                                      showTooltip(projectTooltip, event)
                                    }
                                    onMouseMove={(event) =>
                                      showTooltip(projectTooltip, event)
                                    }
                                    onMouseLeave={() => setTooltip(undefined)}
                                  >
                                    <span className="cap-cell-project-name">
                                      {project.name}
                                    </span>
                                    <span className="cap-cell-project-hours">
                                      {formatHours(project.minutes / 60)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {!hasData && weekRow.effectiveCapacityHours > 0 && (
                            <div className="cap-cell-empty-hint">
                              {formatHours(weekRow.effectiveCapacityHours)} frei
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {tooltip ? (
        <div
          className="capacity-floating-tooltip"
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </div>
  );
}
