import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  endOfWeek,
  format,
  getDay,
  getISOWeek,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  startOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import {
  calculateAbsentFractionForDay,
  calculateAbsentWorkingDays,
  countWorkingDaysInRange,
  getAbsentHalfForDay,
  groupAbsencesByUserId,
  mapAbsencesResponse,
  type AbsentDayHalf,
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
import { ErrorAlert } from "./ErrorAlert";
import { LoadingState } from "./LoadingState";
import {
  formatSearchPlaceholder,
  MultiSearchableSelect,
} from "./SearchableSelect";
import { DatePickerInput } from "./DatePickerInput";
import { SegmentedControl } from "./SegmentedControl";
import { CapacityTableView } from "./CapacityTableView";

interface CapacityAnalysisPageProps {
  backendClient: BackendClient;
  currentUser?: AworkUser;
  isConnecting: boolean;
  isAuthorized: boolean;
  isCheckingAccess: boolean;
  showTableViewBadge: boolean;
  onTableViewSeen: () => void | Promise<void>;
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

type UserExpandMode = "weeks" | "days";

interface DayScheduleDetail {
  scheduleId: string;
  projectKey: string;
  projectName: string;
  taskName?: string;
  startHHmm: string;
  endHHmm: string;
  minutes: number;
  unresolvedHint?: string;
}

interface UserCapacityDay {
  key: string;
  date: Date;
  label: string;
  isWeekend: boolean;
  dayCapacityHours: number;
  absentFraction: number;
  absentHalf: AbsentDayHalf;
  absentHours: number;
  effectiveCapacityHours: number;
  plannedMinutes: number;
  utilizationPercent: number;
  segments: DayScheduleDetail[];
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
const DEFAULT_CUSTOMER_PERCENT = 70;
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
const ANALYSIS_LOADING_MESSAGES = [
  "Analyse wird vorbereitet...",
  "Stunden werden analysiert...",
  "Kapazitäten werden berechnet...",
  "Teamübersicht wird aufgebaut...",
];

export function CapacityAnalysisPage({
  backendClient,
  currentUser,
  isConnecting,
  isAuthorized,
  isCheckingAccess,
  showTableViewBadge,
  onTableViewSeen,
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
  const [expandedViewByUser, setExpandedViewByUser] = useState<
    Map<string, UserExpandMode>
  >(new Map());
  const [showCollapsedRangeBars, setShowCollapsedRangeBars] = useState(true);
  const [workloadFilterMode, setWorkloadFilterMode] =
    useState<WorkloadFilterMode>("all");
  const [workloadFilterValue, setWorkloadFilterValue] = useState(80);
  const [bulkWeeklyHoursInput, setBulkWeeklyHoursInput] = useState("");
  const [bulkCustomerPercentInput, setBulkCustomerPercentInput] = useState("");
  const [unresolvedProjectHintsByTaskId, setUnresolvedProjectHintsByTaskId] =
    useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<"bar" | "table" | "overview">(
    "bar",
  );
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [absencesByUser, setAbsencesByUser] = useState<
    Record<string, AworkAbsence[]>
  >({});
  const [absenceLoadFailed, setAbsenceLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [analysisLoadingMessageIndex, setAnalysisLoadingMessageIndex] =
    useState(0);

  function handleViewModeChange(nextViewMode: "bar" | "table" | "overview") {
    setViewMode(nextViewMode);
    if (nextViewMode === "table" && showTableViewBadge) {
      void onTableViewSeen();
    }
  }

  useEffect(() => {
    saveCapacityInputs(capacityInputs);
  }, [capacityInputs]);

  useEffect(() => {
    if (!isLoading) {
      setAnalysisLoadingMessageIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setAnalysisLoadingMessageIndex((current) =>
        current >= ANALYSIS_LOADING_MESSAGES.length - 1 ? 0 : current + 1,
      );
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoading]);

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
      expandedViewByUser.has(entry.row.user.id),
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
      setExpandedViewByUser(new Map());
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

  function resetConfigurationToDefaults() {
    setBulkWeeklyHoursInput("");
    setBulkCustomerPercentInput("");
    setCapacityInputs((current) => {
      const next: Record<string, CapacityInputs> = {};
      Object.entries(current).forEach(([userId, value]) => {
        next[userId] = {
          ...value,
          weeklyHours: capacityDefaultsByUser[userId] ?? DEFAULT_WEEKLY_HOURS,
          customerPercent: DEFAULT_CUSTOMER_PERCENT,
        };
      });
      return next;
    });
  }

  function toggleUserExpandMode(userId: string, mode: UserExpandMode) {
    setExpandedViewByUser((current) => {
      const next = new Map(current);
      if (next.get(userId) === mode) {
        next.delete(userId);
      } else {
        next.set(userId, mode);
      }
      return next;
    });
  }

  function applyDatePreset(
    preset:
      | "this-week"
      | "this-month"
      | "next-4-weeks"
      | "this-quarter"
      | "this-year",
  ) {
    const now = new Date();

    switch (preset) {
      case "this-week": {
        setFrom(format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"));
        setTo(format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"));
        return;
      }
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
        </div>
      </header>

      <ErrorAlert message={error} />

      {!currentUser ? null : isCheckingAccess ? (
        <LoadingState label="Analyse-Zugriff wird geprüft..." />
      ) : !isAuthorized ? null : (
        <>
          <section className="panel analysis-control-panel">
            <div className="analysis-control-heading">
              <p className="eyebrow">Analysezeitraum</p>
              <h2>Kapazitätsübersicht</h2>
            </div>
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
            <hr className="analysis-divider" />
            <p className="analysis-range-note">
              {usersSelectedForAnalysis.length} von {availableUsers.length}{" "}
              Nutzern für die Analyse ausgewählt.
            </p>
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
                  onClick={() => applyDatePreset("this-week")}
                >
                  Diese Woche
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
                  onClick={() => applyDatePreset("this-month")}
                >
                  Dieser Monat
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
            <section className="panel analysis-loading-panel" aria-live="polite">
              <div className="analysis-loading-content">
                <p
                  key={analysisLoadingMessageIndex}
                  className="analysis-loading-message"
                >
                  {
                    ANALYSIS_LOADING_MESSAGES[
                      analysisLoadingMessageIndex
                    ]
                  }
                </p>
                <div className="analysis-loading-bar" aria-hidden="true">
                  <span className="analysis-loading-bar-indicator" />
                </div>
              </div>
            </section>
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

              <section className="panel">
                <div className="analysis-section-heading analysis-section-heading-chart">
                  <div>
                    <p className="eyebrow">Projekte und Kapazität</p>
                    <h2>Geplante Zeit pro Nutzer</h2>
                  </div>
                  <div className="analysis-chart-controls">
                    <SegmentedControl
                      value={viewMode}
                      options={[
                        { value: "bar" as const, label: "Balkenansicht" },
                        {
                          value: "table" as const,
                          label: "Tabellenansicht",
                          badgeText: showTableViewBadge ? "" : undefined,
                          badgeVariant: showTableViewBadge ? "dot" : undefined,
                          className: showTableViewBadge
                            ? "capacity-table-option-pulse"
                            : undefined,
                        },
                        { value: "overview" as const, label: "Übersicht" },
                      ]}
                      ariaLabel="Ansicht wechseln"
                      onChange={handleViewModeChange}
                    />
                  </div>
                </div>
                <section
                  className="capacity-config-panel"
                  aria-label="Konfiguration"
                >
                  <div className="capacity-config-header">
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 4.5h6.5M13 4.5H14M2 11.5h2M8.5 11.5H14"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      />
                      <circle
                        cx="10.75"
                        cy="4.5"
                        r="1.9"
                        stroke="currentColor"
                        strokeWidth="1.7"
                      />
                      <circle
                        cx="6.25"
                        cy="11.5"
                        r="1.9"
                        stroke="currentColor"
                        strokeWidth="1.7"
                      />
                    </svg>
                    <h3>Konfiguration</h3>
                  </div>
                  <div
                    className="capacity-config-bar"
                    role="group"
                    aria-label="Analyse-Einstellungen"
                  >
                  {viewMode === "bar" ? (
                    <>
                      <div className="capacity-config-item">
                        <span className="capacity-config-label">Diagramm</span>
                        <div className="capacity-config-controls">
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
                              setExpandedViewByUser((current) =>
                                areAllSelectedUsersExpanded
                                  ? new Map()
                                  : new Map(
                                      visibleSelectedRowSummaries.map(
                                        (entry) => [
                                          entry.row.user.id,
                                          current.get(entry.row.user.id) ??
                                            "weeks",
                                        ],
                                      ),
                                    ),
                              );
                            }}
                          >
                            {areAllSelectedUsersExpanded
                              ? "Alle Nutzer einklappen"
                              : "Alle Nutzer ausklappen"}
                          </button>
                        </div>
                      </div>
                      <div
                        className="capacity-config-divider"
                        aria-hidden="true"
                      />
                    </>
                  ) : null}
                  <div className="capacity-config-item">
                    <span className="capacity-config-label">Auslastung</span>
                    <div className="capacity-config-controls">
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
                  <div className="capacity-config-divider" aria-hidden="true" />
                  <div className="capacity-config-group">
                    <div className="capacity-config-item">
                      <label
                        className="capacity-config-label"
                        htmlFor="bulk-weekly-hours"
                      >
                        Wochenstunden
                      </label>
                      <input
                        id="bulk-weekly-hours"
                        type="text"
                        inputMode="decimal"
                        placeholder="—"
                        value={bulkWeeklyHoursInput}
                        aria-invalid={isInvalidNumberInput(bulkWeeklyHoursInput)}
                        className={
                          isInvalidNumberInput(bulkWeeklyHoursInput)
                            ? "capacity-config-input input-invalid"
                            : "capacity-config-input"
                        }
                        onChange={(event) =>
                          setBulkWeeklyHoursInput(event.target.value)
                        }
                      />
                    </div>
                    <div className="capacity-config-item">
                      <label
                        className="capacity-config-label"
                        htmlFor="bulk-customer-percent"
                      >
                        Kunden %
                      </label>
                      <input
                        id="bulk-customer-percent"
                        type="text"
                        inputMode="numeric"
                        placeholder="70"
                        value={bulkCustomerPercentInput}
                        aria-invalid={isInvalidNumberInput(
                          bulkCustomerPercentInput,
                        )}
                        className={
                          isInvalidNumberInput(bulkCustomerPercentInput)
                            ? "capacity-config-input input-invalid"
                            : "capacity-config-input"
                        }
                        onChange={(event) =>
                          setBulkCustomerPercentInput(event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div className="capacity-config-item">
                    <div className="capacity-config-controls">
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
                      <button
                        type="button"
                        className="ghost-button ghost-button-danger"
                        title={`Setzt die Wochenstunden aller Nutzer auf die Arbeitszeiten aus awork und Kunden % auf den Standard (${DEFAULT_CUSTOMER_PERCENT} %) zurück.`}
                        onClick={resetConfigurationToDefaults}
                      >
                        Zurücksetzen
                      </button>
                    </div>
                  </div>
                  </div>
                </section>
                {viewMode === "bar" ? (
                  <>
                    <div className="capacity-chart-legend" aria-label="Legende">
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
                    <div className="capacity-chart-toolbar">
                      <input
                        id="analysis-user-search"
                        className="analysis-user-search"
                        aria-label="Nutzer suchen"
                        type="search"
                        value={chartUserSearch}
                        placeholder="Nutzer filtern..."
                        onChange={(event) =>
                          setChartUserSearch(event.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="ghost-button capacity-export-all-button"
                        disabled={visibleSelectedRowSummaries.length === 0}
                        aria-label="Kapazität aller angezeigten Nutzer als CSV exportieren"
                        title="Kapazität aller angezeigten Nutzer als CSV exportieren"
                        onClick={() =>
                          exportCapacityCsv(
                            visibleSelectedRowSummaries,
                            "kapazitaet-alle-nutzer",
                          )
                        }
                      >
                        <CsvExportIcon />
                      </button>
                    </div>
                  </>
                ) : null}
              </section>

              <section
                className={`panel analysis-chart-panel analysis-content-panel${
                  viewMode === "bar" ? " analysis-content-panel--plain" : ""
                }`}
              >
                {viewMode === "bar" ? (
                  visibleSelectedRowSummaries.length > 0 ? (
                    <div className="capacity-chart">
                      {visibleSelectedRowSummaries.map((entry) => {
                        return (
                          <CapacityChartRow
                            key={entry.row.user.id}
                            row={entry.row}
                            weekRows={entry.weekRows}
                            expandMode={
                              expandedViewByUser.get(entry.row.user.id) ?? null
                            }
                            showCollapsedRangeBar={showCollapsedRangeBars}
                            userAbsences={
                              absencesByUser[entry.row.user.id] ?? []
                            }
                            unresolvedHintsByTaskId={
                              unresolvedProjectHintsByTaskId
                            }
                            onSetExpandMode={(mode) =>
                              toggleUserExpandMode(entry.row.user.id, mode)
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
                  )
                ) : viewMode === "table" ? (
                  <CapacityTableView
                    entries={visibleSelectedRowSummaries}
                    capacityWeeks={capacityWeeks}
                  />
                ) : visibleSelectedRowSummaries.length > 0 ? (
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
          title="Nutzer, deren geplante Auslastung das Kunden-Ziel übersteigt (z. B. 50 % geplant bei 40 % Ziel)."
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
  expandMode,
  showCollapsedRangeBar,
  userAbsences,
  unresolvedHintsByTaskId,
  onSetExpandMode,
  onInputChange,
}: {
  row: UserCapacityRow;
  weekRows: UserCapacityWeek[];
  expandMode: UserExpandMode | null;
  showCollapsedRangeBar: boolean;
  userAbsences: AworkAbsence[];
  unresolvedHintsByTaskId: Record<string, string>;
  onSetExpandMode: (mode: UserExpandMode) => void;
  onInputChange: (
    userId: string,
    field: keyof CapacityInputs,
    value: number,
  ) => void;
}) {
  const isExpanded = expandMode !== null;
  const totals = summarizeWeekRows(weekRows);
  const projectTotals = summarizeWeekProjectTotals(weekRows);
  const projectColorFor = useMemo(
    () => buildProjectColorResolver(projectTotals),
    [projectTotals],
  );
  const dayRowsByWeek = useMemo(
    () =>
      expandMode === "days"
        ? new Map(
            weekRows.map((weekRow) => [
              weekRow.week.key,
              buildUserCapacityDays(
                row,
                weekRow.week,
                userAbsences,
                unresolvedHintsByTaskId,
              ),
            ]),
          )
        : null,
    [expandMode, weekRows, row, userAbsences, unresolvedHintsByTaskId],
  );
  const workloadColor = getWorkloadColor(totals.customerTargetPercent, row.inputs.customerPercent);
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

  const workloadTooltip = `Auslastung\n${formatHours(totals.plannedHours)} geplant / ${formatHours(totals.effectiveCapacityHours)} verfügbar = ${formatDecimal(totals.customerTargetPercent)}%\nDas ist belegte Arbeitszeit, nicht die Erfüllung des Kunden-Ziels (${formatHours(totals.targetHours)}).`;

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
            className="capacity-user-workload"
            style={{ color: workloadColor }}
            aria-label={workloadTooltip}
            onMouseEnter={(event) => showProjectTooltip(workloadTooltip, event)}
            onMouseMove={(event) => showProjectTooltip(workloadTooltip, event)}
            onMouseLeave={() => setTooltip(undefined)}
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
        <div className="capacity-expand-actions">
          <button
            type="button"
            className="primary-button capacity-expand-button"
            aria-expanded={expandMode === "weeks"}
            aria-pressed={expandMode === "weeks"}
            onClick={() => onSetExpandMode("weeks")}
          >
            {expandMode === "weeks" ? "Wochen einklappen" : "Wochen einblenden"}
          </button>
          <button
            type="button"
            className="primary-button capacity-expand-button"
            aria-expanded={expandMode === "days"}
            aria-pressed={expandMode === "days"}
            onClick={() => onSetExpandMode("days")}
          >
            {expandMode === "days" ? "Tage einklappen" : "Tage einblenden"}
          </button>
        </div>
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
            className={`capacity-week-grid${expandMode === "days" ? " capacity-week-grid--days" : ""}`}
            aria-label={`Geplante Projektstunden von ${formatUserName(row.user)} pro Kalenderwoche`}
          >
            {weekRows.map((weekRow) => (
              <CapacityWeekBar
                key={weekRow.week.key}
                weekRow={weekRow}
                dayRows={dayRowsByWeek?.get(weekRow.week.key)}
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
  // When the marker sits near a track edge, a centred flag/marker overflows and
  // gets clipped by the track's overflow. Anchor them to the near edge instead.
  const markerAtLeft = customerMarkerPercent <= 15;
  const markerAtRight = customerMarkerPercent >= 85;
  const flagAlignClass = markerAtLeft
    ? " capacity-marker-flag--left"
    : markerAtRight
      ? " capacity-marker-flag--right"
      : "";
  const markerAlignClass = markerAtLeft
    ? " capacity-marker-target--edge-left"
    : markerAtRight
      ? " capacity-marker-target--edge-right"
      : "";
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
        className="capacity-range-track capacity-range-track--labeled-marker"
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
            className={`capacity-marker capacity-marker-target capacity-marker-target--labeled${markerAlignClass}`}
            style={{ left: `${customerMarkerPercent}%` }}
            aria-label={customerTargetTooltip}
            onMouseEnter={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseMove={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseLeave={onTooltipClear}
          >
            <span className={`capacity-marker-flag${flagAlignClass}`}>
              Kunden-Ziel · {formatHours(totals.targetHours)} /{" "}
              {formatDecimal(customerPercent)} %
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function CapacityWeekBar({
  weekRow,
  dayRows,
  projectColorFor,
  customerPercent,
  onTooltip,
  onTooltipClear,
}: {
  weekRow: UserCapacityWeek;
  dayRows?: UserCapacityDay[];
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
      {dayRows ? (
        <div
          className="capacity-day-list"
          aria-label={`${weekRow.week.label}: geplante Projektzeit pro Tag`}
        >
          {dayRows.map((day) => (
            <CapacityDayRow
              key={day.key}
              day={day}
              projectColorFor={projectColorFor}
              onTooltip={onTooltip}
              onTooltipClear={onTooltipClear}
            />
          ))}
        </div>
      ) : (
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
      )}
      <div className="capacity-week-stats">
        <span>
          {formatHours(weekRow.plannedMinutes / 60)}
          <span className="capacity-week-cap">
            {" "}
            / {formatHours(weekRow.effectiveCapacityHours)}
          </span>
        </span>
        <span
          style={{ color: getWorkloadColor(weekRow.customerTargetPercent, customerPercent) }}
        >
          {formatDecimal(weekRow.customerTargetPercent)}%
        </span>
      </div>
    </div>
  );
}

function CapacityDayRow({
  day,
  projectColorFor,
  onTooltip,
  onTooltipClear,
}: {
  day: UserCapacityDay;
  projectColorFor: ProjectColorResolver;
  onTooltip: (text: string, event: MouseEvent<HTMLElement>) => void;
  onTooltipClear: () => void;
}) {
  const displayPercent = Math.max(100, day.utilizationPercent);
  const pct = (h: number) =>
    day.dayCapacityHours > 0
      ? (h / day.dayCapacityHours) * (10000 / displayPercent)
      : 0;
  const availableZonePercent = pct(day.effectiveCapacityHours);
  const absentZonePercent = pct(Math.min(day.dayCapacityHours, day.absentHours));
  const stackWidthPercent =
    day.dayCapacityHours > 0
      ? pct(day.plannedMinutes / 60)
      : day.plannedMinutes > 0
        ? 100
        : 0;
  const hasAbsent = absentZonePercent > 0;
  const isMorningAbsent = hasAbsent && day.absentHalf === "morning";
  const absentLabel =
    day.absentFraction >= 1
      ? "Ganztägig abwesend"
      : day.absentHalf === "morning"
        ? "Vormittags abwesend"
        : day.absentHalf === "afternoon"
          ? "Nachmittags abwesend"
          : "½ Tag abwesend";
  const absentTooltip = `Abwesenheit\n${absentLabel} · ${formatHours(day.absentHours)} weniger Kap.`;

  return (
    <div
      className={`capacity-day-row${day.isWeekend ? " capacity-day-row--weekend" : ""}`}
    >
      <span className="capacity-day-label">{day.label}</span>
      <div
        className="capacity-day-track"
        aria-label={`${day.label}: ${formatHours(day.plannedMinutes / 60)} geplant von ${formatHours(day.effectiveCapacityHours)} verfügbarer Kap.`}
      >
        <div
          className="capacity-day-inner"
          style={{ width: `${displayPercent}%` }}
        >
          {!day.isWeekend && (
            <div
              className={`capacity-zone${hasAbsent ? " capacity-zone--partial" : ""}`}
              style={{
                width: `${availableZonePercent}%`,
                left: isMorningAbsent ? `${absentZonePercent}%` : undefined,
              }}
            />
          )}
          {hasAbsent && (
            <div
              className={`capacity-absent-zone${availableZonePercent <= 0 ? " capacity-absent-zone--isolated" : ""}${isMorningAbsent ? " capacity-absent-zone--leading" : ""}`}
              style={{
                left: isMorningAbsent ? 0 : `${availableZonePercent}%`,
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
            style={{
              width: `${stackWidthPercent}%`,
              marginLeft: isMorningAbsent ? `${absentZonePercent}%` : undefined,
            }}
          >
            {day.segments.length > 0 && day.plannedMinutes > 0 ? (
              day.segments.map((segment) => {
                const tooltipText = `${segment.projectName}${segment.taskName ? ` · ${segment.taskName}` : ""}\n${segment.startHHmm}–${segment.endHHmm} · ${formatHours(segment.minutes / 60)}${segment.unresolvedHint ? `\nHinweis: ${segment.unresolvedHint}` : ""}`;

                return (
                  <span
                    key={segment.scheduleId}
                    className="capacity-segment"
                    aria-label={tooltipText}
                    style={{
                      width: `${day.plannedMinutes > 0 ? (segment.minutes / day.plannedMinutes) * 100 : 0}%`,
                      background: projectColorFor(segment.projectKey),
                    }}
                    onMouseEnter={(event) => onTooltip(tooltipText, event)}
                    onMouseMove={(event) => onTooltip(tooltipText, event)}
                    onMouseLeave={onTooltipClear}
                  />
                );
              })
            ) : null}
          </div>
        </div>
      </div>
      <span className="capacity-day-stats">
        {formatHours(day.plannedMinutes / 60)}
        <span className="capacity-week-cap">
          {" "}
          / {formatHours(day.effectiveCapacityHours)}
        </span>
      </span>
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
            "Aufgaben-Details konnten nicht von awork geladen werden — " +
            "vermutlich eine private Aufgabe oder ein Projekt ohne Zugriff.";
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

    if (task.isPrivate) {
      unresolvedHintsByTaskId[schedule.taskId] =
        "Private Aufgabe — gehört keinem Projekt und ist nur für die Person selbst sichtbar.";
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
    const weekEndExclusive = addDays(startOfLocalDay(week.to), 1);
    let plannedMinutes = 0;

    row.schedules.forEach((schedule) => {
      // The backend returns schedules that merely overlap the range; count
      // only the minutes falling inside this week, so range-spanning and
      // multi-day schedules are neither dropped nor booked fully into their
      // start week.
      const duration = getScheduleOverlapMinutes(
        schedule,
        week.from,
        weekEndExclusive,
      );
      if (duration <= 0) {
        return;
      }
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

// Mirrors buildUserCapacityWeeks day by day: schedules are split into per-day
// segments with only the overlapping minutes, and the shared per-day absence
// fraction is used, so the day rows of a week always sum to that week's
// numbers.
function buildUserCapacityDays(
  row: UserCapacityRow,
  week: CapacityWeek,
  userAbsences: AworkAbsence[],
  unresolvedHintsByTaskId: Record<string, string>,
): UserCapacityDay[] {
  const segmentsByDay = new Map<string, DayScheduleDetail[]>();

  row.schedules.forEach((schedule) => {
    const scheduleStart = parseISO(schedule.start);
    const scheduleEnd = parseISO(schedule.end);
    const key = schedule.projectId ?? "unresolved-project";

    let day = startOfLocalDay(week.from);
    while (day <= week.to) {
      const dayEndExclusive = addDays(day, 1);
      const segmentStart = scheduleStart > day ? scheduleStart : day;
      const segmentEnd =
        scheduleEnd < dayEndExclusive ? scheduleEnd : dayEndExclusive;
      const minutes = Math.max(
        0,
        Math.round((segmentEnd.getTime() - segmentStart.getTime()) / 60000),
      );

      if (minutes > 0) {
        const segment: DayScheduleDetail = {
          scheduleId: schedule.id,
          projectKey: key,
          projectName: schedule.projectName ?? "Projekt nicht aufgelöst",
          taskName: schedule.taskName,
          startHHmm: format(segmentStart, "HH:mm"),
          endHHmm:
            segmentEnd.getTime() === dayEndExclusive.getTime()
              ? "24:00"
              : format(segmentEnd, "HH:mm"),
          minutes,
          unresolvedHint:
            key === "unresolved-project"
              ? unresolvedHintsByTaskId[schedule.taskId]
              : undefined,
        };
        const dayKey = format(day, "yyyy-MM-dd");
        const daySegments = segmentsByDay.get(dayKey) ?? [];
        daySegments.push(segment);
        segmentsByDay.set(dayKey, daySegments);
      }
      day = dayEndExclusive;
    }
  });

  const days: UserCapacityDay[] = [];
  let day = week.from;
  while (day <= week.to) {
    const dayKey = format(day, "yyyy-MM-dd");
    const segments = (segmentsByDay.get(dayKey) ?? []).sort((a, b) =>
      a.startHHmm.localeCompare(b.startHHmm),
    );
    const dow = getDay(day);
    const isWeekend = dow === 0 || dow === 6;
    const plannedMinutes = segments.reduce(
      (sum, segment) => sum + segment.minutes,
      0,
    );

    if (!isWeekend || plannedMinutes > 0) {
      const dayCapacityHours = isWeekend ? 0 : row.inputs.weeklyHours / 5;
      const absentFraction = calculateAbsentFractionForDay(
        userAbsences,
        row.user.id,
        day,
      );
      const absentHalf = getAbsentHalfForDay(userAbsences, row.user.id, day);
      const absentHours = Math.min(
        dayCapacityHours,
        absentFraction * (row.inputs.weeklyHours / 5),
      );
      const effectiveCapacityHours = Math.max(
        0,
        dayCapacityHours - absentHours,
      );
      const plannedHours = plannedMinutes / 60;
      const utilizationPercent =
        effectiveCapacityHours > 0
          ? (plannedHours / effectiveCapacityHours) * 100
          : plannedMinutes > 0
            ? 100
            : 0;

      days.push({
        key: dayKey,
        date: day,
        label: format(day, "EEEEEE dd.MM.", { locale: de }),
        isWeekend,
        dayCapacityHours,
        absentFraction,
        absentHalf,
        absentHours,
        effectiveCapacityHours,
        plannedMinutes,
        utilizationPercent,
        segments,
      });
    }
    day = addDays(day, 1);
  }

  return days;
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
    // Overloaded = the planned share of effective capacity exceeds the
    // Kunden-Ziel percentage (e.g. 50 % planned vs. 40 % goal). No
    // targetHours > 0 guard: a fully absent user with planned hours (or a
    // 0 %-goal user with any planning) is overloaded too.
    isOverloaded: plannedHours > targetHours,
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

// Minutes of a schedule that fall inside [intervalStart, intervalEndExclusive).
function getScheduleOverlapMinutes(
  schedule: AworkTaskSchedule,
  intervalStart: Date,
  intervalEndExclusive: Date,
): number {
  const start = parseISO(schedule.start);
  const end = parseISO(schedule.end);
  const overlapStart = start > intervalStart ? start : intervalStart;
  const overlapEnd = end < intervalEndExclusive ? end : intervalEndExclusive;
  return Math.max(
    0,
    Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60000),
  );
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
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
      label: `KW ${isoWeek}`,
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
    // Wochenstunden werden bewusst nicht gespeichert: Nach einem Reload
    // gelten wieder die Arbeitszeiten aus awork.
    const persistable = Object.fromEntries(
      Object.entries(inputs).map(([userId, value]) => [
        userId,
        { customerPercent: value.customerPercent },
      ]),
    );
    localStorage.setItem(CAPACITY_STORAGE_KEY, JSON.stringify(persistable));
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

function getWorkloadColor(
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
