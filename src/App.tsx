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
import type {
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
import { ErrorAlert } from "./components/ErrorAlert";
import { FilterPanel } from "./components/FilterPanel";
import { LoadingState } from "./components/LoadingState";
import { ManualBlockerEditModal } from "./components/ManualBlockerEditModal";
import { ManualEditConfirmModal } from "./components/ManualEditConfirmModal";
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

const backendClient = new BackendClient();

interface LoadSchedulesOptions {
  refreshNotice?: string;
}

function App() {
  const lastSessionCheckRef = useRef(0);
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
  const [manualConfirmGroup, setManualConfirmGroup] = useState<ScheduleGroup>();
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
  }));
  const [isMultiEditAvailable] = useState(true);
  const isAnalysisRoute = isCapacityAnalysisRoute();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnedFromLogin = params.get("aworkLogin") === "success";

    if (returnedFromLogin) {
      storeSessionTokenFromUrl();
      setStatusMessage("awork login completed. Checking your session...");
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
      return true;
    });
  }, [
    allSchedules,
    plannerUser,
    filters.from,
    filters.to,
    filters.hidePast,
    filters.projectId,
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
        setStatusMessage(
          returnedFromLogin
            ? "awork login successful. Choose a workflow."
            : "awork OAuth session restored.",
        );
      } else if (returnedFromLogin) {
        setError(
          "awork login returned to the app, but no backend session was found. Please restart the backend and try again.",
        );
      }
    } catch (sessionError) {
      setCurrentUser(undefined);
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "Could not check backend auth session.",
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
    setProjectTasksForCreate([]);
    setHasLoadedSchedules(false);
    setFilters((currentFilters) => ({ ...currentFilters, projectId: "" }));
    setSelectedGroup(undefined);
    setSelectedGroupIds(new Set());
    setMultiEditGroups(undefined);
    setManualConfirmGroup(undefined);
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
    setCurrentUser(undefined);
    setSelectedPlannerUserId("");
    setAllSchedules([]);
    setAvailableProjects([]);
    setAvailableUsers([]);
    setProjectTasksForCreate([]);
    setHasLoadedSchedules(false);
    setSelectedGroup(undefined);
    setSelectedGroupIds(new Set());
    setMultiEditGroups(undefined);
    setManualConfirmGroup(undefined);
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
    setStatusMessage("Disconnected.");
    setError("");
  }

  async function loadSchedules(options: LoadSchedulesOptions = {}) {
    if (!plannerUser) {
      setError("Connect to awork before loading planned tasks.");
      return;
    }

    setIsLoadingSchedules(true);
    setScheduleRefreshNotice(options.refreshNotice ?? "");
    setError("");
    setStatusMessage("");

    try {
      const [scheduleResponse, projectTaskResponse] = await Promise.all([
        backendClient.getTaskSchedules({
          from: filters.from,
          to: filters.to,
          userId: selectedPlannerUserId || undefined,
        }),
        !selectedPlannerUserId
          ? backendClient.getMyProjectTasks()
          : backendClient.getUserAssignedTasks(plannerUser.id),
      ]);
      const mapped = mapTaskSchedulesResponse(scheduleResponse);
      const projectTasks = await loadMissingProjectTasks(
        mapProjectTasksResponse(projectTaskResponse),
        mapped.schedules,
      );
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

      if (mapped.schedules.length === 0) {
        setStatusMessage(
          mapped.warnings.length > 0
            ? "awork returned schedules, but the app could not read their task, start, or end fields."
            : unscheduledAssignedTasks.length > 0
              ? `${unscheduledAssignedTasks.length} active awork tasks were found, but none have schedule blocks in this range.`
              : "No planned blockers found for this date range.",
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load task schedules.",
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
      const response = await backendClient.getProjects();
      setAvailableProjects(mapProjectsResponse(response));
    } catch (projectError) {
      setError(
        projectError instanceof Error
          ? projectError.message
          : "Could not load projects.",
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
          : "Could not load awork users.",
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
          : "Could not load project tasks.",
      );
    } finally {
      setIsLoadingProjectTasks(false);
    }
  }

  async function createTaskSchedules(
    payloads: CreateTaskSchedulePayload[],
    options: CreateGroupOptions,
  ) {
    if (!plannerUser) {
      setError("Select a planner user before creating blockers.");
      return;
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
            "New awork task was created, but the response could not be mapped.",
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
            `${payload.startDate}: ownership check failed before create.`,
          );
          continue;
        }

        if (!taskId) {
          failures.push(`${payload.startDate}: task id is missing.`);
          continue;
        }

        try {
          await backendClient.createTaskSchedule({ ...payload, taskId });
          successCount += 1;
        } catch (createError) {
          failures.push(
            createError instanceof Error
              ? createError.message
              : "Create failed.",
          );
        }
      }

      setStatusMessage(
        taskCreated
          ? `Task "${taskCreated}" created. ${successCount} planned blockers created. ${failures.length} failed.`
          : `${successCount} planned blockers created. ${failures.length} failed.`,
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
            "Updating planned tasks after creating blockers. You can keep looking at the page; fresh awork data will appear in a moment.",
        });
      }
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create task or planned blockers.",
      );
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
    setManualConfirmGroup(group);
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
        `${successCount} planned blockers unplanned. ${failureCount} failed.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setDeleteSuccess({ count: successCount, failed: failureCount });
      }
      if (successCount > 0) {
        await loadSchedules({
          refreshNotice:
            "Updating planned tasks after unplanning blockers. You can keep looking at the page; fresh awork data will appear in a moment.",
        });
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete schedule group.",
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
        `${successCount} blocker operations applied. ${failureCount} failed.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setUpdateSuccess({
          count: successCount,
          failed: failureCount,
          title: "BÄM, Blocker angepasst.",
          detail:
            "The selected blocker updates, additions, and unplans were applied. The awork task was not deleted.",
        });
      }
      if (successCount > 0) {
        await loadSchedules({
          refreshNotice:
            "Updating planned tasks after applying blocker changes. You can keep looking at the page; fresh awork data will appear in a moment.",
        });
      }
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : "Could not apply blocker operations.",
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
        `${successCount} planned blockers updated. ${failureCount} failed.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setUpdateSuccess({ count: successCount, failed: failureCount });
      }
      await loadSchedules({
        refreshNotice:
          "Updating planned tasks after editing blockers. You can keep looking at the page; fresh awork data will appear in a moment.",
      });
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not apply updates.",
      );
    } finally {
      setIsUpdating(false);
    }
  }

  function closeModals() {
    setSelectedGroup(undefined);
    setMultiEditGroups(undefined);
    setManualConfirmGroup(undefined);
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
        <BackendStatusIndicator backendClient={backendClient} />
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
      <BackendStatusIndicator backendClient={backendClient} />
      <header className="app-header">
        <div>
          <p className="eyebrow">awork planner utility</p>
          <h1>Self-Service Bulk Planner</h1>
        </div>
        <p>
          Bulk-edit recurring task blockers for the selected awork planner user.
        </p>
      </header>

      <ErrorAlert message={error} />
      {statusMessage ? (
        <div className="alert alert-success">{statusMessage}</div>
      ) : null}

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

      <WorkflowChooser
        value={workflow}
        disabled={!currentUser}
        onChange={setWorkflow}
      />

      {workflow === "manage" ? (
        <>
          <FilterPanel
            filters={filters}
            projectOptions={projectOptions}
            hasLoadedSchedules={hasLoadedSchedules}
            disabled={!plannerUser}
            isLoading={isLoadingSchedules}
            onChange={setFilters}
            onLoad={loadSchedules}
          />

          {isLoadingSchedules ? (
            <LoadingState label="Loading planned tasks from awork..." />
          ) : null}
          {scheduleRefreshNotice ? (
            <div className="refresh-notice" aria-live="polite">
              <span className="spinner" />
              <div>
                <strong>Planned tasks are being updated</strong>
                <span>{scheduleRefreshNotice}</span>
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
          onLoadProjects={loadProjects}
          onProjectChange={loadProjectTasks}
          onCreate={createTaskSchedules}
        />
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

      {manualConfirmGroup ? (
        <ManualEditConfirmModal
          group={manualConfirmGroup}
          onBack={() => {
            setSelectedGroup(manualConfirmGroup);
            setManualConfirmGroup(undefined);
          }}
          onCancel={closeModals}
          onConfirm={() => {
            setManualEditGroup(manualConfirmGroup);
            setManualConfirmGroup(undefined);
          }}
        />
      ) : null}

      {manualEditGroup && plannerUser ? (
        <ManualBlockerEditModal
          group={manualEditGroup}
          currentUser={plannerUser}
          onBack={() => {
            setManualConfirmGroup(manualEditGroup);
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
          title="BÄM, Aufgabe erledigt."
          message={`${createSuccess.count} planned blocker${createSuccess.count === 1 ? "" : "s"} created successfully.`}
          detail={
            createSuccess.taskCreated
              ? `Task created: ${createSuccess.taskCreated}. ${createSuccess.failed > 0 ? `${createSuccess.failed} blockers failed.` : "All blockers were planned for the selected planner user."}`
              : createSuccess.failed > 0
                ? `${createSuccess.failed} failed and stayed untouched.`
                : "Everything was created for the selected planner user."
          }
          onClose={() => setCreateSuccess(undefined)}
        />
      ) : null}

      {deleteSuccess ? (
        <SuccessPopup
          title="BÄM, Gruppe ausgeplant."
          message={`${deleteSuccess.count} planned blocker${deleteSuccess.count === 1 ? "" : "s"} unplanned successfully.`}
          detail="All selected blockers were removed from your planner. The awork task was not deleted."
          onClose={() => setDeleteSuccess(undefined)}
        />
      ) : null}

      {updateSuccess ? (
        <SuccessPopup
          title={updateSuccess.title ?? "BÄM, Zeitfenster angepasst."}
          message={`${updateSuccess.count} planned blocker${updateSuccess.count === 1 ? "" : "s"} updated successfully.`}
          detail={
            updateSuccess.detail ??
            "The new time window was applied to the selected blockers."
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
