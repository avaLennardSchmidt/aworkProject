import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  endOfYear,
  format,
  getISOWeek,
  parseISO,
  startOfWeek,
} from "date-fns";
import { BackendClient, mapUser } from "../services/backendClient";
import { fuzzyMatches } from "../services/fuzzySearch";
import { mapProjectTaskResponse } from "../services/projectTaskMapper";
import { enrichSchedulesWithProjectTasks } from "../services/scheduleEnrichment";
import { isOwnSchedule, mapTaskSchedulesResponse } from "../services/scheduleMapper";
import { calculateDurationMinutes } from "../services/scheduleTimeCalculator";
import type {
  AworkProjectTask,
  AworkTaskSchedule,
  AworkUser,
} from "../types/awork";
import { ConnectionPanel } from "./ConnectionPanel";
import { ErrorAlert } from "./ErrorAlert";
import { LoadingState } from "./LoadingState";

interface CapacityAnalysisPageProps {
  backendClient: BackendClient;
  currentUser?: AworkUser;
  isConnecting: boolean;
  isAuthorized: boolean;
  isCheckingAccess: boolean;
  onLogin: () => void;
  onDisconnect: () => Promise<void>;
}

interface CapacityInputs {
  weeklyHours: number;
  customerPercent: number;
}

interface ProjectTotal {
  key: string;
  name: string;
  minutes: number;
  blockerCount: number;
}

interface UserCapacityRow {
  user: AworkUser;
  schedules: AworkTaskSchedule[];
  inputs: CapacityInputs;
  plannedMinutes: number;
  blockerCount: number;
  projectTotals: ProjectTotal[];
}

interface CapacityWeek {
  key: string;
  label: string;
  from: Date;
  to: Date;
  dayCount: number;
}

interface WeekProjectTotal extends ProjectTotal {}

interface UserCapacityWeek {
  week: CapacityWeek;
  capacityHours: number;
  targetHours: number;
  plannedMinutes: number;
  utilizationPercent: number;
  projectTotals: WeekProjectTotal[];
}

interface ChartTooltip {
  text: string;
  x: number;
  y: number;
}

interface CapacityResponse {
  users: unknown[];
  userSchedules?: Array<{
    userId?: string;
    schedules?: unknown[];
  }>;
}

