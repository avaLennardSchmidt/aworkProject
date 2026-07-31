import { useMemo, useState, type MouseEvent } from "react";
import { format } from "date-fns";
import type { AworkUser } from "../types/awork";
import { useDetailModal } from "../context/DetailModalContext";
import { capacityProjectId, CAPACITY_DETAIL_HINT } from "../services/capacityProject";
import {
  buildColorMap,
  currentIsoWeekKey,
  formatHours,
  formatPercent,
  getWorkloadColor,
  getWorkloadSurface,
  // TableView's local formatUserName omitted the email suffix — identical to
  // the shared shortUserName, which is used here to keep the display the same.
  shortUserName,
} from "../services/capacityFormat";
import type { CapacityWeek } from "../services/capacityModel";
import { UserAvatar } from "./UserAvatar";

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
  /** Auslastung: planned / effective capacity × 100. */
  utilizationPercent: number;
  /** Kundenziel-Erfüllung: planned / targetHours × 100. */
  kundenzielPercent: number;
  /** Überbucht: planned exceeds the Kunden-Ziel share of available time. */
  isOverbooked: boolean;
  /** Über Kapazität: planned exceeds the full available capacity. */
  isOverCapacity: boolean;
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

// Shared helpers now come from ../services/capacityFormat. Note: the previous
// local currentIsoWeekKey combined the calendar year with the ISO week number
// and was wrong at ISO-year boundaries; the canonical shared version (ISO
// week-numbering year via date-fns "RRRR") is the intended bug fix.

export function CapacityTableView({
  entries,
  capacityWeeks,
}: CapacityTableViewProps) {
  const { openProjectDetail } = useDetailModal();
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
                    <UserAvatar user={row.user} size={32} className="cap-table-avatar" />
                    <div className="cap-table-user-info">
                      <span className="cap-table-user-name">
                        {shortUserName(row.user)}
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
                  const utilPct = weekRow.utilizationPercent;
                  const customerGoalPercent = row.inputs.customerPercent;
                  const workloadColor = getWorkloadColor(utilPct, customerGoalPercent);
                  const cellSurface = getWorkloadSurface(utilPct, customerGoalPercent, {
                    isOverbooked: weekRow.isOverbooked,
                    isOverCapacity: weekRow.isOverCapacity,
                  });
                  const hasData = plannedHours > 0;
                  const targetHours =
                    weekRow.effectiveCapacityHours * (customerGoalPercent / 100);
                  const plannedHoursTooltip = hasData
                    ? `Geplante Projektzeit: ${formatHours(plannedHours)}\nAuslastung: ${formatPercent(utilPct)} der verfügbaren Zeit\nKundenziel-Erfüllung: ${formatPercent(weekRow.kundenzielPercent)} (${formatHours(targetHours)} Ziel bei ${formatPercent(customerGoalPercent)} Kunden-Anteil)`
                    : undefined;
                  const percentageTooltip = `Auslastung: ${formatPercent(utilPct)} der verfügbaren Zeit\nKundenziel-Erfüllung: ${formatPercent(weekRow.kundenzielPercent)}\nGeplant: ${formatHours(plannedHours)} von ${formatHours(targetHours)} Kunden-Ziel\n(${formatHours(weekRow.effectiveCapacityHours)} verfügbar × ${formatPercent(customerGoalPercent)} Kunden)`;

                  let hoursMod = " cap-cell-hours--empty";
                  if (weekRow.isOverCapacity) hoursMod = " cap-cell-hours--over-severe";
                  else if (weekRow.isOverbooked) hoursMod = " cap-cell-hours--over-severe";
                  else if (hasData) hoursMod = " cap-cell-hours--normal";

                  let cellClass = "cap-table-td cap-table-td--cell";
                  if (isAbsent) cellClass += " cap-table-td--absent";
                  else if (weekRow.isOverCapacity) cellClass += " cap-table-td--over-severe";
                  else if (weekRow.isOverbooked) cellClass += " cap-table-td--overbooked";
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
                                  className={`cap-cell-pct${weekRow.isOverCapacity || weekRow.isOverbooked ? " cap-cell-pct--over-severe" : ""}`}
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
                                const projectId = capacityProjectId(project.key);
                                const projectTooltip = `${project.name}: ${formatHours(project.minutes / 60)} · ${project.blockerCount} Blocker${projectId ? ` · ${CAPACITY_DETAIL_HINT}` : ""}`;
                                return (
                                  <div
                                    key={project.key}
                                    className={`cap-cell-project-bar${projectId ? " cap-cell-project-bar-clickable" : ""}`}
                                    style={{ backgroundColor: colorMap.get(project.key) ?? "#52606d" }}
                                    aria-label={projectTooltip}
                                    role={projectId ? "button" : undefined}
                                    tabIndex={projectId ? 0 : undefined}
                                    onMouseEnter={(event) =>
                                      showTooltip(projectTooltip, event)
                                    }
                                    onMouseMove={(event) =>
                                      showTooltip(projectTooltip, event)
                                    }
                                    onMouseLeave={() => setTooltip(undefined)}
                                    onClick={projectId ? () => openProjectDetail(projectId) : undefined}
                                    onKeyDown={
                                      projectId
                                        ? (event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              openProjectDetail(projectId);
                                            }
                                          }
                                        : undefined
                                    }
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
