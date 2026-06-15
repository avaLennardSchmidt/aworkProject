import {
  addDays,
  eachDayOfInterval,
  format,
  getDay,
  isAfter,
  parseISO,
  set,
} from "date-fns";
import { de } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AworkProject,
  AworkProjectTask,
  AworkUser,
  CreateTaskSchedulePayload,
} from "../types/awork";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";
import { DatePickerInput } from "./DatePickerInput";
import { formatSearchPlaceholder, SearchableSelect } from "./SearchableSelect";
import { SegmentedControl } from "./SegmentedControl";

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
  myAssignedTaskIds: Set<string>;
  myAssignedProjectIds: Set<string>;
  workflowToggle?: ReactNode;
  onLoadProjects: () => Promise<void>;
  onProjectChange: (projectId: string) => Promise<void>;
  onCreate: (
    payloads: CreateTaskSchedulePayload[],
    options: CreateGroupOptions,
  ) => Promise<boolean>;
}

type TaskMode = "existing" | "new";

const NEW_TASK_PLACEHOLDER_ID = "__new_task__";
const PROJECT_FILTER_ACTIVE = "__active_projects__";
const PROJECT_FILTER_ALL = "__all_projects__";
const TASK_FILTER_ALL = "__all_task_statuses__";

const taskModeOptions = [
  {
    value: "existing" as const,
    label: "Bestehend",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 3.5h10M2 7h8M2 10.5h5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    value: "new" as const,
    label: "Neu anlegen",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M7 2v10M2 7h10"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

const weekdays = [
  { value: 1, label: "Montag" },
  { value: 2, label: "Dienstag" },
  { value: 3, label: "Mittwoch" },
  { value: 4, label: "Donnerstag" },
  { value: 5, label: "Freitag" },
  { value: 6, label: "Samstag" },
  { value: 0, label: "Sonntag" },
];

function getDefaultScheduleFields() {
  const today = new Date();
  return {
    from: format(today, "yyyy-MM-dd"),
    to: format(addDays(today, 28), "yyyy-MM-dd"),
    weekday: 1,
    startTime: "09:00",
    endTime: "10:00",
  };
}

export function CreateScheduleGroupPanel({
  currentUser,
  projects,
  tasks,
  isLoadingProjects,
  isLoadingTasks,
  isCreating,
  myAssignedTaskIds,
  myAssignedProjectIds,
  workflowToggle,
  onLoadProjects,
  onProjectChange,
  onCreate,
}: CreateScheduleGroupPanelProps) {
  const defaults = getDefaultScheduleFields();
  const [projectId, setProjectId] = useState("");
  const [taskMode, setTaskMode] = useState<TaskMode>("existing");
  const [taskId, setTaskId] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [weekday, setWeekday] = useState(defaults.weekday);
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [endTime, setEndTime] = useState(defaults.endTime);
  const [projectStatusFilter, setProjectStatusFilter] = useState(
    PROJECT_FILTER_ACTIVE,
  );
  const [taskStatusFilter, setTaskStatusFilter] = useState(TASK_FILTER_ALL);
  const [onlyMyProjects, setOnlyMyProjects] = useState(false);
  const [onlyMyAssignedTasks, setOnlyMyAssignedTasks] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (projects.length === 0 && !isLoadingProjects) {
      void onLoadProjects();
    }
  }, [isLoadingProjects, onLoadProjects, projects.length]);

  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedTask = tasks.find((task) => task.id === taskId);
  const effectiveTaskId =
    taskMode === "existing" ? taskId : NEW_TASK_PLACEHOLDER_ID;
  const effectiveTaskName =
    taskMode === "existing"
      ? (selectedTask?.name ?? "Keine Aufgabe ausgewählt")
      : newTaskName.trim() || "Neue Aufgabe";
  const projectStatusOptions = useMemo(
    () => [
      { value: PROJECT_FILTER_ACTIVE, label: "Alle aktiven Projekte" },
      { value: PROJECT_FILTER_ALL, label: "Alle Projektstatus" },
      ...buildStatusOptions(projects),
    ],
    [projects],
  );
  const taskStatusOptions = useMemo(
    () => [
      { value: TASK_FILTER_ALL, label: "Alle Aufgabenstatus" },
      ...buildStatusOptions(tasks),
    ],
    [tasks],
  );
  const filteredProjects = useMemo(
    () =>
      includeSelected(
        projects.filter(
          (project) =>
            matchesProjectStatus(project, projectStatusFilter) &&
            (!onlyMyProjects || myAssignedProjectIds.has(project.id)),
        ),
        selectedProject,
      ),
    [
      projectStatusFilter,
      projects,
      selectedProject,
      onlyMyProjects,
      myAssignedProjectIds,
    ],
  );
  const filteredTasks = useMemo(
    () =>
      includeSelected(
        tasks.filter(
          (task) =>
            matchesTaskStatus(task, taskStatusFilter) &&
            (!onlyMyAssignedTasks || myAssignedTaskIds.has(task.id)),
        ),
        selectedTask,
      ),
    [
      taskStatusFilter,
      tasks,
      selectedTask,
      onlyMyAssignedTasks,
      myAssignedTaskIds,
    ],
  );
  const projectOptions = useMemo(
    () =>
      filteredProjects.map((project) => ({
        value: project.id,
        label: formatProjectOption(project),
      })),
    [filteredProjects],
  );
  const taskOptions = useMemo(
    () =>
      filteredTasks.map((task) => ({
        value: task.id,
        label: formatTaskOption(task),
      })),
    [filteredTasks],
  );
  const previewPayloads = useMemo(
    () =>
      buildPayloads({
        currentUser,
        taskId: effectiveTaskId,
        from,
        to,
        weekday,
        startTime,
        endTime,
      }),
    [currentUser, effectiveTaskId, from, to, weekday, startTime, endTime],
  );
  const totalMinutes = previewPayloads.reduce(
    (sum, payload) => sum + payload.plannedDuration / 60,
    0,
  );

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

  function handleOnlyMyProjectsChange(checked: boolean) {
    setOnlyMyProjects(checked);
    setProjectId("");
    setTaskId("");
    setTaskStatusFilter(TASK_FILTER_ALL);
    setNewTaskName("");
    setError("");
  }

  function handleOnlyMyAssignedTasksChange(checked: boolean) {
    setOnlyMyAssignedTasks(checked);
    setTaskId("");
    setError("");
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

    const created = await onCreate(previewPayloads, {
      projectId,
      newTaskName: taskMode === "new" ? newTaskName.trim() : undefined,
    });

    if (created) {
      const nextDefaults = getDefaultScheduleFields();
      setFrom(nextDefaults.from);
      setTo(nextDefaults.to);
      setWeekday(nextDefaults.weekday);
      setStartTime(nextDefaults.startTime);
      setEndTime(nextDefaults.endTime);
      setError("");
    }
  }

  function validate(): string {
    if (!projectId) return "Bitte Projekt auswählen.";
    if (taskMode === "existing" && !taskId) return "Bitte Aufgabe auswählen.";
    if (taskMode === "new" && !newTaskName.trim())
      return "Bitte Aufgabenname eingeben.";
    if (previewPayloads.length === 0)
      return "Der ausgewählte Zeitraum enthält den Wochentag nicht.";
    if (!isAfter(parseISO(to), parseISO(from)) && to !== from)
      return "Das Bis-Datum muss nach dem Von-Datum liegen.";
    if (previewPayloads.some((payload) => payload.plannedDuration <= 0))
      return "Die Startzeit muss vor der Endzeit liegen.";
    return "";
  }

  return (
    <form
      className="panel create-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void handleCreate();
      }}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">Workflow</p>
          <h2>Blocker anlegen</h2>
        </div>
        {workflowToggle}
      </div>

      <div className="create-grid project-selection-grid">
        <div className="form-row">
          <label htmlFor="create-project-status">Projektstatus</label>
          <SearchableSelect
            buttonId="create-project-status"
            value={projectStatusFilter}
            disabled={isLoadingProjects}
            options={projectStatusOptions}
            placeholder="Projektstatus auswählen"
            searchPlaceholder={formatSearchPlaceholder(
              "Status filtern",
              projectStatusOptions.length,
            )}
            emptyLabel="Keine Status gefunden"
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
          <label htmlFor="create-project">Projekt</label>
          <SearchableSelect
            buttonId="create-project"
            value={projectId}
            disabled={isLoadingProjects}
            options={projectOptions}
            placeholder={
              isLoadingProjects
                ? "Projekte werden geladen..."
                : "Projekt auswählen"
            }
            searchPlaceholder={formatSearchPlaceholder(
              "Projekte filtern",
              projectOptions.length,
            )}
            emptyLabel="Keine Projekte gefunden"
            onChange={(value) => void handleProjectChange(value)}
          />
        </div>
        <div className="form-row form-row-col2">
          <label htmlFor="create-only-my-projects" className="checkbox-row">
            <input
              id="create-only-my-projects"
              type="checkbox"
              checked={onlyMyProjects}
              disabled={myAssignedProjectIds.size === 0}
              onChange={(event) =>
                handleOnlyMyProjectsChange(event.target.checked)
              }
            />
            <span>Nur mir zugewiesene Projekte</span>
          </label>
        </div>
      </div>

      <div className="create-grid task-mode-grid">
        <div className="form-row task-mode-row">
          <label>Aufgabe</label>
          <SegmentedControl
            value={taskMode}
            options={taskModeOptions}
            ariaLabel="Aufgabenmodus"
            disabled={!projectId}
            onChange={handleTaskModeChange}
          />
        </div>
      </div>

      <div className="create-grid task-details-grid">
        {taskMode === "existing" ? (
          <>
            <div className="form-row">
              <label htmlFor="create-task-status">Aufgabenstatus</label>
              <SearchableSelect
                buttonId="create-task-status"
                value={taskStatusFilter}
                disabled={!projectId || isLoadingTasks}
                options={taskStatusOptions}
                placeholder="Aufgabenstatus auswählen"
                searchPlaceholder={formatSearchPlaceholder(
                  "Status filtern",
                  taskStatusOptions.length,
                )}
                emptyLabel="Keine Status gefunden"
                onChange={(value) => {
                  setTaskStatusFilter(value);
                  setTaskId("");
                }}
              />
            </div>

            <div className="form-row">
              <label htmlFor="create-task">Aufgabe</label>
              <SearchableSelect
                buttonId="create-task"
                value={taskId}
                disabled={!projectId || isLoadingTasks}
                options={taskOptions}
                placeholder={
                  isLoadingTasks
                    ? "Aufgaben werden geladen..."
                    : "Aufgabe auswählen"
                }
                searchPlaceholder={formatSearchPlaceholder(
                  "Aufgaben filtern",
                  taskOptions.length,
                )}
                emptyLabel="Keine Aufgaben gefunden"
                onChange={setTaskId}
              />
            </div>
            <div className="form-row form-row-col2">
              <label
                htmlFor="create-only-my-assigned-tasks"
                className="checkbox-row"
              >
                <input
                  id="create-only-my-assigned-tasks"
                  type="checkbox"
                  checked={onlyMyAssignedTasks}
                  disabled={myAssignedTaskIds.size === 0 || !projectId}
                  onChange={(event) =>
                    handleOnlyMyAssignedTasksChange(event.target.checked)
                  }
                />
                <span>Nur mir zugewiesene Aufgaben</span>
              </label>
            </div>
          </>
        ) : (
          <div className="form-row">
            <label htmlFor="create-new-task-name">Neuer Aufgabenname</label>
            <input
              id="create-new-task-name"
              type="text"
              value={newTaskName}
              disabled={!projectId}
              placeholder="z.B. Implementierungs-Blocker"
              onChange={(event) => setNewTaskName(event.target.value)}
            />
          </div>
        )}
      </div>

      <div className="create-grid schedule-fields-grid">
        <div className="form-row">
          <label htmlFor="create-weekday">Wochentag</label>
          <SearchableSelect
            buttonId="create-weekday"
            value={String(weekday)}
            options={weekdays.map((day) => ({
              value: String(day.value),
              label: day.label,
            }))}
            placeholder="Wochentag auswählen"
            searchPlaceholder="Wochentage filtern (7 gefunden)"
            emptyLabel="Kein Wochentag gefunden."
            menuWidth="compact"
            onChange={(value) => setWeekday(Number(value))}
          />
        </div>
        <div className="form-row">
          <label htmlFor="create-from">Von</label>
          <DatePickerInput id="create-from" value={from} onChange={setFrom} />
        </div>
        <div className="form-row">
          <label htmlFor="create-to">Bis</label>
          <DatePickerInput id="create-to" value={to} onChange={setTo} />
        </div>
        <div className="form-row">
          <label htmlFor="create-start">Start</label>
          <input
            id="create-start"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </div>
        <div className="form-row">
          <label htmlFor="create-end">Ende</label>
          <input
            id="create-end"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="create-preview">
        <h3>Vorschau</h3>
        <p>
          {selectedProject?.name ?? "Kein Projekt ausgewählt"} ·{" "}
          {effectiveTaskName}
        </p>
        <p>
          {previewPayloads.length} Blocker ·{" "}
          {formatMinutesAsHours(totalMinutes)}
        </p>
        <div className="preview-list create-preview-list">
          {previewPayloads.slice(0, 12).map((payload) => (
            <div key={payload.startDate} className="preview-row">
              <span>
                {format(parseISO(payload.startDate), "EEEE, dd.MM.yyyy", {
                  locale: de,
                })}
              </span>
              <strong>
                {startTime}-{endTime}
              </strong>
            </div>
          ))}
          {previewPayloads.length > 12 ? (
            <div className="preview-row">
              <span>{previewPayloads.length - 12} weitere Blocker</span>
            </div>
          ) : null}
        </div>
      </div>

      <button type="submit" className="primary-button" disabled={isCreating}>
        {isCreating ? (
          <>
            <span className="button-spinner" aria-hidden="true" />
            Wird angelegt...
          </>
        ) : taskMode === "new" ? (
          "Aufgabe und Blocker anlegen"
        ) : (
          "Blocker anlegen"
        )}
      </button>
    </form>
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

function buildStatusOptions(
  items: Array<AworkProject | AworkProjectTask>,
): Array<{ value: string; label: string }> {
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

function statusFilterValue(
  item: AworkProject | AworkProjectTask,
): string | undefined {
  const label = item.statusName ?? item.statusType ?? item.statusId;
  return label?.trim().toLocaleLowerCase();
}

function formatProjectOption(project: AworkProject): string {
  return project.statusName
    ? `${project.name} (${project.statusName})`
    : project.name;
}

function formatTaskOption(task: AworkProjectTask): string {
  const name = task.name ?? task.id;
  return task.statusName ? `${name} (${task.statusName})` : name;
}

function includeSelected<T extends { id: string }>(
  items: T[],
  selectedItem: T | undefined,
): T[] {
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
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    isAfter(startDate, endDate)
  )
    return [];

  return eachDayOfInterval({ start: startDate, end: endDate })
    .filter((date) => getDay(date) === weekday)
    .map((date) => {
      const start = setTime(date, startTime);
      const end = setTime(date, endTime);
      const plannedDuration = Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 1000),
      );
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
