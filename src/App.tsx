import { useEffect, useMemo, useRef, useState } from "react";
import {
  endOfDay,
  endOfYear,
  format,
  isBefore,
  parseISO,
  startOfToday,
} from "date-fns";
import { BackendClient } from "./services/backendClient";
import {
  getStoredSessionId,
  clearStoredSessionId,
} from "./services/backendClient";
import { groupSchedules } from "./services/scheduleGrouping";
import { deleteScheduleGroup } from "./services/scheduleDeleter";
import {
  isOwnSchedule,
  mapTaskSchedulesResponse,
} from "./services/scheduleMapper";
import { enrichSchedulesWithProjectTasks } from "./services/scheduleEnrichment";
import {
  mapProjectTaskResponse,
  mapProjectTasksResponse,
} from "./services/projectTaskMapper";
import { mapProjectsResponse } from "./services/projectMapper";
import { updateScheduleChanges } from "./services/scheduleUpdater";
import { applyBlockerOperations } from "./services/scheduleOperations";
import { mapAbsencesResponse } from "./services/absenceMapper";
import type {
  AworkAbsence,
  AworkProject,
  AworkProjectTask,
  AworkTaskSchedule,
  AworkUserCapacity,
  AworkUser,
  CreateTaskSchedulePayload,
} from "./types/awork";
import type {
  BlockerOperation,
  BlockerOperationResult,
  DeleteResult,
  PlannerFilters,
  PreviewChange,
  ScheduleGroup,
  UpdateResult,
} from "./types/planner";
import { BulkEditModal } from "./components/BulkEditModal";
import { ConnectionPanel } from "./components/ConnectionPanel";
import {
  CreateScheduleGroupPanel,
  type CreateGroupOptions,
} from "./components/CreateScheduleGroupPanel";
import { ProjectPlanPanel } from "./components/ProjectPlanPanel";
import { DeleteGroupModal } from "./components/DeleteGroupModal";
import { StatusToast } from "./components/StatusToast";
import { FilterPanel } from "./components/FilterPanel";
import { LoadingState } from "./components/LoadingState";
import { ManualBlockerEditModal } from "./components/ManualBlockerEditModal";
import { MultiGroupDurationEditModal } from "./components/MultiGroupDurationEditModal";
import { PlannerUserSelector } from "./components/PlannerUserSelector";
import { PreviewChangesModal } from "./components/PreviewChangesModal";
import { BlockerOperationsPreviewModal } from "./components/BlockerOperationsPreviewModal";
import { ScheduleGroupsList } from "./components/ScheduleGroupsList";
import { SuccessPopup } from "./components/SuccessPopup";
import {
  WorkflowChooser,
  type PlannerWorkflow,
} from "./components/WorkflowChooser";
import { BackendStatusIndicator } from "./components/BackendStatusIndicator";
import { CapacityAnalysisPage } from "./components/CapacityAnalysisPage";
import { MonitoringModal } from "./components/MonitoringModal";
import { ModalShell } from "./components/ModalShell";
import { useConfetti } from "./components/Confetti";
import { clearFeatureAccessCache } from "./config/featureAccess";
import { AnimatePresence } from "motion/react";

const backendClient = new BackendClient();
const FEATURE_SEEN_STORAGE_PREFIX = "awork_feature_seen_";
const APP_ANNOUNCEMENT_VERSION = "2026.06";
const FEATURE_KEYS = {
  whatsNew: "whats-new-2026-06",
  projectPlanIntro: "feature-project-einplanen-v1",
  autoPlanIntro: "feature-auto-plan-v1",
} as const;

type FeatureModalType = "whats-new" | "project-plan" | "auto-plan";

