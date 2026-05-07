import { addDays, eachDayOfInterval, format, getDay, isAfter, parseISO, set } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import type { AworkProject, AworkProjectTask, AworkUser, CreateTaskSchedulePayload } from "../types/awork";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";

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
  const [projectQuery, setProjectQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
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
  const filteredProjects = useMemo(
    () => includeSelected(projects.filter((project) => matchesQuery(project.name, projectQuery)), selectedProject),
    [projectQuery, projects, selectedProject],
  );
  const filteredTasks = useMemo(
    () => includeSelected(tasks.filter((task) => matchesQuery(task.name ?? task.id, taskQuery)), selectedTask),
    [taskQuery, tasks, selectedTask],
  );
  const previewPayloads = useMemo(
    () => buildPayloads({ currentUser, taskId: effectiveTaskId, from, to, weekday, startTime, endTime }),
    [currentUser, effectiveTaskId, from, to, weekday, startTime, endTime],
  );
  const totalMinutes = previewPayloads.reduce((sum, payload) => sum + payload.plannedDuration / 60, 0);

  async function handleProjectChange(nextProjectId: string) {
    setProjectId(nextProjectId);
    setTaskId("");
    setTaskQuery("");
    setNewTaskName("");
    setError("");
    if (nextProjectId) {
      await onProjectChange(nextProjectId);
    }
  }

  function handleTaskModeChange(nextMode: TaskMode) {
    setTaskMode(nextMode);
    setTaskId("");
    setTaskQuery("");
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

      <div className="create-grid">
        <div className="form-row filterable-select-row">
          <label htmlFor="create-project-search">Project</label>
          <input
            id="create-project-search"
            type="search"
            value={projectQuery}
            disabled={isLoadingProjects}
            placeholder="Filter projects"
            onChange={(event) => setProjectQuery(event.target.value)}
          />
          <select id="create-project" value={projectId} disabled={isLoadingProjects} onChange={(event) => void handleProjectChange(event.target.value)}>
            <option value="">{isLoadingProjects ? "Loading projects..." : "Select project"}</option>
            {filteredProjects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
            {!isLoadingProjects && filteredProjects.length === 0 ? <option disabled>No projects found</option> : null}
          </select>
        </div>

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

        {taskMode === "existing" ? (
          <div className="form-row filterable-select-row">
            <label htmlFor="create-task-search">Existing task</label>
            <input
              id="create-task-search"
              type="search"
              value={taskQuery}
              disabled={!projectId || isLoadingTasks}
              placeholder="Filter tasks"
              onChange={(event) => setTaskQuery(event.target.value)}
            />
            <select id="create-task" value={taskId} disabled={!projectId || isLoadingTasks} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">{isLoadingTasks ? "Loading tasks..." : "Select task"}</option>
              {filteredTasks.map((task) => (
                <option key={task.id} value={task.id}>{task.name ?? task.id}</option>
              ))}
              {!isLoadingTasks && projectId && filteredTasks.length === 0 ? <option disabled>No tasks found</option> : null}
            </select>
          </div>
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
            <p className="field-hint">This creates a real awork task in the selected project before planning it.</p>
          </div>
        )}

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

function matchesQuery(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
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
