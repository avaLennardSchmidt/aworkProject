import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
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
import {
  calculateAbsentWorkingDays,
  countWorkingDaysInRange,
  groupAbsencesByUserId,
  mapAbsencesResponse,
} from "../services/absenceMapper";
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
  AworkAbsence,
  AworkProjectTask,
  AworkTaskSchedule,
  AworkUser,
  AworkUserCapacity,
} from "../types/awork";
import { ConnectionPanel } from "./ConnectionPanel";
import { ErrorAlert } from "./ErrorAlert";
import { LoadingState } from "./LoadingState";
import {
  formatSearchPlaceholder,
  MultiSearchableSelect,
} from "./SearchableSelect";
import { DatePickerInput } from "./DatePickerInput";
import { SegmentedControl } from "./SegmentedControl";

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
  totalCapacityHours: number;
  absentHours: number;
  absentDays: number;
  effectiveCapacityHours: number;
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
  userCapacities?: Record<string, unknown>;
  userSchedules?: Array<{
    userId?: string;
    schedules?: unknown[];
  }>;
}

type WorkloadFilterMode = "all" | "gt" | "lt";

const workloadFilterOptions = [
  { value: "all" as const, label: "Alle" },
  { value: "gt" as const, label: "Über" },
  { value: "lt" as const, label: "Unter" },
];

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
const DEFAULT_TEAM_SELECTION = "sim";
const TEAM_PATH_SEGMENT_PATTERN =
  /(team|group|department|unit|organization|organisation)/i;
