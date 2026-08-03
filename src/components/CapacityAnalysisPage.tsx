import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  endOfWeek,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  startOfWeek,
} from "date-fns";
import {
  groupAbsencesByUserId,
  mapAbsencesResponse,
} from "../services/absenceMapper";
import { BackendClient } from "../services/backendClient";
import { fuzzyMatches } from "../services/fuzzySearch";
import {
  buildUnresolvedProjectsTooltip,
  exportCapacityCsv,
  formatDecimal,
  formatHours,
  formatUserName,
  shortUserName,
} from "../services/capacityFormat";
import {
  buildCapacityWeeks,
  buildUserCapacityWeeks,
  calculateWeekCount,
  collectUsersMatchingTeams,
  DEFAULT_CUSTOMER_PERCENT,
  DEFAULT_WEEKLY_HOURS,
  defaultInputs,
  getInputsForUser,
  getScheduleOverlapMinutes,
  getUserTeamNames,
  isInvalidNumberInput,
  loadCapacityInputs,
  loadSchedulesForUsers,
  mapCapacityDefaults,
  mapCapacityUsers,
  readPercentNumber,
  readPositiveNumber,
  saveCapacityInputs,
  summarizeWeekProjectTotals,
  summarizeWeekRows,
  computeDeadlineRisks,
  mapProjectMilestones,
  toTeamLabel,
  type CapacityInputs,
  type DeadlineRisk,
  type ProjectMilestone,
  type ProjectTotal,
  type SelectedRowSummary,
  type UserCapacityRow,
  type UserExpandMode,
} from "../services/capacityModel";
import {
  calculateDurationMinutes,
  shiftIsoByDays,
} from "../services/scheduleTimeCalculator";
import { buildUpdatePayload } from "../services/scheduleUpdater";
import { mapTimeEntriesResponse } from "../services/timeEntryMapper";
import type {
  AworkAbsence,
  AworkTaskSchedule,
  AworkUser,
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
import { WeekDetailPanel } from "./capacity/WeekDetailPanel";
import { DeadlineOverviewPanel } from "./capacity/DeadlineOverviewPanel";
import { useDetailModal } from "../context/DetailModalContext";
import { SummaryCards } from "./capacity/SummaryCards";
import { CapacityChartRow } from "./capacity/CapacityChartRow";
import { CsvExportIcon } from "./capacity/icons";

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

type WorkloadFilterMode = "all" | "gt" | "lt";

// ---------------------------------------------------------------------------
// View-state persistence: URL params (shareable) + localStorage (fallback).
// ---------------------------------------------------------------------------
const VIEW_STATE_STORAGE_KEY = "awork_capacity_view";

interface StoredViewState {
  viewMode?: "bar" | "table" | "overview";
  workloadFilterMode?: WorkloadFilterMode;
  workloadFilterValue?: number;
}

function loadStoredViewState(): StoredViewState {
  try {
    const raw = localStorage.getItem(VIEW_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredViewState;
    return {
      viewMode: readViewMode(parsed.viewMode ?? null) ?? undefined,
      workloadFilterMode:
        readWorkloadMode(parsed.workloadFilterMode ?? null) ?? undefined,
      workloadFilterValue:
        typeof parsed.workloadFilterValue === "number" &&
        Number.isFinite(parsed.workloadFilterValue)
          ? parsed.workloadFilterValue
          : undefined,
    };
  } catch {
    return {};
  }
}

function saveStoredViewState(state: StoredViewState): void {
  try {
    localStorage.setItem(VIEW_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode) — view state just isn't remembered.
  }
}

function readDateParam(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function readViewMode(
  value: string | null | undefined,
): "bar" | "table" | "overview" | undefined {
  return value === "bar" || value === "table" || value === "overview"
    ? value
    : undefined;
}

function readWorkloadMode(
  value: string | null | undefined,
): WorkloadFilterMode | undefined {
  return value === "all" || value === "gt" || value === "lt"
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

const workloadFilterOptions = [
  { value: "all" as const, label: "Alle" },
  { value: "gt" as const, label: "Über" },
  { value: "lt" as const, label: "Unter" },
];

const DEFAULT_TEAM_SELECTION = "sim";
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
  const { openProjectDetail, openTaskDetail } = useDetailModal();
  const hasInitializedDefaultSelectionRef = useRef(false);
  const appliedCapacityDefaultUserIdsRef = useRef<Set<string>>(new Set());
  // View state initialisation order: URL params win, then the last-used
  // localStorage snapshot, then defaults — so shared links restore exactly
  // what the sender saw.
  const [searchParams, setSearchParams] = useSearchParams();
  const storedView = useRef(loadStoredViewState()).current;
  const [from, setFrom] = useState(
    () =>
      readDateParam(searchParams.get("from")) ??
      format(new Date(), "yyyy-MM-dd"),
  );
  const [to, setTo] = useState(
    () =>
      readDateParam(searchParams.get("to")) ??
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
  const [chartUserSearch, setChartUserSearch] = useState(
    () => searchParams.get("q") ?? "",
  );
  const [expandedViewByUser, setExpandedViewByUser] = useState<
    Map<string, UserExpandMode>
  >(new Map());
  const [showCollapsedRangeBars, setShowCollapsedRangeBars] = useState(true);
  const [workloadFilterMode, setWorkloadFilterMode] =
    useState<WorkloadFilterMode>(
      () =>
        readWorkloadMode(searchParams.get("wf")) ??
        storedView.workloadFilterMode ??
        "all",
    );
  const [workloadFilterValue, setWorkloadFilterValue] = useState(() => {
    const fromUrl = Number(searchParams.get("wfv"));
    if (Number.isFinite(fromUrl) && fromUrl > 0) {
      return fromUrl;
    }
    return storedView.workloadFilterValue ?? 80;
  });
  const [showOnlyOverbooked, setShowOnlyOverbooked] = useState(
    () => searchParams.get("ob") === "1",
  );
  const [bulkWeeklyHoursInput, setBulkWeeklyHoursInput] = useState("");
  const [bulkCustomerPercentInput, setBulkCustomerPercentInput] = useState("");
  const [unresolvedProjectHintsByTaskId, setUnresolvedProjectHintsByTaskId] =
    useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<"bar" | "table" | "overview">(
    () =>
      readViewMode(searchParams.get("view")) ?? storedView.viewMode ?? "bar",
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

  // Persist the view state: URL params for shareable deep links (replace, so
  // filter tweaks don't spam the history) + localStorage as the fallback for
  // the next visit without params.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      if (viewMode !== "bar") params.set("view", viewMode);
      if (workloadFilterMode !== "all") {
        params.set("wf", workloadFilterMode);
        params.set("wfv", String(workloadFilterValue));
      }
      if (chartUserSearch) params.set("q", chartUserSearch);
      if (showOnlyOverbooked) params.set("ob", "1");
      setSearchParams(params, { replace: true });
      saveStoredViewState({
        viewMode,
        workloadFilterMode,
        workloadFilterValue,
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [
    from,
    to,
    viewMode,
    workloadFilterMode,
    workloadFilterValue,
    chartUserSearch,
    showOnlyOverbooked,
    setSearchParams,
  ]);

  // Auto-run: once users and the default selection are ready, start the
  // analysis without requiring the "Analyse starten" click. The button stays
  // as the manual re-run.
  const hasAutoRunRef = useRef(false);
  useEffect(() => {
    if (
      hasAutoRunRef.current ||
      hasLoaded ||
      isLoading ||
      isLoadingUsers ||
      !currentUser ||
      availableUsers.length === 0 ||
      selectedUserIds.size === 0
    ) {
      return;
    }
    hasAutoRunRef.current = true;
    void loadAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    availableUsers,
    selectedUserIds,
    hasLoaded,
    isLoading,
    isLoadingUsers,
    currentUser,
  ]);

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

        if (showOnlyOverbooked && !entry.totals.isOverbooked) {
          return false;
        }

        if (workloadFilterMode === "all") {
          return true;
        }

        if (workloadFilterMode === "gt") {
          return entry.totals.workloadPercent >= workloadFilterValue;
        }

        return entry.totals.workloadPercent <= workloadFilterValue;
      }),
    [
      chartUserSearch,
      selectedRowSummaries,
      showOnlyOverbooked,
      workloadFilterMode,
      workloadFilterValue,
    ],
  );

  const areAllSelectedUsersExpanded =
    visibleSelectedRowSummaries.length > 0 &&
    visibleSelectedRowSummaries.every((entry) =>
      expandedViewByUser.has(entry.row.user.id),
    );

  // Summary cards mirror the FILTERED view so the on-screen numbers always
  // agree with the visible rows; "(gefiltert)" flags a narrowed set.
  const isSummaryFiltered =
    visibleSelectedRowSummaries.length !== selectedRowSummaries.length;
  const summary = useMemo(() => {
    const entries = visibleSelectedRowSummaries;
    const totalPlannedHours = entries.reduce(
      (sum, entry) => sum + entry.totals.plannedHours,
      0,
    );
    const totalCapacityHours = entries.reduce(
      (sum, entry) => sum + entry.totals.effectiveCapacityHours,
      0,
    );
    const totalAbsentHours = entries.reduce(
      (sum, entry) => sum + entry.totals.absentHours,
      0,
    );
    const overloadedUsers = entries.filter(
      (entry) => entry.totals.isOverbooked,
    ).length;

    return {
      totalPlannedHours,
      totalCapacityHours,
      totalAbsentHours,
      overloadedUsers,
      averageWorkload:
        entries.length > 0 && totalCapacityHours > 0
          ? (totalPlannedHours / totalCapacityHours) * 100
          : 0,
    };
  }, [visibleSelectedRowSummaries]);

  // --- Deadline & milestone risk (Phase G). ---
  const [deadlineRisksByUser, setDeadlineRisksByUser] = useState<
    Record<string, DeadlineRisk[]>
  >({});
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);

  // Milestones of the projects present in the analysis (best-effort, capped).
  async function loadMilestones(
    schedulesForUsers: Record<string, AworkTaskSchedule[]>,
  ) {
    const projects = new Map<string, string | undefined>();
    for (const schedules of Object.values(schedulesForUsers)) {
      for (const schedule of schedules) {
        if (schedule.projectId && !projects.has(schedule.projectId)) {
          projects.set(schedule.projectId, schedule.projectName);
        }
      }
    }
    const projectEntries = Array.from(projects.entries()).slice(0, 15);
    const collected: ProjectMilestone[] = [];
    for (const [projectId, projectName] of projectEntries) {
      try {
        const raw = await backendClient.getProjectMilestones(projectId);
        collected.push(...mapProjectMilestones(raw, projectId, projectName));
      } catch {
        // Milestones are an overlay — missing access just leaves them out.
      }
    }
    setMilestones(
      collected
        .filter((milestone) => milestone.day >= from && milestone.day <= to)
        .sort((a, b) => a.day.localeCompare(b.day)),
    );
  }

  // --- Plan vs. Actual (Phase F): opt-in tracked-time overlay. ---
  const [showTracked, setShowTracked] = useState(false);
  const [isLoadingTracked, setIsLoadingTracked] = useState(false);
  const [trackedMinutesByUserWeek, setTrackedMinutesByUserWeek] = useState<
    Record<string, Record<string, number>>
  >({});

  async function toggleTrackedTimes() {
    if (showTracked) {
      setShowTracked(false);
      return;
    }
    setIsLoadingTracked(true);
    setError("");
    try {
      const fromDay = from;
      const toDay = to;
      const result: Record<string, Record<string, number>> = {};
      // Sequential per user keeps the awork rate limit comfortable; the
      // analyzed set is usually small.
      for (const user of users) {
        const raw = await backendClient.getTimeEntries(user.id);
        const entries = mapTimeEntriesResponse(raw).filter(
          (entry) =>
            entry.day !== undefined &&
            entry.day >= fromDay &&
            entry.day <= toDay,
        );
        const byWeek: Record<string, number> = {};
        for (const entry of entries) {
          const entryDate = new Date(`${entry.day}T12:00:00`);
          const week = capacityWeeks.find(
            (candidate) =>
              entryDate >= candidate.from && entryDate <= candidate.to,
          );
          if (!week) continue;
          byWeek[week.key] = (byWeek[week.key] ?? 0) + entry.seconds / 60;
        }
        result[user.id] = byWeek;
      }
      setTrackedMinutesByUserWeek(result);
      setShowTracked(true);
    } catch (trackedError) {
      setError(
        trackedError instanceof Error
          ? trackedError.message
          : "Erfasste Zeiten konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingTracked(false);
    }
  }

  // --- Week drill-down (Phase D): click a week → panel with that week's
  // blockers and remediation actions (shift/delete/jump to manage). ---
  const [weekDetail, setWeekDetail] = useState<{
    userId: string;
    weekKey: string;
  } | null>(null);
  const [deadlineDetailUserId, setDeadlineDetailUserId] = useState<
    string | null
  >(null);
  const [isWeekActionBusy, setIsWeekActionBusy] = useState(false);
  const [isDeadlineActionBusy, setIsDeadlineActionBusy] = useState(false);

  // Marks the selected deadline tasks as done in awork, then reloads the
  // user's data so the risks (and blockers of now-done tasks) update.
  async function markDeadlineTasksDone(
    tasks: Array<{ taskId: string; projectId?: string }>,
  ) {
    if (!deadlineDetailUserId || tasks.length === 0) return;
    setIsDeadlineActionBusy(true);
    setError("");
    try {
      const result = await backendClient.markTasksDone(tasks);
      if (result.failed.length > 0) {
        setError(
          `${result.failed.length} Aufgabe(n) konnten nicht auf erledigt gesetzt werden: ${result.failed[0]?.error ?? ""}`,
        );
      }
      if (result.succeeded.length > 0) {
        await refreshUserSchedules(deadlineDetailUserId);
      }
    } catch (markError) {
      setError(
        markError instanceof Error
          ? markError.message
          : "Aufgaben konnten nicht auf erledigt gesetzt werden.",
      );
    } finally {
      setIsDeadlineActionBusy(false);
    }
  }

  const weekDetailData = useMemo(() => {
    if (!weekDetail) return null;
    const entry = selectedRowSummaries.find(
      (candidate) => candidate.row.user.id === weekDetail.userId,
    );
    const weekRow = entry?.weekRows.find(
      (candidate) => candidate.week.key === weekDetail.weekKey,
    );
    if (!entry || !weekRow) return null;
    const weekSchedules = entry.row.schedules.filter(
      (schedule) =>
        getScheduleOverlapMinutes(schedule, weekRow.week.from, weekRow.week.to) >
        0,
    );
    return { entry, weekRow, weekSchedules };
  }, [weekDetail, selectedRowSummaries]);

  const deadlineDetailData = useMemo(() => {
    if (!deadlineDetailUserId) return null;
    const entry = selectedRowSummaries.find(
      (candidate) => candidate.row.user.id === deadlineDetailUserId,
    );
    if (!entry) return null;
    return {
      entry,
      deadlines: deadlineRisksByUser[deadlineDetailUserId] ?? [],
    };
  }, [deadlineDetailUserId, deadlineRisksByUser, selectedRowSummaries]);

  function openDeadlineWeek(userId: string, deadline: DeadlineRisk) {
    const entry = selectedRowSummaries.find(
      (candidate) => candidate.row.user.id === userId,
    );
    const dueDay = deadline.dueOn.slice(0, 10);
    const weekRow = entry?.weekRows.find(
      (candidate) =>
        dueDay >= format(candidate.week.from, "yyyy-MM-dd") &&
        dueDay <= format(candidate.week.to, "yyyy-MM-dd"),
    );
    if (!weekRow) {
      // Überfällige Termine can lie before the analyzed range — there is no
      // KW to open then, so show the task itself instead of doing nothing.
      setDeadlineDetailUserId(null);
      openTaskDetail(deadline.taskId);
      return;
    }

    setExpandedViewByUser((current) => {
      const next = new Map(current);
      next.set(userId, "weeks");
      return next;
    });
    setDeadlineDetailUserId(null);
    setWeekDetail({ userId, weekKey: weekRow.week.key });
  }

  async function refreshUserSchedules(userId: string) {
    const user = availableUsers.find((candidate) => candidate.id === userId);
    if (!user) return;
    const result = await loadSchedulesForUsers(
      backendClient,
      [user],
      currentUser,
      from,
      to,
    );
    setSchedulesByUser((current) => ({
      ...current,
      ...result.schedulesByUser,
    }));
    setUnresolvedProjectHintsByTaskId((current) => ({
      ...current,
      ...result.unresolvedHintsByTaskId,
    }));
    setDeadlineRisksByUser((current) => ({
      ...current,
      [userId]: computeDeadlineRisks(
        result.assignedTasksByUser[userId] ?? [],
        result.schedulesByUser[userId] ?? [],
        from,
        to,
      ),
    }));
  }

  async function deleteWeekSchedules(scheduleIds: string[]): Promise<boolean> {
    if (!weekDetail || scheduleIds.length === 0) return false;
    setIsWeekActionBusy(true);
    setError("");
    try {
      const response = await backendClient.batchTaskSchedules({
        userId: weekDetail.userId,
        delete: scheduleIds,
      });
      if (response.failed.length > 0) {
        setError(
          `${response.failed.length} Blocker konnten nicht gelöscht werden: ${response.failed[0]?.error ?? ""}`,
        );
      }
      await refreshUserSchedules(weekDetail.userId);
      return response.failed.length === 0;
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Blocker konnten nicht gelöscht werden.",
      );
      return false;
    } finally {
      setIsWeekActionBusy(false);
    }
  }

  async function shiftWeekSchedules(
    scheduleIds: string[],
    dayOffset: number,
  ): Promise<boolean> {
    if (!weekDetail || !weekDetailData || scheduleIds.length === 0) return false;
    setIsWeekActionBusy(true);
    setError("");
    try {
      const byId = new Map(
        weekDetailData.weekSchedules.map((schedule) => [schedule.id, schedule]),
      );
      const updates = scheduleIds
        .map((scheduleId) => byId.get(scheduleId))
        .filter((schedule): schedule is AworkTaskSchedule => Boolean(schedule))
        .map((schedule) => ({
          ...asRecord(
            buildUpdatePayload({
              schedule,
              newStartIso: shiftIsoByDays(schedule.start, dayOffset),
              newEndIso: shiftIsoByDays(schedule.end, dayOffset),
            }),
          ),
          id: schedule.id,
        }));
      const response = await backendClient.batchTaskSchedules({
        userId: weekDetail.userId,
        update: updates,
      });
      if (response.failed.length > 0) {
        setError(
          `${response.failed.length} Blocker konnten nicht verschoben werden: ${response.failed[0]?.error ?? ""}`,
        );
      }
      await refreshUserSchedules(weekDetail.userId);
      return response.failed.length === 0;
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Blocker konnten nicht verschoben werden.",
      );
      return false;
    } finally {
      setIsWeekActionBusy(false);
    }
  }

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

      // Workspace absences (public holidays, offsites) apply to every user.
      // Best-effort: the endpoint needs elevated awork rights and may 403 —
      // capacity then simply lacks the holiday correction.
      try {
        const workspaceRaw = await backendClient.getWorkspaceAbsences();
        const workspaceAbsences = mapAbsencesResponse(workspaceRaw);
        if (workspaceAbsences.length > 0) {
          for (const user of usersToAnalyze) {
            newAbsencesByUser[user.id] = [
              ...(newAbsencesByUser[user.id] ?? []),
              ...workspaceAbsences.map((absence) => ({
                ...absence,
                userId: user.id,
              })),
            ];
          }
        }
      } catch {
        // No workspace-absence access — skip holiday correction silently.
      }

      setUsers(usersToAnalyze);
      setSchedulesByUser(schedulesResult.schedulesByUser);
      setUnresolvedProjectHintsByTaskId(
        schedulesResult.unresolvedHintsByTaskId,
      );
      setAbsencesByUser(newAbsencesByUser);
      setAbsenceLoadFailed(!absenceLoadSucceeded);

      // Termin-Erinnerung: all incomplete tasks due this or next calendar week.
      const risks: Record<string, DeadlineRisk[]> = {};
      for (const user of usersToAnalyze) {
        risks[user.id] = computeDeadlineRisks(
          schedulesResult.assignedTasksByUser[user.id] ?? [],
          schedulesResult.schedulesByUser[user.id] ?? [],
          from,
          to,
        );
      }
      setDeadlineRisksByUser(risks);
      void loadMilestones(schedulesResult.schedulesByUser);

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
                isFiltered={isSummaryFiltered}
                overbookedFilterActive={showOnlyOverbooked}
                onToggleOverbookedFilter={() =>
                  setShowOnlyOverbooked((value) => !value)
                }
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
                            disabled={isLoadingTracked}
                            title="Erfasste Zeiten (awork Zeiterfassung) neben den geplanten anzeigen"
                            onClick={() => void toggleTrackedTimes()}
                          >
                            {isLoadingTracked
                              ? "Erfasste Zeiten laden..."
                              : showTracked
                                ? "Erfasste Zeiten ausblenden"
                                : "Erfasste Zeiten anzeigen"}
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
                      {milestones.length > 0 && (
                        <div
                          className="milestone-strip"
                          aria-label="Meilensteine im Zeitraum"
                        >
                          <span className="milestone-strip-label">
                            Meilensteine:
                          </span>
                          {milestones.map((milestone) => (
                            <button
                              key={milestone.id}
                              type="button"
                              className="milestone-chip"
                              title={`${milestone.name} · ${milestone.projectName ?? "Projekt"} · ${milestone.day.split("-").reverse().join(".")} — Projektdetails anzeigen`}
                              onClick={() =>
                                openProjectDetail(milestone.projectId)
                              }
                            >
                              <span aria-hidden="true">◆</span>{" "}
                              {milestone.day.slice(8, 10)}.
                              {milestone.day.slice(5, 7)}. {milestone.name}
                            </button>
                          ))}
                        </div>
                      )}
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
                            onWeekDetail={(weekKey) =>
                              {
                                setDeadlineDetailUserId(null);
                                setWeekDetail({
                                  userId: entry.row.user.id,
                                  weekKey,
                                });
                              }
                            }
                            onDeadlineDetail={() => {
                              setWeekDetail(null);
                              setDeadlineDetailUserId(entry.row.user.id);
                            }}
                            trackedMinutesByWeek={
                              showTracked
                                ? trackedMinutesByUserWeek[entry.row.user.id]
                                : undefined
                            }
                            deadlineRisks={
                              deadlineRisksByUser[entry.row.user.id] ?? []
                            }
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
                    onWeekDetail={(userId, weekKey) =>
                      {
                        setDeadlineDetailUserId(null);
                        setWeekDetail({ userId, weekKey });
                      }
                    }
                    trackedMinutesByUserWeek={
                      showTracked ? trackedMinutesByUserWeek : undefined
                    }
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
                                  {formatDecimal(totals.workloadPercent)}%
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
      {weekDetailData ? (
        <WeekDetailPanel
          user={weekDetailData.entry.row.user}
          weekRow={weekDetailData.weekRow}
          schedules={weekDetailData.weekSchedules}
          risks={(deadlineRisksByUser[weekDetailData.entry.row.user.id] ?? []).filter(
            (risk) => {
              const day = risk.dueOn.slice(0, 10);
              const weekFrom = weekDetailData.weekRow.week.from
                .toISOString()
                .slice(0, 10);
              const weekTo = weekDetailData.weekRow.week.to
                .toISOString()
                .slice(0, 10);
              return day >= weekFrom && day <= weekTo;
            },
          )}
          isBusy={isWeekActionBusy}
          onClose={() => setWeekDetail(null)}
          onDelete={deleteWeekSchedules}
          onShift={shiftWeekSchedules}
        />
      ) : null}
      {deadlineDetailData ? (
        <DeadlineOverviewPanel
          user={deadlineDetailData.entry.row.user}
          deadlines={deadlineDetailData.deadlines}
          rangeFrom={from}
          isBusy={isDeadlineActionBusy}
          onSelect={(deadline) =>
            openDeadlineWeek(deadlineDetailData.entry.row.user.id, deadline)
          }
          onMarkDone={markDeadlineTasksDone}
          onClose={() => setDeadlineDetailUserId(null)}
        />
      ) : null}
    </main>
  );
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
