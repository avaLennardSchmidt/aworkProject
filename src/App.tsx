import { useEffect, useMemo, useState } from "react";
import { endOfYear, format, isBefore, parseISO, startOfToday } from "date-fns";
import { BackendClient } from "./services/backendClient";
import { storeSessionTokenFromUrl } from "./services/backendClient";
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
import type {
  AworkProject,
  AworkProjectTask,
  AworkTaskSchedule,
  AworkUser,
  CreateTaskSchedulePayload,
} from "./types/awork";
import type {
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
import { PreviewChangesModal } from "./components/PreviewChangesModal";
import { ScheduleGroupsList } from "./components/ScheduleGroupsList";
import { SuccessPopup } from "./components/SuccessPopup";
import {
  WorkflowChooser,
  type PlannerWorkflow,
} from "./components/WorkflowChooser";
import { BackendStatusIndicator } from "./components/BackendStatusIndicator";

const backendClient = new BackendClient();

function App() {
  const [currentUser, setCurrentUser] = useState<AworkUser>();
  const [workflow, setWorkflow] = useState<PlannerWorkflow>("manage");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingProjectTasks, setIsLoadingProjectTasks] = useState(false);
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
  }>();
  const [deleteSuccess, setDeleteSuccess] = useState<{
    count: number;
    failed: number;
  }>();
  const [allSchedules, setAllSchedules] = useState<AworkTaskSchedule[]>([]);
  const [availableProjects, setAvailableProjects] = useState<AworkProject[]>(
    [],
  );
  const [projectTasksForCreate, setProjectTasksForCreate] = useState<
    AworkProjectTask[]
  >([]);
  const [hasLoadedSchedules, setHasLoadedSchedules] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ScheduleGroup>();
  const [deleteGroup, setDeleteGroup] = useState<ScheduleGroup>();
  const [previewChanges, setPreviewChanges] = useState<PreviewChange[]>();
  const [updateResults, setUpdateResults] = useState<UpdateResult[]>();
  const [deleteResults, setDeleteResults] = useState<DeleteResult[]>();
  const [filters, setFilters] = useState<PlannerFilters>(() => ({
    from: format(new Date(), "yyyy-MM-dd"),
    to: format(endOfYear(new Date()), "yyyy-MM-dd"),
    hidePast: true,
    projectId: "",
  }));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("aworkLogin") === "success") {
      storeSessionTokenFromUrl();
      setStatusMessage("awork login completed. Checking your session...");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    void restoreBackendSession(params.get("aworkLogin") === "success");
  }, []);

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    const candidateSchedules = currentUser
      ? allSchedules.filter((schedule) => isOwnSchedule(schedule, currentUser))
      : [];

    candidateSchedules.forEach((schedule) => {
      if (schedule.projectId && schedule.projectName) {
        projects.set(schedule.projectId, schedule.projectName);
      }
    });

    return Array.from(projects.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allSchedules, currentUser]);

  const filteredSchedules = useMemo(() => {
    if (!currentUser) return [];

    const today = startOfToday();
    return allSchedules.filter((schedule) => {
      if (!isOwnSchedule(schedule, currentUser)) return false;
      if (filters.hidePast && isBefore(parseISO(schedule.start), today))
        return false;
      if (filters.projectId && schedule.projectId !== filters.projectId)
        return false;
      return true;
    });
  }, [allSchedules, currentUser, filters.hidePast, filters.projectId]);

  const ignoredOwnershipCount = useMemo(() => {
    if (!currentUser) return 0;
    return allSchedules.filter(
      (schedule) => !isOwnSchedule(schedule, currentUser),
    ).length;
  }, [allSchedules, currentUser]);

  const groups = useMemo(
    () => groupSchedules(filteredSchedules),
    [filteredSchedules],
  );

  async function restoreBackendSession(returnedFromLogin = false) {
    setIsConnecting(true);
    setError("");

    try {
      const status = await backendClient.getAuthStatus();
      if (status.authenticated && status.user) {
        setCurrentUser(status.user);
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

  async function handleDisconnect() {
    await backendClient.logout();
    setCurrentUser(undefined);
    setAllSchedules([]);
    setAvailableProjects([]);
    setProjectTasksForCreate([]);
    setHasLoadedSchedules(false);
    setSelectedGroup(undefined);
    setDeleteGroup(undefined);
    setPreviewChanges(undefined);
    setUpdateResults(undefined);
    setDeleteResults(undefined);
    setCreateSuccess(undefined);
    setUpdateSuccess(undefined);
    setDeleteSuccess(undefined);
    setStatusMessage("Disconnected.");
    setError("");
  }

  async function loadSchedules() {
    if (!currentUser) {
      setError("Connect to awork before loading planned tasks.");
      return;
    }

    setIsLoadingSchedules(true);
    setError("");
    setStatusMessage("");

    try {
      const [scheduleResponse, projectTaskResponse] = await Promise.all([
        backendClient.getTaskSchedules({ from: filters.from, to: filters.to }),
        backendClient.getMyProjectTasks(),
      ]);
      const mapped = mapTaskSchedulesResponse(scheduleResponse);
      const projectTasks = mapProjectTasksResponse(projectTaskResponse);
      const enrichedSchedules = enrichSchedulesWithProjectTasks(
        mapped.schedules,
        projectTasks,
      );
      setAllSchedules(enrichedSchedules);
      setHasLoadedSchedules(true);

      if (mapped.schedules.length === 0) {
        setStatusMessage("No schedules found for this date range.");
      } else if (
        enrichedSchedules.every(
          (schedule) => !isOwnSchedule(schedule, currentUser),
        )
      ) {
        setStatusMessage(
          "Schedules were loaded, but none could be verified as your own.",
        );
      } else {
        const ownSchedulesWithProject = enrichedSchedules.filter(
          (schedule) =>
            isOwnSchedule(schedule, currentUser) &&
            schedule.projectId &&
            schedule.projectName,
        );
        setStatusMessage(
          ownSchedulesWithProject.length > 0
            ? `${enrichedSchedules.length} schedules loaded. Project filter is available.`
            : `${enrichedSchedules.length} schedules loaded. No project data was found in your schedule response.`,
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
    }
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
        if (payload.userId !== currentUser?.id) {
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
      if (successCount > 0 && hasLoadedSchedules) await loadSchedules();
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
  async function handleDeleteGroup() {
    if (!currentUser || !deleteGroup) return;

    setIsDeleting(true);
    setError("");

    try {
      const results = await deleteScheduleGroup(
        backendClient,
        currentUser,
        deleteGroup,
      );
      setDeleteResults(results);
      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;
      setStatusMessage(
        `${successCount} planned blockers deleted. ${failureCount} failed.`,
      );
      if (successCount > 0 && failureCount === 0) {
        closeModals();
        setDeleteSuccess({ count: successCount, failed: failureCount });
      }
      if (successCount > 0) await loadSchedules();
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

  async function handleApplyChanges() {
    if (!currentUser || !previewChanges) return;

    setIsUpdating(true);
    setError("");

    try {
      const results = await updateScheduleChanges(
        backendClient,
        currentUser,
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
      await loadSchedules();
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
    setDeleteGroup(undefined);
    setPreviewChanges(undefined);
    setUpdateResults(undefined);
    setDeleteResults(undefined);
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
          Bulk-edit recurring task blockers for your own awork planner without
          exposing colleague or team controls.
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
            disabled={!currentUser}
            isLoading={isLoadingSchedules}
            onChange={setFilters}
            onLoad={loadSchedules}
          />

          {isLoadingSchedules ? (
            <LoadingState label="Loading planned tasks from awork..." />
          ) : null}

          {ignoredOwnershipCount > 0 ? (
            <div className="alert alert-warning">
              {ignoredOwnershipCount} schedules were ignored because ownership
              could not be verified for the connected user.
            </div>
          ) : null}

          <ScheduleGroupsList
            groups={groups}
            hasLoaded={hasLoadedSchedules}
            onChangeTimeWindow={setSelectedGroup}
            onDeleteGroup={(group) => {
              setDeleteGroup(group);
              setDeleteResults(undefined);
            }}
          />
        </>
      ) : currentUser ? (
        <CreateScheduleGroupPanel
          currentUser={currentUser}
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

      {selectedGroup && currentUser && !previewChanges ? (
        <BulkEditModal
          group={selectedGroup}
          currentUser={currentUser}
          onClose={closeModals}
          onPreview={handlePreview}
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
          title="Bam, Aufgabe erledigt."
          message={`${createSuccess.count} planned blocker${createSuccess.count === 1 ? "" : "s"} created successfully.`}
          detail={
            createSuccess.taskCreated
              ? `Task created: ${createSuccess.taskCreated}. ${createSuccess.failed > 0 ? `${createSuccess.failed} blockers failed.` : "All blockers were planned for your own awork user."}`
              : createSuccess.failed > 0
                ? `${createSuccess.failed} failed and stayed untouched.`
                : "Everything was created for your own awork user only."
          }
          onClose={() => setCreateSuccess(undefined)}
        />
      ) : null}

      {deleteSuccess ? (
        <SuccessPopup
          title="Bam, Gruppe geloescht."
          message={`${deleteSuccess.count} planned blocker${deleteSuccess.count === 1 ? "" : "s"} deleted successfully.`}
          detail="All selected blockers were removed from your planner."
          onClose={() => setDeleteSuccess(undefined)}
        />
      ) : null}

      {updateSuccess ? (
        <SuccessPopup
          title="Bam, Zeitfenster angepasst."
          message={`${updateSuccess.count} planned blocker${updateSuccess.count === 1 ? "" : "s"} updated successfully.`}
          detail="The new time window was applied to the whole group."
          onClose={() => setUpdateSuccess(undefined)}
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
