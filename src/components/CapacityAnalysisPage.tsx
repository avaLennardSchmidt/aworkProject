import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  endOfWeek,
  format,
  getISOWeek,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  startOfWeek,
} from "date-fns";
import { BackendClient, mapUser } from "../services/backendClient";
import { fuzzyMatches } from "../services/fuzzySearch";
import {
  mapProjectTaskResponse,
  mapProjectTasksResponse,
} from "../services/projectTaskMapper";
import { enrichSchedulesWithProjectTasks } from "../services/scheduleEnrichment";
import {
  isOwnSchedule,
  mapTaskSchedulesResponse,
} from "../services/scheduleMapper";
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
  unresolvedHint?: string;
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
  customerTargetPercent: number;
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

type WorkloadFilterMode = "all" | "gt" | "lt";

interface SelectedRowSummary {
  row: UserCapacityRow;
  weekRows: UserCapacityWeek[];
  projectTotals: ProjectTotal[];
  totals: ReturnType<typeof summarizeWeekRows>;
}

interface LoadSchedulesForUsersResult {
  schedulesByUser: Record<string, AworkTaskSchedule[]>;
  unresolvedHintsByTaskId: Record<string, string>;
}

interface MissingTaskResolutionResult {
  projectTasks: AworkProjectTask[];
  unresolvedHintsByTaskId: Record<string, string>;
}

