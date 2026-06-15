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
  getStoredSessionToken,
  storeSessionTokenFromUrl,
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
import { clearFeatureAccessCache } from "./config/featureAccess";
import { AnimatePresence } from "motion/react";

const backendClient = new BackendClient();

interface LoadSchedulesOptions {
  refreshNotice?: string;
}

function App() {
  const lastSessionCheckRef = useRef(0);
  const sessionRestoredRef = useRef(false);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnedFromLogin = params.get("aworkLogin") === "success";

    if (returnedFromLogin) {
      storeSessionTokenFromUrl();
      setStatusMessage("awork Login abgeschlossen. Session wird geprüft...");
      params.delete("aworkLogin");
      const nextQuery = params.toString();
      const nextUrl = nextQuery
        ? `${window.location.pathname}?${nextQuery}`
        : window.location.pathname;
      window.history.replaceState({}, document.title, nextUrl);
    }

    if (returnedFromLogin || getStoredSessionToken()) {
      void restoreBackendSession(returnedFromLogin);
    }
  }, []);

  useEffect(() => {
    function shouldCheckSession() {
      return Boolean(currentUser || getStoredSessionToken());
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

    try {
      const status = await backendClient.getAuthStatus();
      if (status.authenticated && status.user) {
        setCurrentUser(status.user);
        setSelectedPlannerUserId("");
        if (returnedFromLogin) {
          setStatusMessage("awork Login erfolgreich. Workflow wählen.");
          sessionRestoredRef.current = true;
        } else if (!sessionRestoredRef.current) {
          setStatusMessage("awork-Session wiederhergestellt.");
          sessionRestoredRef.current = true;
        }
      } else if (returnedFromLogin) {
        setError(
          "awork Login erfolgreich, aber keine Backend-Session gefunden. Bitte Backend neu starten.",
        );
      }
    } catch (sessionError) {
      setCurrentUser(undefined);
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "Backend-Session konnte nicht geprüft werden.",
      );
    } finally {
      setIsConnecting(false);
    }
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
          <h1>Self-Service Bulk Planner</h1>
        </div>
        <p>
          Geplante Aufgaben-Blocker für den ausgewählten Planner-Nutzer
          bearbeiten.
        </p>
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
                onChange={setWorkflow}
              />
            }
            onChange={setFilters}
            onLoad={loadSchedules}
          />

          {isLoadingSchedules ? (
            <LoadingState label="Geplante Aufgaben werden geladen..." />
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
              onChange={setWorkflow}
            />
          }
          onLoadProjects={loadProjects}
          onProjectChange={loadProjectTasks}
          onCreate={createTaskSchedules}
        />
      ) : workflow === "create" ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Workflow</p>
              <h2>Blocker anlegen</h2>
            </div>
            <WorkflowChooser
              value={workflow}
              disabled={!currentUser}
              onChange={setWorkflow}
            />
          </div>
        </section>
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