const MAX_TEAM_WALK_DEPTH = 6;
const MAX_TEAM_WALK_VISITED = 500;
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
  const hasInitializedDefaultSelectionRef = useRef(false);
  const appliedCapacityDefaultUserIdsRef = useRef<Set<string>>(new Set());
  const [from, setFrom] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [to, setTo] = useState(() =>
    format(endOfYear(new Date()), "yyyy-MM-dd"),
  );
  const [availableUsers, setAvailableUsers] = useState<AworkUser[]>([]);
  const [users, setUsers] = useState<AworkUser[]>([]);
  const [schedulesByUser, setSchedulesByUser] = useState<
    Record<string, AworkTaskSchedule[]>
  >({});
  const [selectedTeamNames, setSelectedTeamNames] = useState<Set<string>>(
    new Set(),
  );
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [capacityInputs, setCapacityInputs] = useState<
    Record<string, CapacityInputs>
  >(() => loadCapacityInputs());
  const [capacityDefaultsByUser, setCapacityDefaultsByUser] = useState<
    Record<string, number>
  >({});
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
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [absencesByUser, setAbsencesByUser] = useState<
    Record<string, AworkAbsence[]>
  >({});
  const [absenceLoadFailed, setAbsenceLoadFailed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    saveCapacityInputs(capacityInputs);
  }, [capacityInputs]);

  useEffect(() => {
    if (!currentUser || !isAuthorized || isCheckingAccess) {
      hasInitializedDefaultSelectionRef.current = false;
      appliedCapacityDefaultUserIdsRef.current = new Set();
      setAvailableUsers([]);
      setUsers([]);
      setCapacityDefaultsByUser({});
      setSelectedUserIds(new Set());
      setSelectedTeamNames(new Set());
      return;
    }

    void loadAvailableUsers();
  }, [currentUser, isAuthorized, isCheckingAccess, from, to]);

  const weekCount = useMemo(() => calculateWeekCount(from, to), [from, to]);
  const capacityWeeks = useMemo(() => buildCapacityWeeks(from, to), [from, to]);
  const availableTeams = useMemo(
    () =>
      Array.from(
        new Set(
          availableUsers.flatMap((user) =>
            getUserTeamNames(user).map((teamName) => teamName.toLowerCase()),
          ),
        ),
      )
        .map((teamName) => ({ key: teamName, label: toTeamLabel(teamName) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [availableUsers],
  );
  const usersSelectedForAnalysis = useMemo(() => {
    return availableUsers.filter((user) => selectedUserIds.has(user.id));
  }, [availableUsers, selectedUserIds]);
  const areAllAvailableUsersSelected =
    availableUsers.length > 0 && selectedUserIds.size === availableUsers.length;

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
        const name = schedule.projectName ?? "Projekt nicht aufgelöst";
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
        inputs: getInputsForUser(
          capacityInputs,
          user.id,
          capacityDefaultsByUser[user.id],
        ),
        plannedMinutes,
        blockerCount: schedules.length,
        projectTotals: Array.from(projectTotalsByKey.values()).sort(
          (a, b) => b.minutes - a.minutes,
        ),
      };
    });
  }, [capacityDefaultsByUser, capacityInputs, schedulesByUser, users]);

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
          absencesByUser[row.user.id] ?? [],
          unresolvedProjectHintsByTaskId,
        );
        return {
          row,
          weekRows,
          projectTotals: summarizeWeekProjectTotals(weekRows),
          totals: summarizeWeekRows(weekRows),
        };
      }),
    [
      absencesByUser,
      capacityWeeks,
      selectedRows,
      unresolvedProjectHintsByTaskId,
    ],
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
      (sum, entry) => sum + entry.totals.effectiveCapacityHours,
      0,
    );
    const totalAbsentHours = selectedRowSummaries.reduce(
      (sum, entry) => sum + entry.totals.absentHours,
      0,
    );
    const overloadedUsers = selectedRowSummaries.filter(
      (entry) => entry.totals.isOverloaded,
    ).length;

    return {
      totalPlannedHours,
      totalCapacityHours,
      totalAbsentHours,
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
      const usersToAnalyze = usersSelectedForAnalysis;
      if (usersToAnalyze.length === 0) {
        throw new Error("Mindestens einen Nutzer oder ein Team auswählen.");
      }

      const [schedulesResult] = await Promise.all([
        loadSchedulesForUsers(
          backendClient,
          usersToAnalyze,
          currentUser,
          from,
          to,
        ),
      ]);

      let absenceLoadSucceeded = false;
      let newAbsencesByUser: Record<string, AworkAbsence[]> = {};
      try {
        const absencesRaw = await backendClient.getAbsences();
        const allAbsences = mapAbsencesResponse(absencesRaw);
        newAbsencesByUser = groupAbsencesByUserId(allAbsences);
        absenceLoadSucceeded = true;
      } catch {
        // Absence data unavailable — analysis continues without holiday correction
      }

      setUsers(usersToAnalyze);
      setSchedulesByUser(schedulesResult.schedulesByUser);
      setUnresolvedProjectHintsByTaskId(
        schedulesResult.unresolvedHintsByTaskId,
      );
      setAbsencesByUser(newAbsencesByUser);
      setAbsenceLoadFailed(!absenceLoadSucceeded);

      setSelectedUserIds(new Set(usersToAnalyze.map((user) => user.id)));
      setExpandedUserIds(new Set());
      setHasLoaded(true);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Team-Kapazitätsanalyse konnte nicht geladen werden.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function loadAvailableUsers() {
    setIsLoadingUsers(true);
    setError("");

    try {
      const response = await backendClient.getCapacityAnalysis({ from, to });
      const mappedUsers = mapCapacityUsers(response).sort((a, b) =>
        formatUserName(a).localeCompare(formatUserName(b)),
      );
      const capacityDefaults = mapCapacityDefaults(response);
      setCapacityDefaultsByUser(capacityDefaults);
      applyAworkCapacityDefaults(capacityDefaults);
      const mappedUserIds = new Set(mappedUsers.map((user) => user.id));
      const availableTeamNames = new Set(
        mappedUsers.flatMap((user) =>
          getUserTeamNames(user).map((teamName) => teamName.toLowerCase()),
        ),
      );
      const shouldApplyDefaultTeamSelection =
        !hasInitializedDefaultSelectionRef.current &&
        selectedTeamNames.size === 0 &&
        selectedUserIds.size === 0 &&
        availableTeamNames.has(DEFAULT_TEAM_SELECTION);

      setAvailableUsers(mappedUsers);
      if (shouldApplyDefaultTeamSelection) {
        const defaultTeams = new Set([DEFAULT_TEAM_SELECTION]);
        setSelectedTeamNames(defaultTeams);
        setSelectedUserIds(
          collectUsersMatchingTeams(mappedUsers, defaultTeams),
        );
        hasInitializedDefaultSelectionRef.current = true;
        return;
      }

      setSelectedUserIds((current) => {
        if (selectedTeamNames.size > 0) {
          return collectUsersMatchingTeams(mappedUsers, selectedTeamNames);
        }

        if (current.size === 0) {
          hasInitializedDefaultSelectionRef.current = true;
          return new Set(mappedUsers.map((user) => user.id));
        }

        hasInitializedDefaultSelectionRef.current = true;
        return new Set(
          Array.from(current).filter((userId) => mappedUserIds.has(userId)),
        );
      });
      setSelectedTeamNames((current) => {
        if (current.size === 0) {
          return current;
        }
        return new Set(
          Array.from(current).filter((teamName) =>
            availableTeamNames.has(teamName),
          ),
        );
      });
    } catch (loadError) {
      setAvailableUsers([]);
      setCapacityDefaultsByUser({});
      setSelectedUserIds(new Set());
      setSelectedTeamNames(new Set());
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nutzer für die Kapazitätsanalyse konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingUsers(false);
    }
  }

  function togglePreselectionUser(userId: string, checked: boolean) {
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

  function handleTeamSelectionChange(teamNames: string[]) {
    const nextSelectedTeams = new Set(
      teamNames.map((team) => team.toLowerCase()),
    );
    setSelectedTeamNames(nextSelectedTeams);

    if (nextSelectedTeams.size === 0) {
      setSelectedUserIds(new Set(availableUsers.map((user) => user.id)));
      return;
    }

    setSelectedUserIds(
      collectUsersMatchingTeams(availableUsers, nextSelectedTeams),
    );
  }

  function updateCapacityInput(
    userId: string,
    field: keyof CapacityInputs,
    value: number,
  ) {
    setCapacityInputs((current) => ({
      ...current,
      [userId]: {
        ...getInputsForUser(current, userId, capacityDefaultsByUser[userId]),
        [field]: value,
      },
    }));
  }

  function applyAworkCapacityDefaults(defaults: Record<string, number>) {
    const entriesToApply = Object.entries(defaults).filter(
      ([userId]) => !appliedCapacityDefaultUserIdsRef.current.has(userId),
    );

    if (entriesToApply.length === 0) {
      return;
    }

    setCapacityInputs((current) => {
      let didChange = false;
      const next = { ...current };

      entriesToApply.forEach(([userId, weeklyHours]) => {
        appliedCapacityDefaultUserIdsRef.current.add(userId);
        const existing = current[userId];
        if (existing && existing.weeklyHours !== DEFAULT_WEEKLY_HOURS) {
          return;
        }

        next[userId] = {
          ...defaultInputs(weeklyHours),
          ...existing,
          weeklyHours,
        };
        didChange = true;
      });

      return didChange ? next : current;
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
          <h1>Kapazitätsanalyse</h1>
        </div>
        <div className="analysis-header-actions">
          <p>
            Geplante Projektzeit und verfügbare Team-Kapazität in einer Ansicht.
          </p>
          <a className="ghost-link-button" href={getPlannerHref()}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              style={{ marginRight: 7 }}
            >
              <path
                d="M10.5 3L5.5 8l5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Zurück zum Planner
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
        <LoadingState label="Analyse-Zugriff wird geprüft..." />
      ) : !isAuthorized ? null : (
        <>
          <section className="panel analysis-control-panel">
            <div className="analysis-control-heading">
              <p className="eyebrow">Analysezeitraum</p>
              <h2>Kapazitätsübersicht</h2>
            </div>
            <div className="analysis-control-grid">
              <div className="analysis-date-inputs">
                <div className="form-row">
                  <label htmlFor="analysis-from">Von</label>
                  <DatePickerInput
                    id="analysis-from"
                    value={from}
                    disabled={isLoading}
                    onChange={setFrom}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="analysis-to">Bis</label>
                  <DatePickerInput
                    id="analysis-to"
                    value={to}
                    disabled={isLoading}
                    onChange={setTo}
                  />
                </div>
              </div>
              <div className="analysis-presets">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isLoading}
                  onClick={() => applyDatePreset("this-month")}
                >
                  Dieser Monat
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isLoading}
                  onClick={() => applyDatePreset("next-4-weeks")}
                >
                  Nächste 4 Wochen
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isLoading}
                  onClick={() => applyDatePreset("this-quarter")}
                >
                  Dieses Quartal
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isLoading}
                  onClick={() => applyDatePreset("this-year")}
                >
                  Dieses Jahr
                </button>
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={
                  isLoading ||
                  isLoadingUsers ||
                  usersSelectedForAnalysis.length === 0
                }
                title={
                  usersSelectedForAnalysis.length === 0
                    ? "Erst unten mindestens einen Nutzer auswählen"
                    : undefined
                }
                onClick={() => void loadAnalysis()}
              >
                {isLoading ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    Wird geladen...
                  </>
                ) : (
                  "Analyse starten"
                )}
              </button>
            </div>
            <p className="analysis-range-note">
              {usersSelectedForAnalysis.length} von {availableUsers.length}{" "}
              Nutzern für die Analyse ausgewählt.
            </p>
            <div className="analysis-selection-tools">
              <div className="form-row analysis-team-filter-row">
                <label htmlFor="analysis-team-filter">Teams</label>
                <MultiSearchableSelect
                  buttonId="analysis-team-filter"
                  values={Array.from(selectedTeamNames)}
                  options={availableTeams.map((team) => ({
                    value: team.key,
                    label: team.label,
                  }))}
                  placeholder={
                    availableTeams.length > 0
                      ? "Ein oder mehrere Teams auswählen"
                      : "Keine Teams gefunden"
                  }
                  searchPlaceholder={formatSearchPlaceholder(
                    "Teams filtern",
                    availableTeams.length,
                  )}
                  emptyLabel="Keine Teams gefunden"
                  disabled={isLoading || isLoadingUsers}
                  onChange={handleTeamSelectionChange}
                />
              </div>
              <div className="analysis-selection-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isLoading || isLoadingUsers}
                  onClick={() => void loadAvailableUsers()}
                >
                  {isLoadingUsers ? (
                    <>
                      <span className="button-spinner" aria-hidden="true" />
                      Wird geladen...
                    </>
                  ) : (
                    "Nutzer neu laden"
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={availableUsers.length === 0}
                  onClick={() => {
                    if (areAllAvailableUsersSelected) {
                      setSelectedUserIds(new Set());
                      return;
                    }

                    setSelectedUserIds(
                      new Set(availableUsers.map((user) => user.id)),
                    );
                  }}
                >
                  {areAllAvailableUsersSelected
                    ? "Alle abwählen"
                    : "Alle auswählen"}
                </button>
              </div>
            </div>
            <div
              className="analysis-user-chips"
              role="group"
              aria-label="Nutzer"
            >
              {availableUsers.map((user) => {
                const isSelected = selectedUserIds.has(user.id);
                return (
                  <button
                    type="button"
                    key={user.id}
                    className={`user-chip${isSelected ? " is-selected" : ""}`}
                    aria-pressed={isSelected}
                    title={formatUserName(user)}
                    onClick={() => togglePreselectionUser(user.id, !isSelected)}
                  >
                    <span className="user-chip-check" aria-hidden="true">
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
                        <path
                          d="M2 6.5l2.5 2.5L10 3.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    {shortUserName(user)}
                  </button>
                );
              })}
            </div>
          </section>

          {absenceLoadFailed && hasLoaded ? (
            <section className="analysis-absence-warning" role="alert">
              <div>
                <strong>Abwesenheiten konnten nicht geladen werden.</strong>
                <span>
                  Die Kapazitätsberechnung läuft ohne Urlaubskorrektur.
                </span>
              </div>
              <div className="analysis-absence-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isLoading}
                  onClick={() => void loadAnalysis()}
                >
                  Nochmal versuchen
                </button>
                <button
                  type="button"
                  className="ghost-button analysis-absence-dismiss"
                  onClick={() => setAbsenceLoadFailed(false)}
                >
                  Schließen
                </button>
              </div>
            </section>
          ) : null}

          {isLoading ? (
            <LoadingState label="Team-Kapazität wird geladen..." />
          ) : null}

          {!hasLoaded && !isLoading ? (
            <section className="panel">
              <div className="empty-state">
                <p>
                  {usersSelectedForAnalysis.length === 0
                    ? "Oben mindestens einen Nutzer auswählen, dann „Analyse starten“ klicken."
                    : "Alles bereit — „Analyse starten“ klicken, um die Team-Kapazität zu laden."}
                </p>
              </div>
            </section>
          ) : null}

          {hasLoaded ? (
            <>
              <SummaryCards
                totalPlannedHours={summary.totalPlannedHours}
                totalCapacityHours={summary.totalCapacityHours}
                totalAbsentHours={summary.totalAbsentHours}
                averageWorkload={summary.averageWorkload}
                overloadedUsers={summary.overloadedUsers}
              />

              <section className="panel analysis-chart-panel">
                <div className="analysis-section-heading analysis-section-heading-chart">
                  <div>
                    <p className="eyebrow">Projekte und Kapazität</p>
                    <h2>Geplante Zeit pro Nutzer</h2>
                  </div>
                  <div className="analysis-chart-controls">
                    <div className="analysis-chart-toolbar">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          setShowCollapsedRangeBars((current) => !current)
                        }
                      >
                        {showCollapsedRangeBars
                          ? "Gesamtbalken ausblenden"
                          : "Gesamtbalken einblenden"}
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
                          ? "Alle Nutzer einklappen"
                          : "Alle Nutzer ausklappen"}
                      </button>
                      <div className="analysis-toolbar-divider" />
                      <div className="analysis-workload-filter">
                        <SegmentedControl
                          value={workloadFilterMode}
                          options={workloadFilterOptions}
                          ariaLabel="Auslastungsvergleich"
                          onChange={setWorkloadFilterMode}
                        />
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
                            aria-label="Auslastungsschwellenwert Prozent"
                          />
                          <span>%</span>
                        </div>
                      </div>
                    </div>
                    <div className="capacity-bulk-inputs">
                      <label>
                        <span>Wochenstunden</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="—"
                          value={bulkWeeklyHoursInput}
                          aria-invalid={isInvalidNumberInput(
                            bulkWeeklyHoursInput,
                          )}
                          className={
                            isInvalidNumberInput(bulkWeeklyHoursInput)
                              ? "input-invalid"
                              : undefined
                          }
                          onChange={(event) =>
                            setBulkWeeklyHoursInput(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>Kunden %</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="70"
                          value={bulkCustomerPercentInput}
                          aria-invalid={isInvalidNumberInput(
                            bulkCustomerPercentInput,
                          )}
                          className={
                            isInvalidNumberInput(bulkCustomerPercentInput)
                              ? "input-invalid"
                              : undefined
                          }
                          onChange={(event) =>
                            setBulkCustomerPercentInput(event.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="ghost-button"
                        title="Setzt nur die ausgefüllten Felder für alle ausgewählten Nutzer."
                        disabled={
                          visibleSelectedRowSummaries.length === 0 ||
                          (!bulkWeeklyHoursInput &&
                            !bulkCustomerPercentInput) ||
                          isInvalidNumberInput(bulkWeeklyHoursInput) ||
                          isInvalidNumberInput(bulkCustomerPercentInput)
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
                          if (bulkCustomerPercentInput) {
                            const value = readPercentNumber(
                              bulkCustomerPercentInput,
                            );
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
                        Auf Auswahl anwenden
                      </button>
                    </div>
                  </div>
                </div>
                <div className="capacity-chart-legend" aria-label="Legende">
                  <input
                    id="analysis-user-search"
                    className="analysis-user-search"
                    aria-label="Nutzer suchen"
                    type="search"
                    value={chartUserSearch}
                    placeholder="Nutzer filtern..."
                    onChange={(event) => setChartUserSearch(event.target.value)}
                  />
                  <button
                    type="button"
                    className="ghost-button capacity-export-all-button"
                    disabled={visibleSelectedRowSummaries.length === 0}
                    title="Kapazität aller angezeigten Nutzer als CSV exportieren"
                    onClick={() =>
                      exportCapacityCsv(
                        visibleSelectedRowSummaries,
                        "kapazitaet-alle-nutzer",
                      )
                    }
                  >
                    <CsvExportIcon />
                    CSV exportieren
                  </button>
                  <span>
                    <i className="legend-swatch legend-swatch-capacity" />
                    Kapazität (Wochenstunden)
                  </span>
                  <span>
                    <i className="legend-swatch legend-swatch-planned" />
                    Geplante Projektzeit
                  </span>
                  <span>
                    <i className="legend-swatch legend-swatch-target" />
                    Kunden-Ziel — darüber gilt als überplant
                  </span>
                  <span>
                    <i className="legend-swatch legend-swatch-absent" />
                    Abwesenheit
                  </span>
                  <span>
                    <i className="legend-swatch legend-swatch-current-week" />
                    Aktuelle Woche
                  </span>
                </div>
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
                        ? "Mindestens einen Nutzer auswählen."
                        : "Keine Nutzer entsprechen der Suche oder dem Auslastungsfilter."}
                    </p>
                  </div>
                )}
              </section>

              <section className="panel analysis-table-panel">
                <div className="analysis-section-heading">
                  <div>
                    <p className="eyebrow">Details</p>
                    <h2>Nutzer-Kapazitätstabelle</h2>
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
                        ? "Tabelle einblenden"
                        : "Tabelle einklappen"}
                    </button>
                  </div>
                </div>
                {!isDetailsTableCollapsed ? (
                  <div className="analysis-table-wrap">
                    <table className="analysis-table">
                      <thead>
                        <tr>
                          <th>Nutzer</th>
                          <th>Geplant</th>
                          <th>Wochenstunden</th>
                          <th>Kundenziel</th>
                          <th>Auslastung</th>
                          <th>Blocker</th>
                          <th>Projekte</th>
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
  totalPlannedHours,
  totalCapacityHours,
  totalAbsentHours,
  averageWorkload,
  overloadedUsers,
}: {
  totalPlannedHours: number;
  totalCapacityHours: number;
  totalAbsentHours: number;
  averageWorkload: number;
  overloadedUsers: number;
}) {
  return (
    <section className="panel analysis-summary-panel">
      <div className="analysis-summary-heading">
        <p className="eyebrow">Kapazitätszusammenfassung</p>
        <h2>Zahlen, Daten, Fakten</h2>
      </div>
      <div className="analysis-summary-grid">
        <SummaryCard
          label="Stunden"
          value={`${formatHours(totalPlannedHours)} / ${formatHours(totalCapacityHours)}`}
          title="Geplante Stunden geteilt durch die verfügbare Kapazität (nach Abwesenheiten) aller ausgewählten Nutzer im Zeitraum."
        />
        <SummaryCard
          label="Durchschnittliche Auslastung"
          value={`${formatDecimal(averageWorkload)}%`}
          title="Geplante Stunden geteilt durch Gesamtkapazität der ausgewählten Nutzer."
        />
        <SummaryCard
          label="Urlaub"
          value={formatHours(totalAbsentHours)}
          title="Summe aller Abwesenheitsstunden (Urlaub, Feiertage) aller ausgewählten Nutzer im Zeitraum."
        />
        <SummaryCard
          label="Überlastete Nutzer"
          value={String(overloadedUsers)}
          title="Nutzer, deren geplante Stunden die Gesamtkapazität übersteigen."
        />
      </div>
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
  const [copied, setCopied] = useState(false);

  function copyCapacitySummary() {
    const text = `${formatUserName(row.user)} — ${formatDecimal(totals.customerTargetPercent)}% (${formatHours(totals.plannedHours)} / ${formatHours(totals.effectiveCapacityHours)})`;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function exportUserCapacity() {
    exportCapacityCsv(
      [{ row, weekRows }],
      `kapazitaet-${slugifyName(formatUserName(row.user))}`,
    );
  }

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
              <span className="overbooked-label">Überplant</span>
            )}
            {totals.absentDays > 0 && (
              <span
                className="capacity-absent-badge"
                title={`${formatHours(totals.absentHours)} Kapazität durch Abwesenheit reduziert`}
              >
                {formatAbsentDays(totals.absentDays)} Urlaub
              </span>
            )}
            <button
              type="button"
              className="capacity-icon-button"
              aria-label="Kapazitätszusammenfassung kopieren"
              title="Kapazitätszusammenfassung in Zwischenablage kopieren"
              onClick={copyCapacitySummary}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button
              type="button"
              className="capacity-icon-button"
              aria-label="Kapazität dieses Nutzers als CSV exportieren"
              title="Kapazität dieses Nutzers als CSV exportieren"
              onClick={exportUserCapacity}
            >
              <CsvExportIcon />
            </button>
          </div>
          <span
            style={{ color: workloadColor }}
            title="Erfüllung des Kundenziels: geplante Stunden geteilt durch das Kunden-%-Ziel für den gewählten Zeitraum."
          >
            {formatHours(totals.plannedHours)} geplant –{" "}
            {formatDecimal(totals.customerTargetPercent)}%
          </span>
          <span className="capacity-user-capacity">
            {formatHours(totals.effectiveCapacityHours)} verfügbar
            {" · "}
            {formatHours(totals.targetHours)} Kunden-Ziel
          </span>
        </div>
        <button
          type="button"
          className="ghost-button capacity-expand-button"
          aria-expanded={isExpanded}
          onClick={onToggleExpanded}
        >
          {isExpanded ? "Wochen einklappen" : "Wochen einblenden"}
        </button>
        <div className="capacity-inputs">
          <label>
            Wochenstunden
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9.]*"
              min="0"
              value={row.inputs.weeklyHours}
              title="Vertraglich vereinbarte Arbeitsstunden pro Woche. Jeder Wochenbalken nutzt diesen Wert als 100 %-Kapazität, anteilig für Teilwochen."
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
            Kunden %
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min="0"
              max="100"
              value={row.inputs.customerPercent}
              title="Zielanteil der Wochenstunden für Kunden-/Projektarbeit. Der gelbe Marker nutzt diesen Prozentsatz der Gesamtkapazität."
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
            aria-label={`Geplante Projektstunden von ${formatUserName(row.user)} pro Kalenderwoche`}
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
                title={`${project.name}: ${project.blockerCount} Blocker, ${formatHours(project.minutes / 60)} geplant`}
              >
                <i style={{ background: projectColorFor(project.key) }} />
                {project.name}
              </span>
            ))}
            {totals.absentHours > 0 && (
              <span
                title={`${formatHours(totals.absentHours)} durch Abwesenheit nicht verfügbar`}
              >
                <i className="capacity-legend-absent-swatch" />
                Abwesenheit ({formatHours(totals.absentHours)})
              </span>
            )}
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
  const pct = (h: number) =>
    totals.totalCapacityHours > 0
      ? (h / totals.totalCapacityHours) * (10000 / displayPercent)
      : 0;
  const availableZonePercent = pct(totals.effectiveCapacityHours);
  const absentZonePercent = pct(totals.absentHours);
  const stackWidthPercent = pct(totals.plannedHours);
  const customerMarkerPercent = pct(totals.targetHours);
  const hasAbsent = absentZonePercent > 0;
  const customerTargetTooltip = `Erwartete Projektkapazität | ${formatHours(totals.targetHours)}\nDieser Balken repräsentiert ${customerPercent} % der verfügbaren Kapazität`;
  const absentTooltip = `Abwesenheit\n${formatAbsentDays(totals.absentDays)} · ${formatHours(totals.absentHours)} weniger Kapazität`;

  return (
    <div className="capacity-range-overview">
      <div className="capacity-range-overview-head">
        <strong>Gewählter Zeitraum</strong>
        <span>
          {formatHours(totals.plannedHours)} geplant ·{" "}
          {formatDecimal(totals.customerTargetPercent)}%
        </span>
      </div>
      <div
        className="capacity-range-track"
        aria-label={`Gewählter Zeitraum: ${formatHours(totals.plannedHours)} geplant von ${formatHours(totals.effectiveCapacityHours)} verfügbarer Kapazität.`}
      >
        <div
          className="capacity-range-inner"
          style={{ width: `${displayPercent}%` }}
        >
          <div
            className={`capacity-zone${hasAbsent ? " capacity-zone--partial" : ""}`}
            style={{ width: `${availableZonePercent}%` }}
          />
          {hasAbsent && (
            <div
              className={`capacity-absent-zone${availableZonePercent <= 0 ? " capacity-absent-zone--isolated" : ""}`}
              style={{
                left: `${availableZonePercent}%`,
                width: `${absentZonePercent}%`,
              }}
              aria-label={absentTooltip}
              onMouseEnter={(event) => onTooltip(absentTooltip, event)}
              onMouseMove={(event) => onTooltip(absentTooltip, event)}
              onMouseLeave={onTooltipClear}
            />
          )}
          <div
            className="capacity-stacked-bar"
            style={{ width: `${stackWidthPercent}%` }}
          >
            {projectTotals.length > 0 && totals.plannedHours > 0 ? (
              projectTotals.map((project) => {
                const tooltipText = `${project.name}\n${formatHours(project.minutes / 60)} geplant\n${project.blockerCount} Blocker${project.unresolvedHint ? `\nHinweis: ${project.unresolvedHint}` : ""}`;

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
                aria-label="Keine geplante Projektzeit"
                title="Keine geplante Projektzeit"
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
  const pct = (h: number) =>
    weekRow.totalCapacityHours > 0
      ? (h / weekRow.totalCapacityHours) * (10000 / displayPercent)
      : 0;
  const availableZonePercent = pct(weekRow.effectiveCapacityHours);
  const absentZonePercent = pct(weekRow.absentHours);
  const stackWidthPercent = pct(weekRow.plannedMinutes / 60);
  const customerMarkerPercent = pct(weekRow.targetHours);
  const hasAbsent = absentZonePercent > 0;
  const isOverbooked = weekRow.customerTargetPercent > 100;
  const weekWorkingDays = countWorkingDaysInRange(
    weekRow.week.from,
    weekRow.week.to,
  );
  const isPartialWeek = weekWorkingDays < 5;
  const isCurrentWeek = weekRow.week.key === currentIsoWeekKey();
  const customerTargetTooltip = `Erwartete Projektkapazät | ${formatHours(weekRow.targetHours)}\nDieser Balken repräsentiert ${customerPercent} % der Wochenstunden`;
  const absentTooltip = `Abwesenheit\n${formatAbsentDays(weekRow.absentDays)} · ${formatHours(weekRow.absentHours)} weniger Kap.`;

  return (
    <div
      className={`capacity-week ${isOverbooked ? "is-overbooked" : ""} ${isCurrentWeek ? "is-current-week" : ""}`}
    >
      <div
        className="capacity-week-label"
        title={`${weekRow.week.label}: ${format(weekRow.week.from, "dd.MM.yyyy")} - ${format(weekRow.week.to, "dd.MM.yyyy")}`}
      >
        <strong>{weekRow.week.label}</strong>
        <div className="capacity-week-label-right">
          {isPartialWeek && (
            <span
              className="capacity-week-partial-note"
              title={`Nur ${weekWorkingDays} von 5 Arbeitstagen im gewählten Zeitraum`}
            >
              {weekWorkingDays} Tage
            </span>
          )}
          <span>
            {format(weekRow.week.from, "dd.MM")} -{" "}
            {format(weekRow.week.to, "dd.MM")}
          </span>
        </div>
      </div>
      <div
        className="capacity-week-track"
        aria-label={`${weekRow.week.label}: ${formatHours(weekRow.plannedMinutes / 60)} geplant von ${formatHours(weekRow.effectiveCapacityHours)} verfügbarer Kap.`}
      >
        <div
          className="capacity-week-inner"
          style={{ width: `${displayPercent}%` }}
        >
          <div
            className={`capacity-zone${hasAbsent ? " capacity-zone--partial" : ""}`}
            style={{ width: `${availableZonePercent}%` }}
          />
          {hasAbsent && (
            <div
              className={`capacity-absent-zone${availableZonePercent <= 0 ? " capacity-absent-zone--isolated" : ""}`}
              style={{
                left: `${availableZonePercent}%`,
                width: `${absentZonePercent}%`,
              }}
              aria-label={absentTooltip}
              onMouseEnter={(event) => onTooltip(absentTooltip, event)}
              onMouseMove={(event) => onTooltip(absentTooltip, event)}
              onMouseLeave={onTooltipClear}
            />
          )}
          <div
            className="capacity-stacked-bar"
            style={{ width: `${stackWidthPercent}%` }}
          >
            {weekRow.projectTotals.length > 0 && weekRow.plannedMinutes > 0 ? (
              weekRow.projectTotals.map((project) => {
                const tooltipText = `${project.name}\n${formatHours(project.minutes / 60)} geplant\n${project.blockerCount} Blocker${project.unresolvedHint ? `\nHinweis: ${project.unresolvedHint}` : ""}`;

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
                aria-label="Keine geplante Projektzeit"
                title="Keine geplante Projektzeit"
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
        <span>
          {formatHours(weekRow.plannedMinutes / 60)}
          <span className="capacity-week-cap">
            {" "}
            / {formatHours(weekRow.effectiveCapacityHours)}
          </span>
        </span>
        <span
          style={{ color: getWorkloadColor(weekRow.customerTargetPercent) }}
        >
          {formatDecimal(weekRow.customerTargetPercent)}%
        </span>
      </div>
    </div>
  );
}

function mapCapacityUsers(response: unknown): AworkUser[] {
  if (!isCapacityResponse(response)) {
    throw new Error(
      "Kapazitätsanalyse-Antwort konnte nicht verarbeitet werden.",
    );
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

function mapCapacityDefaults(response: unknown): Record<string, number> {
  if (!isCapacityResponse(response) || !isRecord(response.userCapacities)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(response.userCapacities).flatMap(([userId, rawCapacity]) => {
      const capacity = mapUserCapacity(rawCapacity);
      const weeklyHours = capacity ? getWeeklyCapacityHours(capacity) : null;
      return typeof weeklyHours === "number" ? [[userId, weeklyHours]] : [];
    }),
  );
}

function mapUserCapacity(rawCapacity: unknown): AworkUserCapacity | null {
  if (!isRecord(rawCapacity)) {
    return null;
  }

  const userId = typeof rawCapacity.userId === "string" ? rawCapacity.userId : "";
  const weeklyCapacity = isRecord(rawCapacity.weeklyCapacity)
    ? Object.fromEntries(
        Object.entries(rawCapacity.weeklyCapacity).filter(
          ([, value]) => typeof value === "number",
        ),
      )
    : undefined;
  const capacityPerWeek =
    typeof rawCapacity.capacityPerWeek === "number"
      ? rawCapacity.capacityPerWeek
      : undefined;

  return { userId, weeklyCapacity, capacityPerWeek };
}

function getWeeklyCapacityHours(capacity: AworkUserCapacity): number | null {
  if (typeof capacity.capacityPerWeek === "number") {
    return capacity.capacityPerWeek / 3600;
  }

  if (capacity.weeklyCapacity) {
    const seconds = Object.values(capacity.weeklyCapacity).reduce(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0,
    );
    return seconds > 0 ? seconds / 3600 : null;
  }

  return null;
}

function getUserTeamNames(user: AworkUser): string[] {
  const candidates = collectTeamCandidates(user.raw);
  const normalized = candidates
    .flatMap((candidate) =>
      candidate
        .split(/[\/|;,]/)
        .map((value) => value.trim())
        .filter(Boolean),
    )
    .filter((candidate) => isValidTeamCandidate(candidate))
    .map((candidate) => normalizeTeamName(candidate));

  return Array.from(new Set(normalized));
}

function collectUsersMatchingTeams(
  users: AworkUser[],
  selectedTeamNames: Set<string>,
): Set<string> {
  return new Set(
    users
      .filter((user) => {
        const userTeamNames = new Set(
          getUserTeamNames(user).map((teamName) => teamName.toLowerCase()),
        );
        return Array.from(selectedTeamNames).some((teamName) =>
          userTeamNames.has(teamName),
        );
      })
      .map((user) => user.id),
  );
}

function toTeamLabel(teamName: string): string {
  return teamName
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 4) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isValidTeamCandidate(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 48) {
    return false;
  }

  if (!/[a-zA-Z]/.test(normalized)) {
    return false;
  }

  // Drop unresolved ids (UUID-like values and long hash-like tokens).
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
      normalized,
    )
  ) {
    return false;
  }

  if (/^[0-9a-fA-F_-]{20,}$/.test(normalized)) {
    return false;
  }

  return true;
}

function collectTeamCandidates(raw: unknown): string[] {
  const candidates: string[] = [];
  const visited = { count: 0 };
  walkTeamPayload(raw, [], candidates, visited, 0);
  return candidates;
}

function walkTeamPayload(
  value: unknown,
  path: string[],
  candidates: string[],
  visited: { count: number },
  depth: number,
): void {
  if (depth > MAX_TEAM_WALK_DEPTH || visited.count >= MAX_TEAM_WALK_VISITED) {
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
      walkTeamPayload(
        item,
        [...path, String(index)],
        candidates,
        visited,
        depth + 1,
      );
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  Object.entries(value).forEach(([key, nested]) => {
    walkTeamPayload(nested, [...path, key], candidates, visited, depth + 1);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
              "Aufgaben-Details konnten nicht aus der awork-Antwort verarbeitet werden.";
          }
          return mappedTask;
        } catch {
          unresolvedHintsByTaskId[taskId] =
            "Aufgaben-Details konnten nicht von awork geladen werden.";
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
        "Aufgaben-ID wurde nicht in den zugewiesenen Aufgaben gefunden und Einzelabruf schlug fehl.";
      return;
    }

    if (!task.projectId) {
      unresolvedHintsByTaskId[schedule.taskId] =
        "Aufgabe hat keine Projekt-ID.";
      return;
    }

    if (!task.projectName) {
      unresolvedHintsByTaskId[schedule.taskId] =
        "Aufgabe hat keinen Projektnamen.";
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
  userAbsences: AworkAbsence[],
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
      const name = schedule.projectName ?? "Projekt nicht aufgelöst";
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

    const totalCapacityHours = calculateWeekCapacityHours(
      row.inputs.weeklyHours,
      week,
    );
    const absentDays = calculateAbsentWorkingDays(
      userAbsences,
      row.user.id,
      week.from,
      week.to,
    );
    const absentHours = Math.min(
      totalCapacityHours,
      absentDays * (row.inputs.weeklyHours / 5),
    );
    const effectiveCapacityHours = Math.max(
      0,
      totalCapacityHours - absentHours,
    );
    const targetHours =
      effectiveCapacityHours * (row.inputs.customerPercent / 100);
    const plannedHours = plannedMinutes / 60;
    const utilizationPercent =
      effectiveCapacityHours > 0
        ? (plannedHours / effectiveCapacityHours) * 100
        : plannedMinutes > 0
          ? 100
          : 0;
    const customerTargetPercent =
      effectiveCapacityHours > 0
        ? (plannedHours / effectiveCapacityHours) * 100
        : plannedMinutes > 0
          ? 100
          : 0;

    return {
      week,
      totalCapacityHours,
      absentHours,
      absentDays,
      effectiveCapacityHours,
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
  const totalCapacityHours = weekRows.reduce(
    (sum, week) => sum + week.totalCapacityHours,
    0,
  );
  const absentHours = weekRows.reduce((sum, week) => sum + week.absentHours, 0);
  const absentDays = weekRows.reduce((sum, week) => sum + week.absentDays, 0);
  const effectiveCapacityHours = Math.max(0, totalCapacityHours - absentHours);
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
    totalCapacityHours,
    absentHours,
    absentDays,
    effectiveCapacityHours,
    targetHours,
    workloadPercent:
      effectiveCapacityHours > 0
        ? (plannedHours / effectiveCapacityHours) * 100
        : 0,
    customerTargetPercent:
      effectiveCapacityHours > 0 ? (plannedHours / effectiveCapacityHours) * 100 : 0,
    blockerCount,
    isOverloaded: targetHours > 0 && plannedHours > targetHours,
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
  const workingDays = countWorkingDaysInRange(week.from, week.to);
  return weeklyHours * (workingDays / 5);
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
  defaultWeeklyHours = DEFAULT_WEEKLY_HOURS,
): CapacityInputs {
  return inputs[userId] ?? defaultInputs(defaultWeeklyHours);
}

function defaultInputs(weeklyHours = DEFAULT_WEEKLY_HOURS): CapacityInputs {
  return {
    weeklyHours,
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
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function readPercentNumber(value: string): number {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(100, Math.max(0, parsed));
}

function isInvalidNumberInput(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  return !Number.isFinite(Number(value.replace(",", ".")));
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

function shortUserName(user: AworkUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email || user.id;
}

function formatHours(hours: number): string {
  return `${formatDecimal(hours)} h`;
}

function formatDecimal(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(".", ",");
}

function formatAbsentDays(days: number): string {
  if (days <= 0) return "";
  const rounded = Math.round(days * 2) / 2;
  if (rounded === 0.5) return "½ Tag";
  const whole = Math.floor(rounded);
  const half = rounded - whole === 0.5;
  if (whole === 0) return "½ Tag";
  return half ? `${whole}½ Tage` : `${whole} ${whole === 1 ? "Tag" : "Tage"}`;
}

function formatTopProjects(projects: ProjectTotal[]): string {
  if (projects.length === 0) {
    return "Keine Projektzeit";
  }

  return projects
    .map((project) => `${project.name} (${formatHours(project.minutes / 60)})`)
    .join(", ");
}

function renderTopProjects(projects: ProjectTotal[]) {
  if (projects.length === 0) {
    return "Keine Projektzeit";
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

function currentIsoWeekKey(): string {
  const now = new Date();
  return `${format(now, "RRRR")}-${getISOWeek(now)}`;
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="5.5"
        y="5.5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M3 10.5H2.5A1.5 1.5 0 0 1 1 9V2.5A1.5 1.5 0 0 1 2.5 1H9A1.5 1.5 0 0 1 10.5 2.5V3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5L6.5 12L13 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CsvExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5V10M8 10L5 7M8 10L11 7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 11V13A1.5 1.5 0 0 0 4 14.5H12A1.5 1.5 0 0 0 13.5 13V11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function exportCapacityCsv(
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

function csvNumber(value: number): string {
  return (Math.round(value * 10) / 10).toString().replace(".", ",");
}

function slugifyName(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "nutzer"
  );
}