type ProjectColorResolver = (projectKey: string) => string;

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
  const [to, setTo] = useState(() =>
    format(endOfYear(new Date()), "yyyy-MM-dd"),
  );
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
  const [showCollapsedRangeBars, setShowCollapsedRangeBars] = useState(true);
  const [workloadFilterMode, setWorkloadFilterMode] =
    useState<WorkloadFilterMode>("all");
  const [workloadFilterValue, setWorkloadFilterValue] = useState(80);
  const [bulkWeeklyHoursInput, setBulkWeeklyHoursInput] = useState("");
  const [bulkCustomerPercentInput, setBulkCustomerPercentInput] = useState("");
  const [unresolvedProjectHintsByTaskId, setUnresolvedProjectHintsByTaskId] =
    useState<Record<string, string>>({});
  const [isDetailsTableCollapsed, setIsDetailsTableCollapsed] = useState(false);
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
  const selectedRowSummaries = useMemo<SelectedRowSummary[]>(
    () =>
      selectedRows.map((row) => {
        const weekRows = buildUserCapacityWeeks(
          row,
          capacityWeeks,
          unresolvedProjectHintsByTaskId,
        );
        return {
          row,
          weekRows,
          projectTotals: summarizeWeekProjectTotals(weekRows),
          totals: summarizeWeekRows(weekRows),
        };
      }),
    [capacityWeeks, selectedRows, unresolvedProjectHintsByTaskId],
  );

  const visibleSelectedRowSummaries = useMemo(
    () =>
      selectedRowSummaries.filter((entry) => {
        if (!fuzzyMatches(formatUserName(entry.row.user), chartUserSearch)) {
          return false;
        }

        if (workloadFilterMode === "all") {
          return true;
        }

        if (workloadFilterMode === "gt") {
          return entry.totals.customerTargetPercent >= workloadFilterValue;
        }

        return entry.totals.customerTargetPercent <= workloadFilterValue;
      }),
    [
      chartUserSearch,
      selectedRowSummaries,
      workloadFilterMode,
      workloadFilterValue,
    ],
  );

  const areAllSelectedUsersExpanded =
    visibleSelectedRowSummaries.length > 0 &&
    visibleSelectedRowSummaries.every((entry) =>
      expandedUserIds.has(entry.row.user.id),
    );

  const summary = useMemo(() => {
    const totalPlannedHours = selectedRowSummaries.reduce(
      (sum, entry) => sum + entry.totals.plannedHours,
      0,
    );
    const totalCapacityHours = selectedRowSummaries.reduce(
      (sum, entry) => sum + entry.totals.capacityHours,
      0,
    );
    const totalBlockers = selectedRowSummaries.reduce(
      (sum, entry) => sum + entry.totals.blockerCount,
      0,
    );
    const overloadedUsers = selectedRowSummaries.filter(
      (entry) => entry.totals.isOverloaded,
    ).length;

    return {
      totalPlannedHours,
      totalCapacityHours,
      totalBlockers,
      overloadedUsers,
      averageWorkload:
        selectedRowSummaries.length > 0 && totalCapacityHours > 0
          ? (totalPlannedHours / totalCapacityHours) * 100
          : 0,
    };
  }, [selectedRowSummaries]);

  async function loadAnalysis() {
    setIsLoading(true);
    setError("");

    try {
      const response = await backendClient.getCapacityAnalysis({ from, to });
      const mappedUsers = mapCapacityUsers(response);
      const schedulesResult = await loadSchedulesForUsers(
        backendClient,
        mappedUsers,
        currentUser,
        from,
        to,
      );
      setUsers(mappedUsers);
      setSchedulesByUser(schedulesResult.schedulesByUser);
      setUnresolvedProjectHintsByTaskId(
        schedulesResult.unresolvedHintsByTaskId,
      );
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

  function applyDatePreset(
    preset: "this-month" | "next-4-weeks" | "this-quarter" | "this-year",
  ) {
    const now = new Date();

    switch (preset) {
      case "this-month": {
        setFrom(format(startOfMonth(now), "yyyy-MM-dd"));
        setTo(format(endOfMonth(now), "yyyy-MM-dd"));
        return;
      }
      case "next-4-weeks": {
        setFrom(format(now, "yyyy-MM-dd"));
        setTo(format(addDays(now, 27), "yyyy-MM-dd"));
        return;
      }
      case "this-quarter": {
        setFrom(format(startOfQuarter(now), "yyyy-MM-dd"));
        setTo(format(endOfQuarter(now), "yyyy-MM-dd"));
        return;
      }
      case "this-year": {
        setFrom(format(startOfYear(now), "yyyy-MM-dd"));
        setTo(format(endOfYear(now), "yyyy-MM-dd"));
      }
    }
  }

  return (
    <main className="app-shell analysis-shell">
      <header className="app-header analysis-header">
        <div>
          <p className="eyebrow">awork planner utility</p>
          <h1>Team Capacity Analysis</h1>
        </div>
        <div className="analysis-header-actions">
          <p>
            See planned project time and available team capacity in one view.
          </p>
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
      ) : !isAuthorized ? null : (
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
              <div className="analysis-presets">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isLoading}
                  onClick={() => applyDatePreset("this-month")}
                >
                  This month
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isLoading}
                  onClick={() => applyDatePreset("next-4-weeks")}
                >
                  Next 4 weeks
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isLoading}
                  onClick={() => applyDatePreset("this-quarter")}
                >
                  This quarter
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isLoading}
                  onClick={() => applyDatePreset("this-year")}
                >
                  This year
                </button>
              </div>
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
                  <div className="analysis-inline-actions analysis-inline-actions-end">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setSelectedUserIds(
                          new Set(users.map((user) => user.id)),
                        )
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
                <div className="analysis-section-heading analysis-section-heading-chart">
                  <div>
                    <p className="eyebrow">Projects and capacity</p>
                    <h2>Planned time by user</h2>
                  </div>
                  <div className="analysis-chart-search">
                    <input
                      id="analysis-user-search"
                      aria-label="Search users"
                      type="search"
                      value={chartUserSearch}
                      placeholder="Filter selected users..."
                      onChange={(event) =>
                        setChartUserSearch(event.target.value)
                      }
                    />
                    <div className="analysis-workload-filter">
                      <select
                        id="analysis-workload-filter-mode"
                        aria-label="Workload comparison"
                        value={workloadFilterMode}
                        onChange={(event) =>
                          setWorkloadFilterMode(
                            event.target.value as WorkloadFilterMode,
                          )
                        }
                      >
                        <option value="all">All</option>
                        <option value="gt">Greater than</option>
                        <option value="lt">Smaller than</option>
                      </select>
                      <div className="analysis-workload-threshold">
                        <input
                          type="number"
                          min="0"
                          max="300"
                          step="1"
                          disabled={workloadFilterMode === "all"}
                          value={workloadFilterValue}
                          onChange={(event) =>
                            setWorkloadFilterValue(
                              Math.max(0, Number(event.target.value) || 0),
                            )
                          }
                          aria-label="Workload threshold percent"
                        />
                        <span>%</span>
                      </div>
                    </div>
                  </div>
                  <div className="capacity-heading-meta">
                    <div className="capacity-bulk-inputs">
                      <label>
                        <span>Weekly hours</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9.]*"
                          placeholder="—"
                          value={bulkWeeklyHoursInput}
                          onChange={(event) =>
                            setBulkWeeklyHoursInput(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>Customer %</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="70"
                          value={bulkCustomerPercentInput}
                          onChange={(event) =>
                            setBulkCustomerPercentInput(event.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={
                          visibleSelectedRowSummaries.length === 0 &&
                          !bulkWeeklyHoursInput &&
                          !bulkCustomerPercentInput
                        }
                        onClick={() => {
                          if (bulkWeeklyHoursInput) {
                            const value =
                              readPositiveNumber(bulkWeeklyHoursInput);
                            visibleSelectedRowSummaries.forEach((entry) => {
                              updateCapacityInput(
                                entry.row.user.id,
                                "weeklyHours",
                                value,
                              );
                            });
                          }
                          if (
                            bulkCustomerPercentInput ||
                            visibleSelectedRowSummaries.length > 0
                          ) {
                            const value = bulkCustomerPercentInput
                              ? readPercentNumber(bulkCustomerPercentInput)
                              : 70;
                            visibleSelectedRowSummaries.forEach((entry) => {
                              updateCapacityInput(
                                entry.row.user.id,
                                "customerPercent",
                                value,
                              );
                            });
                          }
                          setBulkWeeklyHoursInput("");
                          setBulkCustomerPercentInput("");
                        }}
                      >
                        Apply to selected
                      </button>
                    </div>
                    <div className="analysis-inline-actions analysis-inline-actions-end">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          setShowCollapsedRangeBars((current) => !current)
                        }
                      >
                        {showCollapsedRangeBars
                          ? "Hide range bars"
                          : "Show range bars"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={visibleSelectedRowSummaries.length === 0}
                        onClick={() => {
                          setExpandedUserIds(
                            areAllSelectedUsersExpanded
                              ? new Set()
                              : new Set(
                                  visibleSelectedRowSummaries.map(
                                    (entry) => entry.row.user.id,
                                  ),
                                ),
                          );
                        }}
                      >
                        {areAllSelectedUsersExpanded
                          ? "Collapse all users"
                          : "Expand all users"}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="capacity-chart-note">
                  Full bar width represents 100% of the weekly hours for that
                  calendar week. The yellow marker shows the expected project
                  capacity based on Customer %.
                </p>
                {visibleSelectedRowSummaries.length > 0 ? (
                  <div className="capacity-chart">
                    {visibleSelectedRowSummaries.map((entry) => {
                      return (
                        <CapacityChartRow
                          key={entry.row.user.id}
                          row={entry.row}
                          weekRows={entry.weekRows}
                          isExpanded={expandedUserIds.has(entry.row.user.id)}
                          showCollapsedRangeBar={showCollapsedRangeBars}
                          onToggleExpanded={() =>
                            toggleUserExpansion(entry.row.user.id)
                          }
                          onInputChange={updateCapacityInput}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>
                      {selectedRows.length === 0
                        ? "Select at least one user to see capacity."
                        : "No selected users match this search or workload filter."}
                    </p>
                  </div>
                )}
              </section>

              <section className="panel analysis-table-panel">
                <div className="analysis-section-heading">
                  <div>
                    <p className="eyebrow">Details</p>
                    <h2>User capacity table</h2>
                  </div>
                  <div className="analysis-inline-actions analysis-inline-actions-end">
                    <button
                      type="button"
                      className="ghost-button"
                      aria-expanded={!isDetailsTableCollapsed}
                      onClick={() =>
                        setIsDetailsTableCollapsed((current) => !current)
                      }
                    >
                      {isDetailsTableCollapsed
                        ? "Show table"
                        : "Collapse table"}
                    </button>
                  </div>
                </div>
                {!isDetailsTableCollapsed ? (
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
                          <th>Projects</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSelectedRowSummaries.map(
                          ({ row, totals, projectTotals }) => {
                            const unresolvedDetails =
                              buildUnresolvedProjectsTooltip(projectTotals);

                            return (
                              <tr key={row.user.id}>
                                <td>{formatUserName(row.user)}</td>
                                <td>{formatHours(totals.plannedHours)}</td>
                                <td>{formatHours(row.inputs.weeklyHours)}</td>
                                <td>{formatHours(totals.targetHours)}</td>
                                <td>
                                  {formatDecimal(totals.customerTargetPercent)}%
                                </td>
                                <td>{totals.blockerCount}</td>
                                <td title={unresolvedDetails}>
                                  {renderTopProjects(projectTotals)}
                                </td>
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
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
  weekRows,
  isExpanded,
  showCollapsedRangeBar,
  onToggleExpanded,
  onInputChange,
}: {
  row: UserCapacityRow;
  weekRows: UserCapacityWeek[];
  isExpanded: boolean;
  showCollapsedRangeBar: boolean;
  onToggleExpanded: () => void;
  onInputChange: (
    userId: string,
    field: keyof CapacityInputs,
    value: number,
  ) => void;
}) {
  const totals = summarizeWeekRows(weekRows);
  const projectTotals = summarizeWeekProjectTotals(weekRows);
  const projectColorFor = useMemo(
    () => buildProjectColorResolver(projectTotals),
    [projectTotals],
  );
  const workloadColor = getWorkloadColor(totals.customerTargetPercent);
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
      className={`capacity-row ${totals.isOverloaded ? "is-overbooked" : ""}`}
    >
      <div className="capacity-row-config">
        <div className="capacity-user">
          <div className="capacity-user-name">
            <strong>{formatUserName(row.user)}</strong>
            {totals.customerTargetPercent > 100 && (
              <span className="overbooked-label">Overplanned</span>
            )}
          </div>
          <span
            style={{ color: workloadColor }}
            title="Fulfillment of customer target: planned hours divided by the customer % target for the selected date range."
          >
            {formatHours(totals.plannedHours)} planned -{" "}
            {formatDecimal(totals.customerTargetPercent)}%
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
              type="text"
              inputMode="decimal"
              pattern="[0-9.]*"
              min="0"
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
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min="0"
              max="100"
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
      {isExpanded || showCollapsedRangeBar ? (
        <CapacityCombinedBar
          totals={totals}
          projectTotals={projectTotals}
          projectColorFor={projectColorFor}
          customerPercent={row.inputs.customerPercent}
          onTooltip={showProjectTooltip}
          onTooltipClear={() => setTooltip(undefined)}
        />
      ) : null}
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
                projectColorFor={projectColorFor}
                customerPercent={row.inputs.customerPercent}
                onTooltip={showProjectTooltip}
                onTooltipClear={() => setTooltip(undefined)}
              />
            ))}
          </div>
          <div className="capacity-legend">
            {projectTotals.slice(0, 4).map((project) => (
              <span
                key={project.key}
                title={`${project.name}: ${project.blockerCount} blocker${project.blockerCount === 1 ? "" : "s"}, ${formatHours(project.minutes / 60)} planned`}
              >
                <i style={{ background: projectColorFor(project.key) }} />
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

function CapacityCombinedBar({
  totals,
  projectTotals,
  projectColorFor,
  customerPercent,
  onTooltip,
  onTooltipClear,
}: {
  totals: ReturnType<typeof summarizeWeekRows>;
  projectTotals: ProjectTotal[];
  projectColorFor: ProjectColorResolver;
  customerPercent: number;
  onTooltip: (text: string, event: MouseEvent<HTMLElement>) => void;
  onTooltipClear: () => void;
}) {
  const displayPercent = Math.max(100, totals.workloadPercent);
  const stackWidthPercent =
    displayPercent > 0 ? (totals.workloadPercent / displayPercent) * 100 : 0;
  const capacityZonePercent = (100 / displayPercent) * 100;
  const customerMarkerPercent = (customerPercent / displayPercent) * 100;
  const customerTargetTooltip = `Expected project capacity | ${formatHours(totals.targetHours)}\nThis bar represents ${customerPercent}% of the selected timeframe capacity`;

  return (
    <div className="capacity-range-overview">
      <div className="capacity-range-overview-head">
        <strong>Selected range</strong>
        <span>
          {formatHours(totals.plannedHours)} planned ·{" "}
          {formatDecimal(totals.customerTargetPercent)}%
        </span>
      </div>
      <div
        className="capacity-range-track"
        aria-label={`Selected range: ${formatHours(totals.plannedHours)} planned of ${formatHours(totals.capacityHours)} capacity.`}
      >
        <div
          className="capacity-range-inner"
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
            {projectTotals.length > 0 && totals.plannedHours > 0 ? (
              projectTotals.map((project) => {
                const tooltipText = `${project.name}\n${formatHours(project.minutes / 60)} planned\n${project.blockerCount} blocker${project.blockerCount === 1 ? "" : "s"}${project.unresolvedHint ? `\nReason: ${project.unresolvedHint}` : ""}`;

                return (
                  <span
                    key={project.key}
                    className="capacity-segment"
                    aria-label={tooltipText}
                    style={{
                      width: `${(project.minutes / (totals.plannedHours * 60)) * 100}%`,
                      background: projectColorFor(project.key),
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
            aria-label={customerTargetTooltip}
            onMouseEnter={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseMove={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseLeave={onTooltipClear}
          />
        </div>
      </div>
    </div>
  );
}

function CapacityWeekBar({
  weekRow,
  projectColorFor,
  customerPercent,
  onTooltip,
  onTooltipClear,
}: {
  weekRow: UserCapacityWeek;
  projectColorFor: ProjectColorResolver;
  customerPercent: number;
  onTooltip: (text: string, event: MouseEvent<HTMLElement>) => void;
  onTooltipClear: () => void;
}) {
  const displayPercent = Math.max(100, weekRow.utilizationPercent);
  const stackWidthPercent =
    displayPercent > 0
      ? (weekRow.utilizationPercent / displayPercent) * 100
      : 0;
  const capacityZonePercent = (100 / displayPercent) * 100;
  const customerMarkerPercent = (customerPercent / displayPercent) * 100;
  const isOverbooked = weekRow.customerTargetPercent > 100;
  const customerTargetTooltip = `Expected project capacity | ${formatHours(weekRow.targetHours)}\nThis bar represents ${customerPercent}% of the weekly hours`;

  return (
    <div className={`capacity-week ${isOverbooked ? "is-overbooked" : ""}`}>
      <div
        className="capacity-week-label"
        title={`${weekRow.week.label}: ${format(weekRow.week.from, "dd.MM.yyyy")} - ${format(weekRow.week.to, "dd.MM.yyyy")}`}
      >
        <strong>{weekRow.week.label}</strong>
        <span>
          {format(weekRow.week.from, "dd.MM")} -{" "}
          {format(weekRow.week.to, "dd.MM")}
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
                const tooltipText = `${project.name}\n${formatHours(project.minutes / 60)} planned\n${project.blockerCount} blocker${project.blockerCount === 1 ? "" : "s"}${project.unresolvedHint ? `\nReason: ${project.unresolvedHint}` : ""}`;

                return (
                  <span
                    key={project.key}
                    className="capacity-segment"
                    aria-label={tooltipText}
                    style={{
                      width: `${(project.minutes / weekRow.plannedMinutes) * 100}%`,
                      background: projectColorFor(project.key),
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
            aria-label={customerTargetTooltip}
            onMouseEnter={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseMove={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseLeave={onTooltipClear}
          />
        </div>
      </div>
      <div className="capacity-week-stats">
        <span>{formatHours(weekRow.plannedMinutes / 60)} planned</span>
        <span>{formatDecimal(weekRow.customerTargetPercent)}%</span>
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
  _currentUser: AworkUser | undefined,
  from: string,
  to: string,
): Promise<LoadSchedulesForUsersResult> {
  const schedulesByUser: Record<string, AworkTaskSchedule[]> = {};
  const allSchedules: AworkTaskSchedule[] = [];
  const allProjectTasks: AworkProjectTask[] = [];

  await Promise.all(
    users.map(async (user) => {
      const [scheduleResponse, projectTaskResponse] = await Promise.all([
        backendClient.getTaskSchedules({
          from,
          to,
          userId: user.id,
        }),
        backendClient.getUserAssignedTasks(user.id),
      ]);
      const mapped = mapTaskSchedulesResponse(scheduleResponse);
      const schedules = mapped.schedules
        .map((schedule) => ({
          ...schedule,
          // For user-scoped requests we trust backend filtering completely.
          userId: user.id,
        }))
        .filter((schedule) => isOwnSchedule(schedule, user));
      const userProjectTasks = mapProjectTasksResponse(projectTaskResponse);

      schedulesByUser[user.id] = schedules;
      allSchedules.push(...schedules);
      allProjectTasks.push(...userProjectTasks);
    }),
  );

  const missingTaskResolution = await loadMissingProjectTasks(
    backendClient,
    allProjectTasks,
    allSchedules,
  );
  Object.entries(schedulesByUser).forEach(([userId, schedules]) => {
    schedulesByUser[userId] = enrichSchedulesWithProjectTasks(
      schedules,
      missingTaskResolution.projectTasks,
    );
  });

  return {
    schedulesByUser,
    unresolvedHintsByTaskId: missingTaskResolution.unresolvedHintsByTaskId,
  };
}

async function loadMissingProjectTasks(
  backendClient: BackendClient,
  projectTasks: AworkProjectTask[],
  schedules: AworkTaskSchedule[],
): Promise<MissingTaskResolutionResult> {
  const tasksById = new Map(projectTasks.map((task) => [task.id, task]));
  const unresolvedHintsByTaskId: Record<string, string> = {};

  const taskIdsNeedingLookup = Array.from(
    new Set(schedules.map((schedule) => schedule.taskId)),
  ).filter((taskId) => {
    const task = tasksById.get(taskId);
    return !task || !task.projectId || !task.projectName;
  });

  if (taskIdsNeedingLookup.length > 0) {
    const resolvedTasks = await Promise.all(
      taskIdsNeedingLookup.map(async (taskId) => {
        try {
          const mappedTask = mapProjectTaskResponse(
            await backendClient.getTask(taskId),
          );
          if (!mappedTask) {
            unresolvedHintsByTaskId[taskId] =
              "Task details could not be mapped from awork response.";
          }
          return mappedTask;
        } catch {
          unresolvedHintsByTaskId[taskId] =
            "Task details could not be loaded from awork.";
          return null;
        }
      }),
    );

    resolvedTasks.forEach((task) => {
      if (task && !tasksById.has(task.id)) {
        tasksById.set(task.id, task);
      }
    });
  }

  schedules.forEach((schedule) => {
    if (schedule.projectId && schedule.projectName) {
      return;
    }

    const task = tasksById.get(schedule.taskId);
    if (!task) {
      unresolvedHintsByTaskId[schedule.taskId] =
        unresolvedHintsByTaskId[schedule.taskId] ??
        "Task id was not found in assigned tasks and lookup failed.";
      return;
    }

    if (!task.projectId) {
      unresolvedHintsByTaskId[schedule.taskId] = "Task has no project id.";
      return;
    }

    if (!task.projectName) {
      unresolvedHintsByTaskId[schedule.taskId] = "Task has no project name.";
    }
  });

  return {
    projectTasks: Array.from(tasksById.values()),
    unresolvedHintsByTaskId,
  };
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
  unresolvedHintsByTaskId: Record<string, string>,
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
      const unresolvedHint =
        key === "unresolved-project"
          ? unresolvedHintsByTaskId[schedule.taskId]
          : undefined;
      const current = projectTotalsByKey.get(key) ?? {
        key,
        name,
        minutes: 0,
        blockerCount: 0,
        unresolvedHint,
      };
      current.minutes += duration;
      current.blockerCount += 1;
      if (unresolvedHint) {
        current.unresolvedHint = mergeUnresolvedHints(
          current.unresolvedHint,
          unresolvedHint,
        );
      }
      projectTotalsByKey.set(key, current);
    });

    const capacityHours = calculateWeekCapacityHours(
      row.inputs.weeklyHours,
      week,
    );
    const targetHours = capacityHours * (row.inputs.customerPercent / 100);
    const plannedHours = plannedMinutes / 60;
    const utilizationPercent =
      capacityHours > 0
        ? (plannedHours / capacityHours) * 100
        : plannedMinutes > 0
          ? 100
          : 0;
    const customerTargetPercent =
      targetHours > 0
        ? (plannedHours / targetHours) * 100
        : plannedMinutes > 0
          ? 100
          : 0;

    return {
      week,
      capacityHours,
      targetHours,
      plannedMinutes,
      utilizationPercent,
      customerTargetPercent,
      projectTotals: Array.from(projectTotalsByKey.values()).sort(
        (a, b) => b.minutes - a.minutes,
      ),
    };
  });
}

function summarizeWeekRows(weekRows: UserCapacityWeek[]) {
  const plannedMinutes = weekRows.reduce(
    (sum, week) => sum + week.plannedMinutes,
    0,
  );
  const plannedHours = plannedMinutes / 60;
  const capacityHours = weekRows.reduce(
    (sum, week) => sum + week.capacityHours,
    0,
  );
  const targetHours = weekRows.reduce((sum, week) => sum + week.targetHours, 0);
  const blockerCount = weekRows.reduce(
    (sum, week) =>
      sum +
      week.projectTotals.reduce(
        (projectSum, project) => projectSum + project.blockerCount,
        0,
      ),
    0,
  );

  return {
    plannedHours,
    capacityHours,
    targetHours,
    workloadPercent:
      capacityHours > 0 ? (plannedHours / capacityHours) * 100 : 0,
    customerTargetPercent:
      targetHours > 0 ? (plannedHours / targetHours) * 100 : 0,
    blockerCount,
    isOverloaded: weekRows.some((week) => week.customerTargetPercent > 100),
  };
}

function summarizeWeekProjectTotals(
  weekRows: UserCapacityWeek[],
): ProjectTotal[] {
  const totalsByKey = new Map<string, ProjectTotal>();

  weekRows.forEach((week) => {
    week.projectTotals.forEach((project) => {
      const current = totalsByKey.get(project.key) ?? {
        key: project.key,
        name: project.name,
        minutes: 0,
        blockerCount: 0,
        unresolvedHint: project.unresolvedHint,
      };
      current.minutes += project.minutes;
      current.blockerCount += project.blockerCount;
      if (project.unresolvedHint) {
        current.unresolvedHint = mergeUnresolvedHints(
          current.unresolvedHint,
          project.unresolvedHint,
        );
      }
      totalsByKey.set(project.key, current);
    });
  });

  return Array.from(totalsByKey.values()).sort((a, b) => b.minutes - a.minutes);
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
    const clippedStart =
      currentWeekStart < rangeStart ? rangeStart : currentWeekStart;
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

function buildProjectColorResolver(
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

function getDistinctProjectColor(index: number): string {
  if (index < PROJECT_COLORS.length) {
    return PROJECT_COLORS[index];
  }

  const fallbackIndex = index - PROJECT_COLORS.length;
  const hue = (fallbackIndex * 47) % 360;
  return `hsl(${hue}, 58%, 44%)`;
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
    .map((project) => `${project.name} (${formatHours(project.minutes / 60)})`)
    .join(", ");
}

function renderTopProjects(projects: ProjectTotal[]) {
  if (projects.length === 0) {
    return "No project time";
  }

  return projects.map((project, index) => (
    <>
      {index > 0 ? <br /> : null}
      {`${project.name} (${formatHours(project.minutes / 60)})`}
    </>
  ));
}

function buildUnresolvedProjectsTooltip(
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

function mergeUnresolvedHints(
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

function getWorkloadColor(workloadPercent: number): string {
  const clampedPercent = Math.max(0, Math.min(100, workloadPercent));
  const progress = clampedPercent / 100;
  const hue = 18 + progress * 110;
  const saturation = 58 - progress * 12;
  const lightness = 56 - progress * 14;
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function getPlannerHref(): string {
  return import.meta.env.BASE_URL || "/";
}