function readLocalFeatureSeen(userId: string): string[] {
  try {
    const raw = localStorage.getItem(`${FEATURE_SEEN_STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function writeLocalFeatureSeen(userId: string, keys: Set<string>): void {
  localStorage.setItem(
    `${FEATURE_SEEN_STORAGE_PREFIX}${userId}`,
    JSON.stringify(Array.from(keys)),
  );
}

interface LoadSchedulesOptions {
  refreshNotice?: string;
}

function App() {
  const lastSessionCheckRef = useRef(0);
  const sessionRestoredRef = useRef(false);
  const sessionActivityTrackedRef = useRef(false);
  const [currentUser, setCurrentUser] = useState<AworkUser>();
  const [selectedPlannerUserId, setSelectedPlannerUserId] = useState("");
  const [workflow, setWorkflow] = useState<PlannerWorkflow>("manage");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [scheduleRefreshNotice, setScheduleRefreshNotice] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isApplyingBlockerOperations, setIsApplyingBlockerOperations] =
    useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingProjectTasks, setIsLoadingProjectTasks] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isCreatingSchedules, setIsCreatingSchedules] = useState(false);
  const [error, setError] = useState("");
  const [hasMonitoringAccess, setHasMonitoringAccess] = useState(false);
  const [showMonitoringModal, setShowMonitoringModal] = useState(false);
  const [activeFeatureModal, setActiveFeatureModal] =
    useState<FeatureModalType | null>(null);
  const [seenFeatureKeys, setSeenFeatureKeys] = useState<Set<string>>(
    new Set(),
  );
  const [showConfetti, setShowConfetti] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [createSuccess, setCreateSuccess] = useState<{
    count: number;
    failed: number;
    taskCreated?: string;
  }>();
  const [updateSuccess, setUpdateSuccess] = useState<{
    count: number;
    failed: number;
    title?: string;
    detail?: string;
  }>();
  const [deleteSuccess, setDeleteSuccess] = useState<{
    count: number;
    failed: number;
  }>();
  const [allSchedules, setAllSchedules] = useState<AworkTaskSchedule[]>([]);
  const [plannerAbsences, setPlannerAbsences] = useState<AworkAbsence[]>([]);
  const [availableProjects, setAvailableProjects] = useState<AworkProject[]>(
    [],
  );
  const [availableUsers, setAvailableUsers] = useState<AworkUser[]>([]);
  const [projectTasksForCreate, setProjectTasksForCreate] = useState<
    AworkProjectTask[]
  >([]);
  const [hasLoadedSchedules, setHasLoadedSchedules] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ScheduleGroup>();
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [multiEditGroups, setMultiEditGroups] = useState<ScheduleGroup[]>();
  const [manualEditGroup, setManualEditGroup] = useState<ScheduleGroup>();
  const [deleteGroup, setDeleteGroup] = useState<ScheduleGroup>();
  const [previewChanges, setPreviewChanges] = useState<PreviewChange[]>();
  const [blockerOperations, setBlockerOperations] =
    useState<BlockerOperation[]>();
  const [blockerOperationResults, setBlockerOperationResults] =
    useState<BlockerOperationResult[]>();
  const [updateResults, setUpdateResults] = useState<UpdateResult[]>();
  const [deleteResults, setDeleteResults] = useState<DeleteResult[]>();
  const [filters, setFilters] = useState<PlannerFilters>(() => ({
    from: format(new Date(), "yyyy-MM-dd"),
    to: format(endOfYear(new Date()), "yyyy-MM-dd"),
    hidePast: true,
    projectId: "",
    onlyAssigned: false,
  }));
  const [myAssignedTaskIds, setMyAssignedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [myAssignedProjectIds, setMyAssignedProjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [isMultiEditAvailable] = useState(true);
  const isAnalysisRoute = isCapacityAnalysisRoute();

  function consumeLoginRedirectFlag(): boolean {
    const wasRedirect =
      sessionStorage.getItem("awork_planner_login_redirect") === "1";
    if (wasRedirect) {
      sessionStorage.removeItem("awork_planner_login_redirect");
    }
    return wasRedirect;
  }

  useEffect(() => {
    // Session ID is captured from URL by inline script in index.html (before React loads).
    // Here we just check if we have a stored session and restore it.
    if (getStoredSessionId()) {
      void restoreBackendSession(consumeLoginRedirectFlag());
    }
  }, []);

  useEffect(() => {
    function shouldCheckSession() {
      return Boolean(currentUser || getStoredSessionId());
    }

    function maybeRestoreSession() {
      if (!shouldCheckSession() || isConnecting) {
        return;
      }

      const now = Date.now();
      if (now - lastSessionCheckRef.current < 5000) {
        return;
      }

      lastSessionCheckRef.current = now;
      void restoreBackendSession();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        maybeRestoreSession();
      }
    }

    window.addEventListener("focus", maybeRestoreSession);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", maybeRestoreSession);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentUser, isConnecting]);

  useEffect(() => {
    if (!currentUser) {
      setSeenFeatureKeys(new Set());
      return;
    }

    const localKeys = new Set(readLocalFeatureSeen(currentUser.id));
    setSeenFeatureKeys(localKeys);

    void backendClient
      .getSeenFeatureKeys()
      .then(async (remoteKeys) => {
        const merged = new Set([...localKeys, ...remoteKeys]);
        setSeenFeatureKeys(merged);
        writeLocalFeatureSeen(currentUser.id, merged);

        const missingRemoteKeys = Array.from(localKeys).filter(
          (key) => !remoteKeys.includes(key),
        );

        if (missingRemoteKeys.length === 0) {
          return;
        }

        const syncResults = await Promise.allSettled(
          missingRemoteKeys.map((key) =>
            backendClient.markFeatureSeen(key, APP_ANNOUNCEMENT_VERSION),
          ),
        );

        if (syncResults.some((result) => result.status === "rejected")) {
          setStatusMessage(
            "Feature-Hinweise wurden nur lokal gespeichert und konnten noch nicht mit dem Server synchronisiert werden.",
          );
          return;
        }
      })
      .catch(() => {
        // Fallback to local cache if backend/supabase is temporarily unavailable.
        setStatusMessage(
          "Feature-Hinweise werden aktuell nur lokal gespeichert. Sobald das Backend wieder erreichbar ist, werden sie synchronisiert.",
        );
      });
  }, [currentUser]);

  async function acknowledgeFeature(featureKey: string) {
    if (!currentUser) return;
    setSeenFeatureKeys((current) => {
      const next = new Set(current);
      next.add(featureKey);
      writeLocalFeatureSeen(currentUser.id, next);
      return next;
    });

    try {
      console.log(
        `[feature-announcement] Saving feature ${featureKey} to backend...`,
      );
      await backendClient.markFeatureSeen(featureKey, APP_ANNOUNCEMENT_VERSION);
      console.log(
        `[feature-announcement] Successfully saved feature ${featureKey}`,
      );
    } catch (err) {
      console.error(
        `[feature-announcement] Failed to save feature ${featureKey}:`,
        err,
      );
      setStatusMessage(
        "Feature-Hinweis lokal gespeichert. Die Server-Synchronisierung wird automatisch nachgeholt.",
      );
    }
  }

  function openWhatsNew() {
    setActiveFeatureModal("whats-new");
    setShowConfetti(true);
    if (!seenFeatureKeys.has(FEATURE_KEYS.whatsNew)) {
      void acknowledgeFeature(FEATURE_KEYS.whatsNew);
    }
  }

  function handleWorkflowChange(nextWorkflow: PlannerWorkflow) {
    setWorkflow(nextWorkflow);
    if (
      nextWorkflow === "project" &&
      !seenFeatureKeys.has(FEATURE_KEYS.projectPlanIntro)
    ) {
      setShowConfetti(true);
      setActiveFeatureModal("project-plan");
    }
  }

  function handleAutoPlanOpen() {
    if (!seenFeatureKeys.has(FEATURE_KEYS.autoPlanIntro)) {
      setShowConfetti(true);
      setActiveFeatureModal("auto-plan");
    }
  }

  async function confirmFeatureModal(featureKey: string) {
    await acknowledgeFeature(featureKey);
    setActiveFeatureModal(null);
  }

  const pulseProjectWorkflow = !seenFeatureKeys.has(FEATURE_KEYS.projectPlanIntro);
  const pulseAutoPlanMode = !seenFeatureKeys.has(FEATURE_KEYS.autoPlanIntro);
  const showWhatsNewDot = !seenFeatureKeys.has(FEATURE_KEYS.whatsNew);

  useConfetti(showConfetti, {
    particleCount: 100,
    startVelocity: 28,
    spread: 70,
  });

  const plannerUser = useMemo(() => {
    if (!currentUser) return undefined;
    if (!selectedPlannerUserId) return currentUser;
    return (
      availableUsers.find((user) => user.id === selectedPlannerUserId) ?? {
        id: selectedPlannerUserId,
      }
    );
  }, [availableUsers, currentUser, selectedPlannerUserId]);

  const plannerAbsenceRanges = useMemo(() => {
    if (!plannerUser) return [];
    return plannerAbsences
      .filter((a) => a.userId === plannerUser.id)
      .map((a) => ({ startOn: a.startOn, endOn: a.endOn }));
  }, [plannerAbsences, plannerUser]);

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    const candidateSchedules = plannerUser
      ? getPlannerSchedules(allSchedules, plannerUser)
      : [];

    candidateSchedules.forEach((schedule) => {
      if (schedule.projectId && schedule.projectName) {
        projects.set(schedule.projectId, schedule.projectName);
      }
    });

    return Array.from(projects.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allSchedules, plannerUser]);

  const filteredSchedules = useMemo(() => {
    if (!plannerUser) return [];

    const today = startOfToday();
    const fromDate = parseISO(filters.from);
    const toDate = endOfDay(parseISO(filters.to));

    return getPlannerSchedules(allSchedules, plannerUser).filter((schedule) => {
      const scheduleStart = parseISO(schedule.start);
      const scheduleEnd = parseISO(schedule.end);

      if (scheduleStart > toDate || scheduleEnd < fromDate) {
        return false;
      }
      if (filters.hidePast && isBefore(scheduleEnd, today)) return false;
      if (filters.projectId && schedule.projectId !== filters.projectId)
        return false;
      if (
        filters.onlyAssigned &&
        myAssignedTaskIds.size > 0 &&
        !myAssignedTaskIds.has(schedule.taskId)
      )
        return false;
      return true;
    });
  }, [
    allSchedules,
    plannerUser,
    filters.from,
    filters.to,
    filters.hidePast,
    filters.projectId,
    filters.onlyAssigned,
    myAssignedTaskIds,
  ]);

  const groups = useMemo(
    () => groupSchedules(filteredSchedules),
    [filteredSchedules],
  );
  const selectedGroups = useMemo(
    () => groups.filter((group) => selectedGroupIds.has(group.groupId)),
    [groups, selectedGroupIds],
  );

  async function restoreBackendSession(returnedFromLogin = false) {
    setIsConnecting(true);
    setError("");
    if (returnedFromLogin) {
      setStatusMessage("awork Login abgeschlossen. Session wird geprüft...");
    }

    // Retry up to 3 times to handle Render cold starts
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const status = await backendClient.getAuthStatus();
        if (status.authenticated && status.user) {
          setCurrentUser(status.user);
          setSelectedPlannerUserId("");
          backendClient
            .getMonitoringAccess()
            .then((r) => setHasMonitoringAccess(r.hasAccess))
            .catch(() => setHasMonitoringAccess(false));
          if (!sessionActivityTrackedRef.current) {
            sessionActivityTrackedRef.current = true;
            backendClient.trackActivity("session_start").catch(() => {});
          }
          if (returnedFromLogin) {
            setStatusMessage("awork Login erfolgreich. Workflow wählen.");
            sessionRestoredRef.current = true;
            sessionStorage.setItem("awork_planner_session_restored", "1");
          } else if (
            !sessionRestoredRef.current &&
            !sessionStorage.getItem("awork_planner_session_restored")
          ) {
            setStatusMessage("awork-Session wiederhergestellt.");
            sessionRestoredRef.current = true;
            sessionStorage.setItem("awork_planner_session_restored", "1");
          }
          setIsConnecting(false);
          return;
        } else if (returnedFromLogin) {
          // Session not found in backend — might be Render cold start, DB not yet loaded
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          clearStoredSessionId();
          setError(
            "awork Login erfolgreich, aber keine Backend-Session gefunden. Bitte erneut anmelden.",
          );
        } else {
          // Stored session is stale
          clearStoredSessionId();
        }
        break;
      } catch (sessionError) {
        lastError = sessionError;
        if (attempt < 2) {
          setStatusMessage("Backend startet... bitte warten.");
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
      }
    }

    setCurrentUser(undefined);
    if (lastError && !error) {
      setError(
        lastError instanceof Error
          ? lastError.message
          : "Backend-Session konnte nicht geprüft werden.",
      );
    }
    setIsConnecting(false);
  }

  function handleLogin() {
    window.location.href = backendClient.getLoginUrl();
  }

  function handlePlannerUserChange(userId: string) {
    setSelectedPlannerUserId(userId);
    setAllSchedules([]);
    setPlannerAbsences([]);
    setProjectTasksForCreate([]);
    setHasLoadedSchedules(false);
    setFilters((currentFilters) => ({ ...currentFilters, projectId: "" }));
    setMyAssignedTaskIds(new Set());
    setMyAssignedProjectIds(new Set());
    setSelectedGroup(undefined);
    setSelectedGroupIds(new Set());
    setMultiEditGroups(undefined);
    setManualEditGroup(undefined);
    setDeleteGroup(undefined);
    setPreviewChanges(undefined);
    setBlockerOperations(undefined);
    setBlockerOperationResults(undefined);
    setUpdateResults(undefined);
    setDeleteResults(undefined);
    setCreateSuccess(undefined);
    setUpdateSuccess(undefined);
    setDeleteSuccess(undefined);
    setStatusMessage("");
    setError("");
  }

  async function handleDisconnect() {
    await backendClient.logout();
    clearFeatureAccessCache();
    sessionRestoredRef.current = false;
    setCurrentUser(undefined);
    setHasMonitoringAccess(false);
    setShowMonitoringModal(false);
    setSelectedPlannerUserId("");
    setAllSchedules([]);
    setPlannerAbsences([]);
    setAvailableProjects([]);
    setAvailableUsers([]);
    setProjectTasksForCreate([]);
    setHasLoadedSchedules(false);
    setSelectedGroup(undefined);
    setSelectedGroupIds(new Set());
    setMultiEditGroups(undefined);
    setManualEditGroup(undefined);
    setDeleteGroup(undefined);
    setPreviewChanges(undefined);
    setBlockerOperations(undefined);
    setBlockerOperationResults(undefined);
    setUpdateResults(undefined);
    setDeleteResults(undefined);
    setCreateSuccess(undefined);
    setUpdateSuccess(undefined);
    setDeleteSuccess(undefined);
    setStatusMessage("Getrennt.");
    setError("");
    setMyAssignedTaskIds(new Set());
    setMyAssignedProjectIds(new Set());
  }

  async function loadSchedules(options: LoadSchedulesOptions = {}) {
    if (!plannerUser) {
      setError("Bitte zuerst mit awork verbinden.");
      return;
    }

    setIsLoadingSchedules(true);
    setScheduleRefreshNotice(options.refreshNotice ?? "");
    setError("");
    setStatusMessage("");

    try {
      const [
        scheduleResponse,
        plannerUserTaskResponse,
        myAssignedTasksResponse,
      ] = await Promise.all([
        backendClient.getTaskSchedules({
          from: filters.from,
          to: filters.to,
          userId: selectedPlannerUserId || undefined,
        }),
        !selectedPlannerUserId
          ? backendClient.getMyProjectTasks()
          : backendClient.getUserAssignedTasks(plannerUser.id),
        currentUser
          ? backendClient.getUserAssignedTasks(currentUser.id)
          : Promise.resolve<unknown>(null),
      ]);
      const mapped = mapTaskSchedulesResponse(scheduleResponse);
      const projectTasks = await loadMissingProjectTasks(
        mapProjectTasksResponse(plannerUserTaskResponse),
        mapped.schedules,
      );
      const myTasksArray = mapProjectTasksResponse(myAssignedTasksResponse);
      const myTaskIds = new Set(myTasksArray.map((t) => t.id));
      const myProjectIds = new Set(
        myTasksArray.map((t) => t.projectId).filter(Boolean),
      );
      setMyAssignedTaskIds(myTaskIds);
      setMyAssignedProjectIds(myProjectIds);
      const scheduledTaskIds = new Set(
        mapped.schedules.map((schedule) => schedule.taskId),
      );
      const unscheduledAssignedTasks = projectTasks
        .filter((task) => !scheduledTaskIds.has(task.id))
        .filter((task) => isTaskActive(task))
        .sort((a, b) => {
          const projectOrder = (a.projectName ?? "").localeCompare(
            b.projectName ?? "",
          );
          if (projectOrder !== 0) {
            return projectOrder;
          }

          return (a.name ?? "").localeCompare(b.name ?? "");
        });
      const enrichedSchedules = enrichSchedulesWithProjectTasks(
        mapped.schedules.map((schedule) => ({
          ...schedule,
          userId: selectedPlannerUserId ? plannerUser.id : schedule.userId,
        })),
        projectTasks,
      );
      setAllSchedules(enrichedSchedules);
      setSelectedGroupIds(new Set());
      setHasLoadedSchedules(true);
      try {
        const absencesRaw = await backendClient.getAbsences();
        setPlannerAbsences(mapAbsencesResponse(absencesRaw));
      } catch {
        // Absence data unavailable — date picker shows no absence highlights
      }

      if (mapped.schedules.length === 0) {
        setStatusMessage(
          mapped.warnings.length > 0
            ? "awork hat Blocker zurückgegeben, aber die Felder konnten nicht gelesen werden."
            : unscheduledAssignedTasks.length > 0
              ? `${unscheduledAssignedTasks.length} aktive Aufgaben gefunden, aber keine haben Blocker in diesem Zeitraum.`
              : "Keine geplanten Blocker in diesem Zeitraum.",
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Aufgaben-Blocker konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingSchedules(false);
      setScheduleRefreshNotice("");
    }
  }

  async function loadMissingProjectTasks(
    projectTasks: AworkProjectTask[],
    schedules: AworkTaskSchedule[],
  ): Promise<AworkProjectTask[]> {
    const tasksById = new Map(projectTasks.map((task) => [task.id, task]));
    const missingTaskIds = Array.from(
      new Set(
        schedules
          .map((schedule) => schedule.taskId)
          .filter((taskId) => !tasksById.has(taskId)),
      ),
    );

    if (missingTaskIds.length === 0) {
      return projectTasks;
    }

    const resolvedTasks = await Promise.all(
      missingTaskIds.map(async (taskId) => {
        try {
          return mapProjectTaskResponse(await backendClient.getTask(taskId));
        } catch {
          return null;
        }
      }),
    );

    return [
      ...projectTasks,
      ...resolvedTasks.filter((task): task is AworkProjectTask =>
        Boolean(task),
      ),
    ];
  }

  async function loadProjects() {
    if (!currentUser) return;

    setIsLoadingProjects(true);
    setError("");

    try {
      const [projectsResponse, myTasksResponse] = await Promise.all([
        backendClient.getProjects(),
        myAssignedTaskIds.size === 0
          ? backendClient.getUserAssignedTasks(currentUser.id)
          : Promise.resolve<unknown>(null),
      ]);
      setAvailableProjects(mapProjectsResponse(projectsResponse));
      if (myAssignedTaskIds.size === 0) {
        const myTasksArray = mapProjectTasksResponse(myTasksResponse);
        setMyAssignedTaskIds(new Set(myTasksArray.map((t) => t.id)));
        setMyAssignedProjectIds(
          new Set(myTasksArray.map((t) => t.projectId).filter(Boolean)),
        );
      }
    } catch (projectError) {
      setError(
        projectError instanceof Error
          ? projectError.message
          : "Projekte konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingProjects(false);
    }
  }

  async function loadUsers() {
    if (!currentUser) return;

    setIsLoadingUsers(true);
    setError("");

    try {
      const users = await backendClient.getUsers();
      setAvailableUsers(users);
    } catch (usersError) {
      setError(
        usersError instanceof Error
          ? usersError.message
          : "awork-Nutzer konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingUsers(false);
    }
  }

  async function loadProjectTasks(projectId: string) {
    setIsLoadingProjectTasks(true);
    setError("");

    try {
      const response = await backendClient.getProjectTasks(projectId);
      setProjectTasksForCreate(mapProjectTasksResponse(response));
    } catch (taskError) {
      setError(
        taskError instanceof Error
          ? taskError.message
          : "Projektaufgaben konnten nicht geladen werden.",
      );
    } finally {
      setIsLoadingProjectTasks(false);
    }
  }

  async function loadProjectTasksList(
    projectId: string,
  ): Promise<AworkProjectTask[]> {
    const response = await backendClient.getProjectTasks(projectId);
    return mapProjectTasksResponse(response);
  }

  async function createProjectSchedules(
    payloads: CreateTaskSchedulePayload[],
  ): Promise<boolean> {
    if (!plannerUser) {
      setError("Bitte Planner-Nutzer auswählen.");
      return false;
    }
    if (payloads.length === 0) return false;

    setIsCreatingSchedules(true);
    setError("");
    let successCount = 0;
    const failures: string[] = [];

    try {
      for (const payload of payloads) {
        try {
          await backendClient.createTaskSchedule({
            ...payload,
            userId: plannerUser.id,
          });
          successCount += 1;
        } catch (createError) {
          failures.push(
            createError instanceof Error
              ? createError.message
              : "Anlegen fehlgeschlagen.",
          );
        }
      }

      setStatusMessage(
        `${successCount} Blocker angelegt. ${failures.length} fehlgeschlagen.`,
      );
      if (successCount > 0) {
        setCreateSuccess({ count: successCount, failed: failures.length });
      }
      if (failures.length > 0) setError(failures.slice(0, 3).join(" | "));
      if (successCount > 0 && hasLoadedSchedules) {
        await loadSchedules({
          refreshNotice:
            "Projekt-Blocker nach dem Anlegen werden aktualisiert. Du kannst weiterarbeiten, neue awork-Daten erscheinen gleich.",
        });
      }

      return successCount > 0;
    } finally {
      setIsCreatingSchedules(false);
    }
  }

  async function loadCreateSchedules(
    from: string,
    to: string,
  ): Promise<AworkTaskSchedule[]> {
    if (!plannerUser) {
      return [];
    }

    const response = await backendClient.getTaskSchedules({
      from,
      to,
      userId: plannerUser.id,
    });
    const mapped = mapTaskSchedulesResponse(response);
    const projectTasks = await loadMissingProjectTasks(
      projectTasksForCreate,
      mapped.schedules,
    );

    return enrichSchedulesWithProjectTasks(
      mapped.schedules.map((schedule) => ({
        ...schedule,
        userId: plannerUser.id,
      })),
      projectTasks,
    );
  }

  async function loadPlannerUserCapacity(): Promise<
    AworkUserCapacity | undefined
  > {
    if (!plannerUser) {
      return undefined;
    }

    return backendClient.getUserCapacity(plannerUser.id);
  }

  async function createTaskSchedules(
    payloads: CreateTaskSchedulePayload[],
    options: CreateGroupOptions,
  ): Promise<boolean> {
    if (!plannerUser) {
      setError("Bitte Planner-Nutzer auswählen.");
      return false;
    }

    setIsCreatingSchedules(true);
    setError("");

    let successCount = 0;
    const failures: string[] = [];
    let taskId = payloads[0]?.taskId;
    let taskCreated: string | undefined;

    try {
      if (options.newTaskName) {
        const plannedDuration = payloads.reduce(
          (sum, payload) => sum + payload.plannedDuration,
          0,
        );
        const createdTaskResponse = await backendClient.createProjectTask(
          options.projectId,
          {
            name: options.newTaskName,
            plannedDuration,
            userId: plannerUser?.id,
          },
        );
        const createdTask = mapProjectTaskResponse(createdTaskResponse);

        if (!createdTask) {
          throw new Error(
            "Neue Aufgabe angelegt, aber die Antwort konnte nicht verarbeitet werden.",
          );
        }

        taskId = createdTask.id;
        taskCreated = createdTask.name ?? options.newTaskName;
        setProjectTasksForCreate((currentTasks) => [
          createdTask,
          ...currentTasks.filter((task) => task.id !== createdTask.id),
        ]);
      }

      for (const payload of payloads) {
        if (payload.userId !== plannerUser?.id) {
          failures.push(
            `${payload.startDate}: Berechtigung vor dem Anlegen konnte nicht geprüft werden.`,
          );
          continue;
        }

        if (!taskId) {
          failures.push(`${payload.startDate}: Aufgaben-ID fehlt.`);
          continue;
        }

        try {
          await backendClient.createTaskSchedule({ ...payload, taskId });
          successCount += 1;
        } catch (createError) {
          failures.push(
            createError instanceof Error
              ? createError.message
              : "Anlegen fehlgeschlagen.",
          );
        }
      }

      setStatusMessage(
        taskCreated
          ? `Aufgabe "${taskCreated}" angelegt. ${successCount} Blocker angelegt. ${failures.length} fehlgeschlagen.`
          : `${successCount} Blocker angelegt. ${failures.length} fehlgeschlagen.`,
      );
      if (successCount > 0 || taskCreated) {
        setCreateSuccess({
          count: successCount,
          failed: failures.length,
          taskCreated,
        });
      }
      if (failures.length > 0) setError(failures.slice(0, 3).join(" | "));
      if (successCount > 0 && hasLoadedSchedules) {
        await loadSchedules({
          refreshNotice:
            "Aufgaben-Blocker nach dem Anlegen werden aktualisiert. Du kannst weiterarbeiten, neue awork-Daten erscheinen gleich.",
        });
      }

      return successCount > 0;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Aufgabe oder Blocker konnten nicht angelegt werden.",
      );
      return false;
    } finally {
      setIsCreatingSchedules(false);
    }
  }

  function handlePreview(changes: PreviewChange[]) {
    setPreviewChanges(changes);
    setUpdateResults(undefined);
  }

  function handleBlockerOperationsPreview(operations: BlockerOperation[]) {
    setBlockerOperations(operations);
    setBlockerOperationResults(undefined);
  }

  function handleManualEditRequest(group: ScheduleGroup) {
    setSelectedGroup(undefined);
    setManualEditGroup(group);
  }

  async function handleDeleteGroup() {
    if (!plannerUser || !deleteGroup) return;

    setIsDeleting(true);
    setError("");

    try {
      const results = await deleteScheduleGroup(
        backendClient,
        plannerUser,
        deleteGroup,
      );
      setDeleteResults(results);
      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;
      setStatusMessage(
        `${successCount} Blocker ausgeplant. ${failureCount} fehlgeschlagen.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setDeleteSuccess({ count: successCount, failed: failureCount });
      }
      if (successCount > 0) {
        await loadSchedules({
          refreshNotice:
            "Geplante Aufgaben werden nach dem Ausplanen aktualisiert. Du kannst weiterarbeiten – neue awork-Daten erscheinen gleich.",
        });
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Blocker konnten nicht ausgeplant werden.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleApplyBlockerOperations() {
    if (!plannerUser || !blockerOperations) return;

    setIsApplyingBlockerOperations(true);
    setError("");

    try {
      const results = await applyBlockerOperations(
        backendClient,
        plannerUser,
        blockerOperations,
      );
      setBlockerOperationResults(results);
      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;
      setStatusMessage(
        `${successCount} Blocker-Operationen angewendet. ${failureCount} fehlgeschlagen.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setUpdateSuccess({
          count: successCount,
          failed: failureCount,
          title: "BÄM, Blocker angepasst.",
          detail:
            "Ausgewählte Blocker wurden aktualisiert, hinzugefügt oder ausgeplant. Die awork-Aufgabe wurde nicht gelöscht.",
        });
      }
      if (successCount > 0) {
        await loadSchedules({
          refreshNotice:
            "Geplante Aufgaben werden nach den Blocker-Änderungen aktualisiert. Du kannst weiterarbeiten – neue awork-Daten erscheinen gleich.",
        });
      }
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : "Blocker-Operationen konnten nicht angewendet werden.",
      );
    } finally {
      setIsApplyingBlockerOperations(false);
    }
  }

  async function handleApplyChanges() {
    if (!plannerUser || !previewChanges) return;

    setIsUpdating(true);
    setError("");

    try {
      const results = await updateScheduleChanges(
        backendClient,
        plannerUser,
        previewChanges,
      );
      setUpdateResults(results);
      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;
      setStatusMessage(
        `${successCount} Blocker aktualisiert. ${failureCount} fehlgeschlagen.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setUpdateSuccess({ count: successCount, failed: failureCount });
      }
      await loadSchedules({
        refreshNotice:
          "Geplante Aufgaben werden nach der Bearbeitung aktualisiert. Du kannst weiterarbeiten – neue awork-Daten erscheinen gleich.",
      });
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Aktualisierungen konnten nicht angewendet werden.",
      );
    } finally {
      setIsUpdating(false);
    }
  }

  function closeModals() {
    setSelectedGroup(undefined);
    setMultiEditGroups(undefined);
    setManualEditGroup(undefined);
    setDeleteGroup(undefined);
    setPreviewChanges(undefined);
    setBlockerOperations(undefined);
    setBlockerOperationResults(undefined);
    setUpdateResults(undefined);
    setDeleteResults(undefined);
  }

  if (isAnalysisRoute) {
    return (
      <>
        <div className="status-toast-region">
          <BackendStatusIndicator backendClient={backendClient} />
        </div>
        <CapacityAnalysisPage
          backendClient={backendClient}
          currentUser={currentUser}
          isConnecting={isConnecting}
          isAuthorized
          isCheckingAccess={false}
          onLogin={handleLogin}
          onDisconnect={handleDisconnect}
        />
      </>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">awork planner utility</p>
          <h1>
            Self-Service Bulk Planner
            {hasMonitoringAccess ? (
              <button
                className="monitoring-trigger"
                onClick={() => setShowMonitoringModal(true)}
                aria-label="Monitoring Tool öffnen"
                title="Monitoring Tool"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 16h16M4 12l3-4 3 2 4-6 2 3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : null}
          </h1>
        </div>
        <p>
          Geplante Aufgaben-Blocker für den ausgewählten Planner-Nutzer
          bearbeiten.
        </p>
        <div
          className="whats-new-teaser"
          role="button"
          tabIndex={0}
          aria-label="What's New öffnen"
          onClick={openWhatsNew}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openWhatsNew();
            }
          }}
        >
          <span className="whats-new-teaser-label">What&apos;s new</span>
          {showWhatsNewDot ? (
            <span className="whats-new-teaser-dot" aria-hidden="true" />
          ) : null}
        </div>
      </header>

      <ConnectionPanel
        currentUser={currentUser}
        isConnecting={isConnecting}
        onLogin={handleLogin}
        onDisconnect={handleDisconnect}
      />

      {currentUser ? (
        <PlannerUserSelector
          currentUser={currentUser}
          selectedUserId={selectedPlannerUserId}
          users={availableUsers}
          isLoadingUsers={isLoadingUsers}
          onLoadUsers={loadUsers}
          onChange={handlePlannerUserChange}
          analysisHref={getCapacityAnalysisHref()}
        />
      ) : null}

      {workflow === "manage" ? (
        <>
          <FilterPanel
            filters={filters}
            projectOptions={projectOptions}
            hasLoadedSchedules={hasLoadedSchedules}
            disabled={!plannerUser}
            isLoading={isLoadingSchedules}
            workflowToggle={
              <WorkflowChooser
                value={workflow}
                disabled={!currentUser}
                pulseWorkflow={pulseProjectWorkflow ? "project" : undefined}
                onChange={handleWorkflowChange}
              />
            }
            onChange={setFilters}
            onLoad={loadSchedules}
          />

          {isLoadingSchedules ? (
            <p className="loading-text-hint">
              Geplante Aufgaben werden geladen...
            </p>
          ) : null}
          {scheduleRefreshNotice ? (
            <div className="refresh-notice" aria-live="polite">
              <span className="refresh-notice__icon" aria-hidden="true">
                <span className="spinner" />
              </span>
              <div className="refresh-notice-copy">
                <span className="refresh-notice-title">
                  Synchronisiere geplante Aufgaben im Hintergrund...
                </span>
                <span className="refresh-notice-detail">
                  {scheduleRefreshNotice}
                </span>
              </div>
            </div>
          ) : null}
          <ScheduleGroupsList
            groups={groups}
            hasLoaded={hasLoadedSchedules}
            selectedGroupIds={selectedGroupIds}
            onSelectionChange={setSelectedGroupIds}
            onMultiEdit={() => setMultiEditGroups(selectedGroups)}
            onChangeTimeWindow={setSelectedGroup}
            onDeleteGroup={(group) => {
              setDeleteGroup(group);
              setDeleteResults(undefined);
            }}
            isMultiEditAvailable={isMultiEditAvailable}
          />
        </>
      ) : workflow === "create" && plannerUser ? (
        <CreateScheduleGroupPanel
          currentUser={plannerUser}
          projects={availableProjects}
          tasks={projectTasksForCreate}
          isLoadingProjects={isLoadingProjects}
          isLoadingTasks={isLoadingProjectTasks}
          isCreating={isCreatingSchedules}
          myAssignedTaskIds={myAssignedTaskIds}
          myAssignedProjectIds={myAssignedProjectIds}
          absenceRanges={plannerAbsenceRanges}
          workflowToggle={
            <WorkflowChooser
              value={workflow}
              disabled={!currentUser}
              pulseWorkflow={pulseProjectWorkflow ? "project" : undefined}
              onChange={handleWorkflowChange}
            />
          }
          onLoadProjects={loadProjects}
          onProjectChange={loadProjectTasks}
          onLoadExistingSchedules={loadCreateSchedules}
          onLoadUserCapacity={loadPlannerUserCapacity}
          pulseAutoPlan={pulseAutoPlanMode}
          onOpenAutoPlan={handleAutoPlanOpen}
          onCreate={createTaskSchedules}
        />
      ) : workflow === "project" && plannerUser ? (
        <ProjectPlanPanel
          currentUser={plannerUser}
          projects={availableProjects}
          isLoadingProjects={isLoadingProjects}
          isCreating={isCreatingSchedules}
          myAssignedProjectIds={myAssignedProjectIds}
          workflowToggle={
            <WorkflowChooser
              value={workflow}
              disabled={!currentUser}
              pulseWorkflow={pulseProjectWorkflow ? "project" : undefined}
              onChange={handleWorkflowChange}
            />
          }
          onLoadProjects={loadProjects}
          onLoadProjectTasks={loadProjectTasksList}
          onLoadExistingSchedules={loadCreateSchedules}
          onLoadUserCapacity={loadPlannerUserCapacity}
          onCreate={createProjectSchedules}
        />
      ) : workflow === "create" || workflow === "project" ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Workflow</p>
              <h2>
                {workflow === "project" ? "Projekt einplanen" : "Blocker anlegen"}
              </h2>
            </div>
            <WorkflowChooser
              value={workflow}
              disabled={!currentUser}
              pulseWorkflow={pulseProjectWorkflow ? "project" : undefined}
              onChange={handleWorkflowChange}
            />
          </div>
        </section>
      ) : null}

      {activeFeatureModal ? (
        <ModalShell
          labelledBy="feature-announcement-title"
          dialogClassName="modal feature-announcement-modal"
          onClose={() => setActiveFeatureModal(null)}
        >
          <div className="modal-header feature-announcement-header">
            <h2 id="feature-announcement-title">
              {activeFeatureModal === "whats-new"
                ? "What's New"
                : activeFeatureModal === "project-plan"
                  ? "Neu: Projekt einplanen"
                  : "Neu: Auto Plan"}
            </h2>
            <button
              type="button"
              className="ghost-button feature-announcement-close"
              onClick={() => setActiveFeatureModal(null)}
              aria-label="Popup schließen"
            >
              ×
            </button>
          </div>

          {activeFeatureModal === "whats-new" ? (
            <div className="feature-announcement-copy">
              <h3 className="release-notes-headline">🎉 Projekt einplanen & Auto Plan sind da</h3>
              <p className="release-notes-intro">
                Zwei super Features, die dir dein Planungs-Leben massiv leichter machen. Die alte Realität: Task für Task einplanen. Die neue: Plan ein ganzes Projekt auf einmal. Oder lass den Computer arbeiten und platziere automatisch.
              </p>
              <div className="feature-announcement-list">
                <div className="feature-item">
                  <h4>✨ Projekt einplanen</h4>
                  <p>Verabschiede dich von Task für Task planen. Öffne ein Projekt, wähle die ungeplanten Tasks, die der Tool soll planen, definiere Wochentage und Arbeitszeiten — und der Tool verteilt sie automatisch intelligent über deinen Kalender, respektiert deine aktuelle Auslastung und findet immer den nächsten freien Slot. Und bevor du mittig speicherst, kannst du alles noch feinjustieren in der Vorschau.</p>
                </div>
                <div className="feature-item">
                  <h4>⚡ Auto Plan</h4>
                  <p>Du hast ne Aufgabe, weißt aber nicht, wo du die sonst einbauen sollst? Auto Plan macht das für dich. Du gibst vor: Zeitraum, Arbeitszeiten, und wie lange die Task dauert — und der Tool durchsucht deinen Kalender, findet freie Slots, respektiert deine Kapazität und schlägt dir perfekte Zeiten vor. Kein Herumprobieren mehr.</p>
                </div>
              </div>
            </div>
          ) : activeFeatureModal === "project-plan" ? (
            <div className="feature-announcement-copy">
              <h3 className="release-notes-headline">🚀 Projekt einplanen — endlich!</h3>
              <p className="release-notes-intro">
                Die Problem ist real: Du hast ein Projekt in awork. Die Tasks sind definiert. Aber jetzt musst du Task um Task manuell planen. Das ist anstrengend, besonders wenn ne ganze Batch da ist.
              </p>
              <p className="release-notes-solution">
                <strong>So läufts jetzt:</strong> Öffne "Projekt einplanen", wähle dein Projekt, hake die Tasks an, die geplant werden sollen — und der Tool macht den Rest.
              </p>
              <ul className="feature-steps">
                <li>💡 Tool liest die awork Zeitrahmen und die geplante Zeit jeder Task aus</li>
                <li>📅 Du definierst: Welche Wochentage, Start/End-Zeit im Tag, wie verteilst du? (gleichmäßig oder gebündelt)</li>
                <li>🎯 Der Tool plant alle Tasks intelligent um deine aktuellen Blocker herum</li>
                <li>✏️ In der Vorschau kannst du noch jeden Blocker manuell verschieben oder löschen</li>
                <li>✅ Ein Klick — alle Blocker angelegt.</li>
              </ul>
            </div>
          ) : (
            <div className="feature-announcement-copy">
              <h3 className="release-notes-headline">⚡ Auto Plan — dein neuer Zeitmanager</h3>
              <p className="release-notes-intro">
                Du kennst das: "Ich muss die Task noch irgendwann einplanen, aber wo passt sie rein?" Das Rumprobieren im Kalender ist nervig. Blockers finden, Gaps suchen, probieren, verwirft — fertig. Das ist vorbei.
              </p>
              <p className="release-notes-solution">
                <strong>Hier kommt Auto Plan:</strong> Gib der Aufgabe ne Dauer, einen Zeitraum und Arbeitszeiten vor — und der Tool durchsucht deinen Kalender automatisch, findet freie Slots, respektiert deine Kapazität und schlägt dir perfekte Zeitfenster vor.
              </p>
              <ul className="feature-steps">
                <li>⏱️ Du gibst vor: Dauer (z.B. 8h), Zeitraum (z.B. diese Woche bis nächste), Wochentage (Mo-Fr), Arbeitszeiten (9-17 Uhr)</li>
                <li>🔍 Der Tool scannt deinen aktuellen Kalender automatisch</li>
                <li>📍 Er findet zusammenhängende freie Slots und berücksichtigt deine Kapazität</li>
                <li>✅ Der Tool schlägt dir sinnvolle Blockers vor (z.B. Mo 2h, Di 2h, Mi 2h, Do 2h)</li>
                <li>🎯 Du reviewst in der Vorschau und stellst noch was nach — oder speicherst direkt.</li>
              </ul>
            </div>
          )}

          <div className="modal-actions">
            {activeFeatureModal !== "whats-new" ? (
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  void confirmFeatureModal(
                    activeFeatureModal === "project-plan"
                      ? FEATURE_KEYS.projectPlanIntro
                      : FEATURE_KEYS.autoPlanIntro,
                  )
                }
              >
                OK, nicht mehr anzeigen
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                onClick={() => setActiveFeatureModal(null)}
              >
                Schließen
              </button>
            )}
          </div>
        </ModalShell>
      ) : null}

      {selectedGroup && plannerUser && !previewChanges ? (
        <BulkEditModal
          group={selectedGroup}
          currentUser={plannerUser}
          onClose={closeModals}
          onPreview={handlePreview}
          onManualEditRequest={handleManualEditRequest}
        />
      ) : null}

      {multiEditGroups &&
      plannerUser &&
      !previewChanges &&
      !blockerOperations &&
      isMultiEditAvailable ? (
        <MultiGroupDurationEditModal
          groups={multiEditGroups}
          currentUser={plannerUser}
          onClose={closeModals}
          onPreview={handlePreview}
          onUnplanPreview={(operations) => {
            setMultiEditGroups(undefined);
            handleBlockerOperationsPreview(operations);
          }}
        />
      ) : null}

      {manualEditGroup && plannerUser ? (
        <ManualBlockerEditModal
          group={manualEditGroup}
          currentUser={plannerUser}
          onBack={() => {
            setSelectedGroup(manualEditGroup);
            setManualEditGroup(undefined);
          }}
          onClose={closeModals}
          onPreview={handleBlockerOperationsPreview}
        />
      ) : null}

      {deleteGroup ? (
        <DeleteGroupModal
          group={deleteGroup}
          isDeleting={isDeleting}
          deleteResults={deleteResults}
          onCancel={closeModals}
          onDelete={handleDeleteGroup}
        />
      ) : null}

      {createSuccess ? (
        <SuccessPopup
          title="Blocker angelegt"
          message={`${createSuccess.count} Blocker erfolgreich angelegt.`}
          detail={
            createSuccess.taskCreated
              ? `Aufgabe angelegt: ${createSuccess.taskCreated}. ${createSuccess.failed > 0 ? `${createSuccess.failed} Blocker fehlgeschlagen.` : "Alle Blocker wurden für den Planner-Nutzer angelegt."}`
              : createSuccess.failed > 0
                ? `${createSuccess.failed} fehlgeschlagen und unverändert geblieben.`
                : "Alle Blocker wurden für den ausgewählten Planner-Nutzer angelegt."
          }
          onClose={() => setCreateSuccess(undefined)}
        />
      ) : null}

      {deleteSuccess ? (
        <SuccessPopup
          title="Gruppe ausgeplant"
          message={`${deleteSuccess.count} Blocker erfolgreich ausgeplant.`}
          detail="Alle ausgewählten Blocker wurden aus dem Planner entfernt. Die awork-Aufgabe wurde nicht gelöscht."
          onClose={() => setDeleteSuccess(undefined)}
        />
      ) : null}

      {updateSuccess ? (
        <SuccessPopup
          title={updateSuccess.title ?? "Zeitfenster angepasst"}
          message={`${updateSuccess.count} Blocker erfolgreich aktualisiert.`}
          detail={
            updateSuccess.detail ??
            "Das neue Zeitfenster wurde auf die ausgewählten Blocker angewendet."
          }
          onClose={() => setUpdateSuccess(undefined)}
        />
      ) : null}

      {blockerOperations ? (
        <BlockerOperationsPreviewModal
          operations={blockerOperations}
          isApplying={isApplyingBlockerOperations}
          results={blockerOperationResults}
          onBack={() => {
            setBlockerOperations(undefined);
            setBlockerOperationResults(undefined);
          }}
          onCancel={closeModals}
          onApply={handleApplyBlockerOperations}
        />
      ) : null}

      {previewChanges ? (
        <PreviewChangesModal
          changes={previewChanges}
          isUpdating={isUpdating}
          updateResults={updateResults}
          onBack={() => {
            setPreviewChanges(undefined);
            setUpdateResults(undefined);
          }}
          onCancel={closeModals}
          onApply={handleApplyChanges}
        />
      ) : null}

      {showMonitoringModal ? (
        <MonitoringModal
          backendClient={backendClient}
          onClose={() => setShowMonitoringModal(false)}
        />
      ) : null}

      <div className="status-toast-region">
        <BackendStatusIndicator backendClient={backendClient} />
        <AnimatePresence>
          {error ? (
            <StatusToast
              key="error"
              message={error}
              variant="error"
              onDismiss={() => setError("")}
            />
          ) : null}
          {statusMessage ? (
            <StatusToast
              key="status"
              message={statusMessage}
              variant="success"
              autoDismissMs={5000}
              onDismiss={() => setStatusMessage("")}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}

export default App;

function isTaskActive(task: AworkProjectTask): boolean {
  const normalizedStatusType = task.statusType?.trim().toLowerCase();
  return (
    !normalizedStatusType ||
    !["done", "completed", "closed"].includes(normalizedStatusType)
  );
}

function getPlannerSchedules(
  schedules: AworkTaskSchedule[],
  plannerUser: AworkUser,
): AworkTaskSchedule[] {
  return schedules.filter((schedule) => isOwnSchedule(schedule, plannerUser));
}

function isCapacityAnalysisRoute(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "analysis") {
    return true;
  }

  const path = window.location.pathname.replace(/\/$/, "");
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return path === `${base}/analysis` || path === "/analysis";
}

function getCapacityAnalysisHref(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}?view=analysis`;
}
