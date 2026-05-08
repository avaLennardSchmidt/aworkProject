import { addDays, eachDayOfInterval, format, getDay, isAfter, parseISO, set } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import type { AworkProject, AworkProjectTask, AworkUser, CreateTaskSchedulePayload } from "../types/awork";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";
import { formatSearchPlaceholder, SearchableSelect } from "./SearchableSelect";

export interface CreateGroupOptions {
  projectId: string;
  newTaskName?: string;
}

interface CreateScheduleGroupPanelProps {
  currentUser: AworkUser;
  projects: AworkProject[];
  tasks: AworkProjectTask[];
  isLoadingProjects: boolean;
  isLoadingTasks: boolean;
  isCreating: boolean;
  onLoadProjects: () => Promise<void>;
  onProjectChange: (projectId: string) => Promise<void>;
  onCreate: (payloads: CreateTaskSchedulePayload[], options: CreateGroupOptions) => Promise<void>;
}

type TaskMode = "existing" | "new";

const NEW_TASK_PLACEHOLDER_ID = "__new_task__";
const PROJECT_FILTER_ACTIVE = "__active_projects__";
const PROJECT_FILTER_ALL = "__all_projects__";
const TASK_FILTER_ALL = "__all_task_statuses__";

const weekdays = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

export function CreateScheduleGroupPanel({
  currentUser,
  projects,
  tasks,
  isLoadingProjects,
  isLoadingTasks,
  isCreating,
  onLoadProjects,
  onProjectChange,
  onCreate,
}: CreateScheduleGroupPanelProps) {
  const [projectId, setProjectId] = useState("");
  const [taskMode, setTaskMode] = useState<TaskMode>("existing");
  const [taskId, setTaskId] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [from, setFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(addDays(new Date(), 28), "yyyy-MM-dd"));
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [projectStatusFilter, setProjectStatusFilter] = useState(PROJECT_FILTER_ACTIVE);
  const [taskStatusFilter, setTaskStatusFilter] = useState(TASK_FILTER_ALL);
  const [error, setError] = useState("");

  useEffect(() => {
    if (projects.length === 0 && !isLoadingProjects) {
      void onLoadProjects();
    }
  }, [isLoadingProjects, onLoadProjects, projects.length]);

  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedTask = tasks.find((task) => task.id === taskId);
  const effectiveTaskId = taskMode === "existing" ? taskId : NEW_TASK_PLACEHOLDER_ID;
  const effectiveTaskName = taskMode === "existing" ? selectedTask?.name ?? "No task selected" : newTaskName.trim() || "New task";
  const projectStatusOptions = useMemo(
    () => [
      { value: PROJECT_FILTER_ACTIVE, label: "All active projects" },
      { value: PROJECT_FILTER_ALL, label: "All project statuses" },
      ...buildStatusOptions(projects),
    ],
    [projects],
  );
  const taskStatusOptions = useMemo(
    () => [
      { value: TASK_FILTER_ALL, label: "All task statuses" },
      ...buildStatusOptions(tasks),
    ],
    [tasks],
  );
  const filteredProjects = useMemo(
    () =>
      includeSelected(
        projects.filter((project) => matchesProjectStatus(project, projectStatusFilter)),
        selectedProject,
      ),
    [projectStatusFilter, projects, selectedProject],
  );
  const filteredTasks = useMemo(
    () =>
      includeSelected(
        tasks.filter((task) => matchesTaskStatus(task, taskStatusFilter)),
        selectedTask,
      ),
    [taskStatusFilter, tasks, selectedTask],
  );
  const projectOptions = useMemo(
    () => filteredProjects.map((project) => ({ value: project.id, label: formatProjectOption(project) })),
    [filteredProjects],
  );
  const taskOptions = useMemo(
    () => filteredTasks.map((task) => ({ value: task.id, label: formatTaskOption(task) })),
    [filteredTasks],
  );
  const previewPayloads = useMemo(
    () => buildPayloads({ currentUser, taskId: effectiveTaskId, from, to, weekday, startTime, endTime }),
    [currentUser, effectiveTaskId, from, to, weekday, startTime, endTime],
  );
  const totalMinutes = previewPayloads.reduce((sum, payload) => sum + payload.plannedDuration / 60, 0);

  async function handleProjectChange(nextProjectId: string) {
    setProjectId(nextProjectId);
    setTaskId("");
    setTaskStatusFilter(TASK_FILTER_ALL);
    setNewTaskName("");
    setError("");
    if (nextProjectId) {
      await onProjectChange(nextProjectId);
    }
  }

  function handleTaskModeChange(nextMode: TaskMode) {
    setTaskMode(nextMode);
    setTaskId("");
    setError("");
  }

  async function handleCreate() {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }

    await onCreate(previewPayloads, {
      projectId,
      newTaskName: taskMode === "new" ? newTaskName.trim() : undefined,
    });
  }

  function validate(): string {
    if (!projectId) return "Select a project.";
    if (taskMode === "existing" && !taskId) return "Select a task.";
    if (taskMode === "new" && !newTaskName.trim()) return "Enter a task name.";
    if (previewPayloads.length === 0) return "The selected period does not contain the selected weekday.";
    if (!isAfter(parseISO(to), parseISO(from)) && to !== from) return "To date must be after from date.";
    if (previewPayloads.some((payload) => payload.plannedDuration <= 0)) return "Start time must be before end time.";
    return "";
  }

  return (
    <section className="panel create-panel">
      <div>
        <p className="eyebrow">Create group</p>
        <h2>Create planned task blockers</h2>
        <p className="section-copy">Select a project, choose an existing task or create a new one, then plan the weekly period.</p>
      </div>

      <div className="create-grid project-selection-grid">
        <div className="form-row">
          <label>Project status</label>
          <SearchableSelect
            value={projectStatusFilter}
            disabled={isLoadingProjects}
            options={projectStatusOptions}
            placeholder="Select project status"
            searchPlaceholder={formatSearchPlaceholder("Filter statuses", projectStatusOptions.length)}
            emptyLabel="No statuses found"
            onChange={(value) => {
              setProjectStatusFilter(value);
              setProjectId("");
              setTaskId("");
              setTaskStatusFilter(TASK_FILTER_ALL);
              setNewTaskName("");
            }}
          />
        </div>

        <div className="form-row">
          <label>Project</label>
          <SearchableSelect
            value={projectId}
            disabled={isLoadingProjects}
            options={projectOptions}
            placeholder={isLoadingProjects ? "Loading projects..." : "Select project"}
            searchPlaceholder={formatSearchPlaceholder("Filter projects", projectOptions.length)}
            emptyLabel="No projects found"
            onChange={(value) => void handleProjectChange(value)}
          />
        </div>
      </div>

      <div className="create-grid task-mode-grid">
        <div className="form-row task-mode-row">
          <label>Task</label>
          <div className="task-mode-toggle" role="tablist" aria-label="Task creation mode">
            <button type="button" className={taskMode === "existing" ? "active" : ""} disabled={!projectId} onClick={() => handleTaskModeChange("existing")}>
              Existing task
            </button>
            <button type="button" className={taskMode === "new" ? "active" : ""} disabled={!projectId} onClick={() => handleTaskModeChange("new")}>
              New task
            </button>
          </div>
        </div>
      </div>

      <div className="create-grid task-details-grid">
        {taskMode === "existing" ? (
          <>
            <div className="form-row">
              <label>Task status</label>
              <SearchableSelect
                value={taskStatusFilter}
                disabled={!projectId || isLoadingTasks}
                options={taskStatusOptions}
                placeholder="Select task status"
                searchPlaceholder={formatSearchPlaceholder("Filter statuses", taskStatusOptions.length)}
                emptyLabel="No statuses found"
                onChange={(value) => {
                  setTaskStatusFilter(value);
                  setTaskId("");
                }}
              />
            </div>

            <div className="form-row">
              <label>Existing task</label>
              <SearchableSelect
                value={taskId}
                disabled={!projectId || isLoadingTasks}
                options={taskOptions}
                placeholder={isLoadingTasks ? "Loading tasks..." : "Select task"}
                searchPlaceholder={formatSearchPlaceholder("Filter tasks", taskOptions.length)}
                emptyLabel="No tasks found"
                onChange={setTaskId}
              />
            </div>
          </>
        ) : (
          <div className="form-row">
            <label htmlFor="create-new-task-name">New task name</label>
            <input
              id="create-new-task-name"
              type="text"
              value={newTaskName}
              disabled={!projectId}
              placeholder="e.g. Implementation blocker"
              onChange={(event) => setNewTaskName(event.target.value)}
            />
          </div>
        )}
      </div>

      <div className="create-grid schedule-fields-grid">
        <div className="form-row">
          <label htmlFor="create-weekday">Weekday</label>
          <select id="create-weekday" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
            {weekdays.map((day) => (
              <option key={day.value} value={day.value}>{day.label}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="create-from">From</label>
          <input id="create-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="create-to">To</label>
          <input id="create-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="create-start">Start</label>
          <input id="create-start" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="create-end">End</label>
          <input id="create-end" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="create-preview">
        <h3>Preview</h3>
        <p>
          {selectedProject?.name ?? "No project selected"} · {effectiveTaskName}
        </p>
        <p>{previewPayloads.length} blockers · {formatMinutesAsHours(totalMinutes)}</p>
        <div className="preview-list create-preview-list">
          {previewPayloads.slice(0, 12).map((payload) => (
            <div key={payload.startDate} className="preview-row">
              <span>{format(parseISO(payload.startDate), "EEEE, dd.MM.yyyy")}</span>
              <strong>{startTime}-{endTime}</strong>
            </div>
          ))}
          {previewPayloads.length > 12 ? <div className="preview-row"><span>{previewPayloads.length - 12} more blockers</span></div> : null}
        </div>
      </div>

      <button type="button" className="primary-button" disabled={isCreating} onClick={() => void handleCreate()}>
        {isCreating ? "Creating..." : taskMode === "new" ? "Create task and planned blockers" : "Create planned blockers"}
      </button>
    </section>
  );
}

function matchesProjectStatus(project: AworkProject, filter: string): boolean {
  if (filter === PROJECT_FILTER_ALL) return true;
  if (filter === PROJECT_FILTER_ACTIVE) return project.isActive !== false;
  return statusFilterValue(project) === filter;
}

function matchesTaskStatus(task: AworkProjectTask, filter: string): boolean {
  if (filter === TASK_FILTER_ALL) return true;
  return statusFilterValue(task) === filter;
}

function buildStatusOptions(items: Array<AworkProject | AworkProjectTask>): Array<{ value: string; label: string }> {
  const statuses = new Map<string, string>();
  items.forEach((item) => {
    const value = statusFilterValue(item);
    const label = item.statusName ?? item.statusType ?? item.statusId;
    if (value && label) {
      statuses.set(value, label);
    }
  });

  return Array.from(statuses.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function statusFilterValue(item: AworkProject | AworkProjectTask): string | undefined {
  const label = item.statusName ?? item.statusType ?? item.statusId;
  return label?.trim().toLocaleLowerCase();
}

function formatProjectOption(project: AworkProject): string {
  return project.statusName ? `${project.name} (${project.statusName})` : project.name;
}

function formatTaskOption(task: AworkProjectTask): string {
  const name = task.name ?? task.id;
  return task.statusName ? `${name} (${task.statusName})` : name;
}

function includeSelected<T extends { id: string }>(items: T[], selectedItem: T | undefined): T[] {
  if (!selectedItem || items.some((item) => item.id === selectedItem.id)) {
    return items;
  }
  return [selectedItem, ...items];
}

function buildPayloads({
  currentUser,
  taskId,
  from,
  to,
  weekday,
  startTime,
  endTime,
}: {
  currentUser: AworkUser;
  taskId: string;
  from: string;
  to: string;
  weekday: number;
  startTime: string;
  endTime: string;
}): CreateTaskSchedulePayload[] {
  if (!taskId || !from || !to || !startTime || !endTime) return [];

  const startDate = parseISO(from);
  const endDate = parseISO(to);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || isAfter(startDate, endDate)) return [];

  return eachDayOfInterval({ start: startDate, end: endDate })
    .filter((date) => getDay(date) === weekday)
    .map((date) => {
      const start = setTime(date, startTime);
      const end = setTime(date, endTime);
      const plannedDuration = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
      return {
        taskId,
        userId: currentUser.id,
        startDate: format(start, "yyyy-MM-dd'T'HH:mm:ssxxx"),
        endDate: format(end, "yyyy-MM-dd'T'HH:mm:ssxxx"),
        plannedDuration,
      };
    });
}

function setTime(date: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return set(date, { hours, minutes, seconds: 0, milliseconds: 0 });
}