const DEFAULT_WEEKLY_HOURS = 40;
const DEFAULT_CUSTOMER_PERCENT = 80;
const CAPACITY_STORAGE_KEY = "awork_capacity_inputs";
const PROJECT_COLORS = [
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

export function CapacityAnalysisPage({
  backendClient,
  currentUser,
  isConnecting,
  isAuthorized,
  isCheckingAccess,
  onLogin,
  onDisconnect,
}: CapacityAnalysisPageProps) {
  const [from, setFrom] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => format(endOfYear(new Date()), "yyyy-MM-dd"));
  const [users, setUsers] = useState<AworkUser[]>([]);
  const [schedulesByUser, setSchedulesByUser] = useState<
    Record<string, AworkTaskSchedule[]>
  >({});
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [capacityInputs, setCapacityInputs] = useState<
    Record<string, CapacityInputs>
  >(() => loadCapacityInputs());
  const [chartUserSearch, setChartUserSearch] = useState("");
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    saveCapacityInputs(capacityInputs);
  }, [capacityInputs]);

  useEffect(() => {
    if (currentUser && isAuthorized && !hasLoaded && !isLoading) {
      void loadAnalysis();
    }
  }, [currentUser?.id, isAuthorized, hasLoaded, isLoading]);

  const weekCount = useMemo(() => calculateWeekCount(from, to), [from, to]);
  const capacityWeeks = useMemo(() => buildCapacityWeeks(from, to), [from, to]);

  const rows = useMemo<UserCapacityRow[]>(() => {
    return users.map((user) => {
      const schedules = schedulesByUser[user.id] ?? [];
      const projectTotalsByKey = new Map<string, ProjectTotal>();
      let plannedMinutes = 0;

      schedules.forEach((schedule) => {
        const duration = Math.max(
          0,
          calculateDurationMinutes(schedule.start, schedule.end),
        );
        plannedMinutes += duration;

        const key = schedule.projectId ?? "unresolved-project";
        const name = schedule.projectName ?? "Project not resolved";
        const current = projectTotalsByKey.get(key) ?? {
          key,
          name,
          minutes: 0,
          blockerCount: 0,
        };
        current.minutes += duration;
        current.blockerCount += 1;
        projectTotalsByKey.set(key, current);
      });

      return {
        user,
        schedules,
        inputs: getInputsForUser(capacityInputs, user.id),
        plannedMinutes,
        blockerCount: schedules.length,
        projectTotals: Array.from(projectTotalsByKey.values()).sort(
          (a, b) => b.minutes - a.minutes,
        ),
      };
    });
  }, [capacityInputs, schedulesByUser, users]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedUserIds.has(row.user.id)),
    [rows, selectedUserIds],
  );
  const visibleSelectedRows = useMemo(
    () =>
      selectedRows.filter((row) =>
        fuzzyMatches(formatUserName(row.user), chartUserSearch),
      ),
    [chartUserSearch, selectedRows],
  );
  const areAllSelectedUsersExpanded =
    visibleSelectedRows.length > 0 &&
    visibleSelectedRows.every((row) => expandedUserIds.has(row.user.id));

  const summary = useMemo(() => {
    const totalPlannedHours = selectedRows.reduce(
      (sum, row) => sum + row.plannedMinutes / 60,
      0,
    );
    const totalCapacityHours = selectedRows.reduce(
      (sum, row) => sum + row.inputs.weeklyHours * weekCount,
      0,
    );
    const totalBlockers = selectedRows.reduce(
      (sum, row) => sum + row.blockerCount,
      0,
    );
    const overloadedUsers = selectedRows.filter(
      (row) => row.plannedMinutes / 60 > row.inputs.weeklyHours * weekCount,
    ).length;

    return {
      totalPlannedHours,
      totalCapacityHours,
      totalBlockers,
      overloadedUsers,
      averageWorkload:
        selectedRows.length > 0 && totalCapacityHours > 0
          ? (totalPlannedHours / totalCapacityHours) * 100
          : 0,
    };
  }, [selectedRows, weekCount]);

  async function loadAnalysis() {
    setIsLoading(true);
    setError("");

    try {
      const response = await backendClient.getCapacityAnalysis({ from, to });
      const mappedUsers = mapCapacityUsers(response);
      const mappedSchedulesByUser = await loadSchedulesForUsers(
        backendClient,
        mappedUsers,
        currentUser,
        from,
        to,
      );
      setUsers(mappedUsers);
      setSchedulesByUser(mappedSchedulesByUser);
      setSelectedUserIds(new Set(mappedUsers.map((user) => user.id)));
      setExpandedUserIds(new Set());
      setHasLoaded(true);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load team capacity analysis.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function updateCapacityInput(
    userId: string,
    field: keyof CapacityInputs,
    value: number,
  ) {
    setCapacityInputs((current) => ({
      ...current,
      [userId]: {
        ...getInputsForUser(current, userId),
        [field]: value,
      },
    }));
  }

  function toggleUser(userId: string, checked: boolean) {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  }

  function toggleUserExpansion(userId: string) {
    setExpandedUserIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  return (
    <main className="app-shell analysis-shell">
      <header className="app-header analysis-header">
        <div>
          <p className="eyebrow">awork planner utility</p>
          <h1>Team Capacity Analysis</h1>
        </div>
        <div className="analysis-header-actions">
          <p>See planned project time and available team capacity in one view.</p>
          <a className="ghost-link-button" href={getPlannerHref()}>
            Back to planner
          </a>
        </div>
      </header>

      <ErrorAlert message={error} />

      <ConnectionPanel
        currentUser={currentUser}
        isConnecting={isConnecting}
        onLogin={onLogin}
        onDisconnect={onDisconnect}
      />

      {!currentUser ? null : isCheckingAccess ? (
        <LoadingState label="Checking analysis access..." />
      ) : !isAuthorized ? (
        <section className="panel empty-state">
          <p className="eyebrow">Access denied</p>
          <h2>Team capacity analysis is not available for your account.</h2>
          <p>
            Access is managed through the backend
            MULTI_EDIT_AUTHORIZED_USERS setting.
          </p>
        </section>
      ) : (
        <>
          <section className="panel analysis-control-panel">
            <div>
              <p className="eyebrow">Analysis range</p>
              <h2>Capacity overview</h2>
            </div>
            <div className="analysis-control-grid">
              <div className="form-row">
                <label htmlFor="analysis-from">From</label>
                <input
                  id="analysis-from"
                  type="date"
                  value={from}
                  disabled={isLoading}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="analysis-to">To</label>
                <input
                  id="analysis-to"
                  type="date"
                  value={to}
                  disabled={isLoading}
                  onChange={(event) => setTo(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={isLoading}
                onClick={() => void loadAnalysis()}
              >
                {isLoading ? "Loading..." : "Start analysis"}
              </button>
            </div>
          </section>

          <section className="analysis-absence-warning" role="note">
            <strong>Important: absences are not included.</strong>
            <span>
              This analysis does not reduce capacity for holidays, sick leave,
              public holidays, vacation, or other absence entries.
            </span>
          </section>

          {isLoading ? <LoadingState label="Loading team capacity..." /> : null}

          {hasLoaded ? (
            <>
              <SummaryCards
                selectedCount={selectedRows.length}
                totalUsers={users.length}
                totalPlannedHours={summary.totalPlannedHours}
                totalCapacityHours={summary.totalCapacityHours}
                averageWorkload={summary.averageWorkload}
                totalBlockers={summary.totalBlockers}
                overloadedUsers={summary.overloadedUsers}
              />

              <section className="panel analysis-user-selector">
                <div className="analysis-section-heading">
                  <div>
                    <p className="eyebrow">Users</p>
                    <h2>Included in analysis</h2>
                  </div>
                  <div className="analysis-inline-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setSelectedUserIds(new Set(users.map((user) => user.id)))
                      }
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setSelectedUserIds(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="analysis-user-grid">
                  {rows.map((row) => (
                    <label className="analysis-user-check" key={row.user.id}>
                      <input
                        type="checkbox"
                        checked={selectedUserIds.has(row.user.id)}
                        onChange={(event) =>
                          toggleUser(row.user.id, event.target.checked)
                        }
                      />
                      <span>{formatUserName(row.user)}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="panel analysis-chart-panel">
                <div className="analysis-section-heading">
                  <div>
                    <p className="eyebrow">Projects and capacity</p>
                    <h2>Planned time by user</h2>
                  </div>
                  <div className="analysis-chart-search">
                    <label htmlFor="analysis-user-search">Search users</label>
                    <input
                      id="analysis-user-search"
                      type="search"
                      value={chartUserSearch}
                      placeholder="Filter selected users..."
                      onChange={(event) => setChartUserSearch(event.target.value)}
                    />
                  </div>
                  <div className="capacity-heading-meta">
                    <div className="analysis-inline-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={visibleSelectedRows.length === 0}
                        onClick={() => {
                          setExpandedUserIds(
                            areAllSelectedUsersExpanded
                              ? new Set()
                              : new Set(
                                  visibleSelectedRows.map((row) => row.user.id),
                                ),
                          );
                        }}
                      >
                        {areAllSelectedUsersExpanded
                          ? "Collapse all users"
                          : "Expand all users"}
                      </button>
                    </div>
                    <div className="capacity-marker-legend">
                      <span title="Yellow line: target customer/project work for the selected date range. It is weekly hours times weeks times customer %.">
                        <i className="legend-marker-target" />
                        Customer target
                      </span>
                    </div>
                    <span
                      className="analysis-range-note"
                      title="The selected date range converted into weeks for capacity calculations."
                    >
                      {formatDecimal(weekCount)} week
                      {weekCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                {visibleSelectedRows.length > 0 ? (
                  <div className="capacity-chart">
                    {visibleSelectedRows.map((row) => (
                      <CapacityChartRow
                        key={row.user.id}
                        row={row}
                        weeks={capacityWeeks}
                        isExpanded={expandedUserIds.has(row.user.id)}
                        onToggleExpanded={() => toggleUserExpansion(row.user.id)}
                        onInputChange={updateCapacityInput}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>
                      {selectedRows.length === 0
                        ? "Select at least one user to see capacity."
                        : "No selected users match this search."}
                    </p>
                  </div>
                )}
              </section>

              <section className="panel analysis-table-panel">
                <div>
                  <p className="eyebrow">Details</p>
                  <h2>User capacity table</h2>
                </div>
                <div className="analysis-table-wrap">
                  <table className="analysis-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Planned</th>
                        <th>Weekly hours</th>
                        <th>Customer target</th>
                        <th>Workload</th>
                        <th>Blockers</th>
                        <th>Top projects</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRows.map((row) => {
                        const capacityHours = row.inputs.weeklyHours * weekCount;
                        const targetHours =
                          capacityHours * (row.inputs.customerPercent / 100);
                        const workload =
                          capacityHours > 0
                            ? ((row.plannedMinutes / 60) / capacityHours) * 100
                            : 0;

                        return (
                          <tr key={row.user.id}>
                            <td>{formatUserName(row.user)}</td>
                            <td>{formatHours(row.plannedMinutes / 60)}</td>
                            <td>{formatHours(row.inputs.weeklyHours)}</td>
                            <td>{formatHours(targetHours)}</td>
                            <td>{formatDecimal(workload)}%</td>
                            <td>{row.blockerCount}</td>
                            <td>{formatTopProjects(row.projectTotals)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </>
      )}
    </main>
  );
}

function SummaryCards({
  selectedCount,
  totalUsers,
  totalPlannedHours,
  totalCapacityHours,
  averageWorkload,
  totalBlockers,
  overloadedUsers,
}: {
  selectedCount: number;
  totalUsers: number;
  totalPlannedHours: number;
  totalCapacityHours: number;
  averageWorkload: number;
  totalBlockers: number;
  overloadedUsers: number;
}) {
  return (
    <section className="analysis-summary-grid">
      <SummaryCard
        label="Selected users"
        value={`${selectedCount}/${totalUsers}`}
        title="Users currently included in the capacity calculation."
      />
      <SummaryCard
        label="Planned hours"
        value={formatHours(totalPlannedHours)}
        title="Sum of all planned blocker durations for selected users in the selected date range."
      />
      <SummaryCard
        label="Range capacity"
        value={formatHours(totalCapacityHours)}
        title="Total capacity for the selected date range: weekly hours times number of weeks."
      />
      <SummaryCard
        label="Average workload"
        value={`${formatDecimal(averageWorkload)}%`}
        title="Planned hours divided by total range capacity for selected users."
      />
      <SummaryCard
        label="Planned blockers"
        value={String(totalBlockers)}
        title="Number of planned blockers included in the selected date range."
      />
      <SummaryCard
        label="Overloaded users"
        value={String(overloadedUsers)}
        title="Users whose planned hours are higher than their total range capacity."
      />
    </section>
  );
}

function SummaryCard({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title: string;
}) {
  return (
    <div className="analysis-summary-card" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CapacityChartRow({
  row,
  weeks,
  isExpanded,
  onToggleExpanded,
  onInputChange,
}: {
  row: UserCapacityRow;
  weeks: CapacityWeek[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onInputChange: (
    userId: string,
    field: keyof CapacityInputs,
    value: number,
  ) => void;
}) {
  const weekRows = buildUserCapacityWeeks(row, weeks);
  const plannedHours = weekRows.reduce(
    (sum, week) => sum + week.plannedMinutes / 60,
    0,
  );
  const capacityHours = weekRows.reduce(
    (sum, week) => sum + week.capacityHours,
    0,
  );
  const targetHours = capacityHours * (row.inputs.customerPercent / 100);
  const workload = capacityHours > 0 ? (plannedHours / capacityHours) * 100 : 0;
  const isOverbooked = weekRows.some((week) => week.utilizationPercent > 100);
  const [tooltip, setTooltip] = useState<ChartTooltip>();

  function showProjectTooltip(text: string, event: MouseEvent<HTMLElement>) {
    const tooltipWidth = 360;
    const x = Math.max(
      12,
      Math.min(event.clientX + 14, window.innerWidth - tooltipWidth - 12),
    );
    const y = Math.max(12, event.clientY + 18);
    setTooltip({ text, x, y });
  }

  return (
    <article
      className={`capacity-row ${isOverbooked ? "is-overbooked" : ""}`}
    >
      <div className="capacity-row-config">
        <div className="capacity-user">
          <strong>{formatUserName(row.user)}</strong>
          <span title="Workload is the sum of the visible calendar week planned hours divided by total capacity for the selected date range.">
            {formatHours(plannedHours)} planned - {formatDecimal(workload)}%
          </span>
        </div>
        <button
          type="button"
          className="ghost-button capacity-expand-button"
          aria-expanded={isExpanded}
          onClick={onToggleExpanded}
        >
          {isExpanded ? "Collapse weeks" : "Show weeks"}
        </button>
        <div className="capacity-inputs">
          <label>
            Weekly hours
            <input
              type="number"
              min="0"
              step="0.5"
              value={row.inputs.weeklyHours}
              title="Contracted working hours per week. Each calendar week bar uses this value as its 100% capacity, prorated for partial weeks."
              onChange={(event) =>
                onInputChange(
                  row.user.id,
                  "weeklyHours",
                  readPositiveNumber(event.target.value),
                )
              }
            />
          </label>
          <label>
            Customer %
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={row.inputs.customerPercent}
              title="Target share of weekly hours for customer/project work. The yellow marker uses this percentage of total capacity."
              onChange={(event) =>
                onInputChange(
                  row.user.id,
                  "customerPercent",
                  readPercentNumber(event.target.value),
                )
              }
            />
          </label>
        </div>
      </div>
      {isExpanded ? (
        <div className="capacity-row-main">
          <div
            className="capacity-week-grid"
            aria-label={`${formatUserName(row.user)} planned project hours by calendar week`}
          >
            {weekRows.map((weekRow) => (
              <CapacityWeekBar
                key={weekRow.week.key}
                weekRow={weekRow}
                customerPercent={row.inputs.customerPercent}
                onTooltip={showProjectTooltip}
                onTooltipClear={() => setTooltip(undefined)}
              />
            ))}
          </div>
          <div className="capacity-legend">
            {row.projectTotals.slice(0, 4).map((project) => (
              <span
                key={project.key}
                title={`${project.name}: ${project.blockerCount} blocker${project.blockerCount === 1 ? "" : "s"}, ${formatHours(project.minutes / 60)} planned`}
              >
                <i style={{ background: getProjectColor(project.key) }} />
                {project.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {tooltip ? (
        <div
          className="capacity-floating-tooltip"
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </article>
  );
}

function CapacityWeekBar({
  weekRow,
  customerPercent,
  onTooltip,
  onTooltipClear,
}: {
  weekRow: UserCapacityWeek;
  customerPercent: number;
  onTooltip: (text: string, event: MouseEvent<HTMLElement>) => void;
  onTooltipClear: () => void;
}) {
  const displayPercent = Math.max(100, weekRow.utilizationPercent);
  const stackWidthPercent =
    displayPercent > 0 ? (weekRow.utilizationPercent / displayPercent) * 100 : 0;
  const capacityZonePercent = (100 / displayPercent) * 100;
  const customerMarkerPercent = (customerPercent / displayPercent) * 100;
  const isOverbooked = weekRow.utilizationPercent > 100;

  return (
    <div className={`capacity-week ${isOverbooked ? "is-overbooked" : ""}`}>
      <div
        className="capacity-week-label"
        title={`${weekRow.week.label}: ${format(weekRow.week.from, "dd.MM.yyyy")} - ${format(weekRow.week.to, "dd.MM.yyyy")}`}
      >
        <strong>{weekRow.week.label}</strong>
        <span>
          {format(weekRow.week.from, "dd.MM")} - {format(weekRow.week.to, "dd.MM")}
        </span>
      </div>
      <div
        className="capacity-week-track"
        aria-label={`${weekRow.week.label}: ${formatHours(weekRow.plannedMinutes / 60)} planned of ${formatHours(weekRow.capacityHours)} capacity.`}
      >
        <div
          className="capacity-week-inner"
          style={{ width: `${displayPercent}%` }}
        >
          <div
            className="capacity-zone"
            style={{ width: `${capacityZonePercent}%` }}
          />
          <div
            className="capacity-stacked-bar"
            style={{ width: `${stackWidthPercent}%` }}
          >
            {weekRow.projectTotals.length > 0 && weekRow.plannedMinutes > 0 ? (
              weekRow.projectTotals.map((project) => {
                const tooltipText = `${weekRow.week.label} | ${project.name} | ${project.blockerCount} blocker${project.blockerCount === 1 ? "" : "s"} | ${formatHours(project.minutes / 60)} planned`;

                return (
                  <span
                    key={project.key}
                    className="capacity-segment"
                    aria-label={tooltipText}
                    style={{
                      width: `${(project.minutes / weekRow.plannedMinutes) * 100}%`,
                      background: getProjectColor(project.key),
                    }}
                    onMouseEnter={(event) => onTooltip(tooltipText, event)}
                    onMouseMove={(event) => onTooltip(tooltipText, event)}
                    onMouseLeave={onTooltipClear}
                  />
                );
              })
            ) : (
              <span
                className="capacity-empty-bar"
                aria-label="No planned project time"
                title="No planned project time"
              >
                -
              </span>
            )}
          </div>
          <span
            className="capacity-marker capacity-marker-target"
            style={{ left: `${customerMarkerPercent}%` }}
            title={`${weekRow.week.label} customer target: ${formatHours(weekRow.targetHours)} (${customerPercent}% of week capacity)`}
          />
        </div>
      </div>
      <div className="capacity-week-stats">
        <span>{formatHours(weekRow.plannedMinutes / 60)} planned</span>
        <span>{formatDecimal(weekRow.utilizationPercent)}%</span>
      </div>
    </div>
  );
}

function mapCapacityUsers(response: unknown): AworkUser[] {
  if (!isCapacityResponse(response)) {
    throw new Error("Capacity analysis response could not be mapped.");
  }

  return response.users
    .map((user) => {
      try {
        return mapUser(user);
      } catch {
        return null;
      }
    })
    .filter((user): user is AworkUser => Boolean(user));
}

async function loadSchedulesForUsers(
  backendClient: BackendClient,
  users: AworkUser[],
  currentUser: AworkUser | undefined,
  from: string,
  to: string,
): Promise<Record<string, AworkTaskSchedule[]>> {
  const schedulesByUser: Record<string, AworkTaskSchedule[]> = {};
  const allSchedules: AworkTaskSchedule[] = [];

  await Promise.all(
    users.map(async (user) => {
      const response = await backendClient.getTaskSchedules({
        from,
        to,
        userId: user.id === currentUser?.id ? undefined : user.id,
      });
      const mapped = mapTaskSchedulesResponse(response);
      const schedules = mapped.schedules.filter((schedule) =>
        isOwnSchedule(schedule, user),
      );

      schedulesByUser[user.id] = schedules;
      allSchedules.push(...schedules);
    }),
  );

  const projectTasks = await loadMissingProjectTasks(backendClient, allSchedules);
  Object.entries(schedulesByUser).forEach(([userId, schedules]) => {
    schedulesByUser[userId] = enrichSchedulesWithProjectTasks(
      schedules,
      projectTasks,
    );
  });

  return schedulesByUser;
}

async function loadMissingProjectTasks(
  backendClient: BackendClient,
  schedules: AworkTaskSchedule[],
): Promise<AworkProjectTask[]> {
  const missingTaskIds = Array.from(
    new Set(
      schedules
        .filter((schedule) => !schedule.projectId || !schedule.projectName)
        .map((schedule) => schedule.taskId),
    ),
  );

  const resolvedTasks = await Promise.all(
    missingTaskIds.map(async (taskId) => {
      try {
        return mapProjectTaskResponse(await backendClient.getTask(taskId));
      } catch {
        return null;
      }
    }),
  );

  return resolvedTasks.filter((task): task is AworkProjectTask => Boolean(task));
}

function isCapacityResponse(response: unknown): response is CapacityResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    Array.isArray((response as CapacityResponse).users)
  );
}

function buildUserCapacityWeeks(
  row: UserCapacityRow,
  weeks: CapacityWeek[],
): UserCapacityWeek[] {
  return weeks.map((week) => {
    const projectTotalsByKey = new Map<string, WeekProjectTotal>();
    let plannedMinutes = 0;

    row.schedules.forEach((schedule) => {
      const scheduleStart = parseISO(schedule.start);
      if (scheduleStart < week.from || scheduleStart > endOfDay(week.to)) {
        return;
      }

      const duration = Math.max(
        0,
        calculateDurationMinutes(schedule.start, schedule.end),
      );
      plannedMinutes += duration;

      const key = schedule.projectId ?? "unresolved-project";
      const name = schedule.projectName ?? "Project not resolved";
      const current = projectTotalsByKey.get(key) ?? {
        key,
        name,
        minutes: 0,
        blockerCount: 0,
      };
      current.minutes += duration;
      current.blockerCount += 1;
      projectTotalsByKey.set(key, current);
    });

    const capacityHours = calculateWeekCapacityHours(row.inputs.weeklyHours, week);
    const targetHours = capacityHours * (row.inputs.customerPercent / 100);
    const utilizationPercent =
      capacityHours > 0
        ? (plannedMinutes / 60 / capacityHours) * 100
        : plannedMinutes > 0
          ? 100
          : 0;

    return {
      week,
      capacityHours,
      targetHours,
      plannedMinutes,
      utilizationPercent,
      projectTotals: Array.from(projectTotalsByKey.values()).sort(
        (a, b) => b.minutes - a.minutes,
      ),
    };
  });
}

function buildCapacityWeeks(from: string, to: string): CapacityWeek[] {
  const rangeStart = parseISO(from);
  const rangeEnd = parseISO(to);

  if (rangeEnd < rangeStart) {
    return [];
  }

  const weeks: CapacityWeek[] = [];
  let currentWeekStart = startOfWeek(rangeStart, { weekStartsOn: 1 });

  while (currentWeekStart <= rangeEnd) {
    const currentWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
    const clippedStart = currentWeekStart < rangeStart ? rangeStart : currentWeekStart;
    const clippedEnd = currentWeekEnd > rangeEnd ? rangeEnd : currentWeekEnd;
    const isoWeek = getISOWeek(currentWeekStart);
    const year = format(currentWeekStart, "RRRR");

    weeks.push({
      key: `${year}-${isoWeek}`,
      label: `CW ${isoWeek}`,
      from: clippedStart,
      to: clippedEnd,
      dayCount: differenceInCalendarDays(clippedEnd, clippedStart) + 1,
    });

    currentWeekStart = addDays(currentWeekStart, 7);
  }

  return weeks;
}

function calculateWeekCapacityHours(
  weeklyHours: number,
  week: CapacityWeek,
): number {
  return weeklyHours * (week.dayCount / 7);
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function loadCapacityInputs(): Record<string, CapacityInputs> {
  try {
    const raw = localStorage.getItem(CAPACITY_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([userId, value]) => [
        userId,
        normalizeInputs(value),
      ]),
    );
  } catch {
    return {};
  }
}

function saveCapacityInputs(inputs: Record<string, CapacityInputs>) {
  try {
    localStorage.setItem(CAPACITY_STORAGE_KEY, JSON.stringify(inputs));
  } catch {
    // Keep the analysis usable even when browser storage is unavailable.
  }
}

function normalizeInputs(value: unknown): CapacityInputs {
  if (!value || typeof value !== "object") {
    return defaultInputs();
  }

  const record = value as Partial<CapacityInputs>;
  return {
    weeklyHours:
      typeof record.weeklyHours === "number"
        ? Math.max(0, record.weeklyHours)
        : DEFAULT_WEEKLY_HOURS,
    customerPercent:
      typeof record.customerPercent === "number"
        ? Math.min(100, Math.max(0, record.customerPercent))
        : DEFAULT_CUSTOMER_PERCENT,
  };
}

function getInputsForUser(
  inputs: Record<string, CapacityInputs>,
  userId: string,
): CapacityInputs {
  return inputs[userId] ?? defaultInputs();
}

function defaultInputs(): CapacityInputs {
  return {
    weeklyHours: DEFAULT_WEEKLY_HOURS,
    customerPercent: DEFAULT_CUSTOMER_PERCENT,
  };
}

function calculateWeekCount(from: string, to: string): number {
  const fromDate = parseISO(from);
  const toDate = parseISO(to);
  const days = differenceInCalendarDays(toDate, fromDate) + 1;
  return Math.max(0, days / 7);
}

function readPositiveNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function readPercentNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(100, Math.max(0, parsed));
}

function getProjectColor(projectKey: string): string {
  let hash = 0;
  for (let index = 0; index < projectKey.length; index += 1) {
    hash = (hash + projectKey.charCodeAt(index) * (index + 1)) % 997;
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

function formatUserName(user: AworkUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const label = name || user.email || user.id;
  return user.email && name ? `${label} (${user.email})` : label;
}

function formatHours(hours: number): string {
  return `${formatDecimal(hours)}h`;
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatTopProjects(projects: ProjectTotal[]): string {
  if (projects.length === 0) {
    return "No project time";
  }

  return projects
    .slice(0, 3)
    .map((project) => `${project.name} (${formatHours(project.minutes / 60)})`)
    .join(", ");
}

function getPlannerHref(): string {
  return import.meta.env.BASE_URL || "/";
}
