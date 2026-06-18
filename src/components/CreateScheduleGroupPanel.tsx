import {
  addDays,
  eachDayOfInterval,
  format,
  getDay,
  isAfter,
  isValid,
  parseISO,
  set,
  startOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AworkProject,
  AworkProjectTask,
  AworkTaskSchedule,
  AworkUserCapacity,
  AworkUser,
  CreateTaskSchedulePayload,
} from "../types/awork";
import {
  buildAutoPlan,
  findPayloadOverlaps,
  formatPayloadTimeWindow,
  MIN_AUTO_PLAN_BLOCKER_MINUTES,
  type AutoPlanDay,
  type AutoPlanResult,
  type AutoPlanWeek,
  type PayloadOverlap,
} from "../services/autoPlanScheduler";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";
import { DatePickerInput } from "./DatePickerInput";
import {
  formatSearchPlaceholder,
  MultiSearchableSelect,
  SearchableSelect,
  type SelectOption,
} from "./SearchableSelect";
import { SegmentedControl } from "./SegmentedControl";
import { StatusIcon } from "./StatusIcon";
import { ModalShell } from "./ModalShell";
import { StatusToast } from "./StatusToast";

export interface CreateGroupOptions {
  projectId: string;
  newTaskName?: string;
}

/** ISO-week (Monday) key for a payload, matching how buildAutoPlan groups weeks. */
function payloadWeekKey(payload: CreateTaskSchedulePayload): string {
  return format(
    startOfWeek(parseISO(payload.startDate), { weekStartsOn: 1 }),
    "yyyy-MM-dd",
  );
}

/**
 * Merge per-week manual edits into the algorithm's payloads: any week present
 * in `overrides` replaces that week's auto-planned blockers wholesale, all
 * other weeks pass through untouched. Returns a chronologically sorted list.
 */
function combineWeekOverrides(
  payloads: CreateTaskSchedulePayload[],
  overrides: Map<string, CreateTaskSchedulePayload[]>,
): CreateTaskSchedulePayload[] {
  if (overrides.size === 0) return payloads;
  const byWeek = new Map<string, CreateTaskSchedulePayload[]>();
  for (const payload of payloads) {
    const key = payloadWeekKey(payload);
    byWeek.set(key, [...(byWeek.get(key) ?? []), payload]);
  }
  for (const [key, override] of overrides) {
    byWeek.set(key, override);
  }
  return [...byWeek.values()]
    .flat()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

interface AbsenceRange {
  startOn: string;
  endOn: string;
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
  absenceRanges?: AbsenceRange[];
  workflowToggle?: ReactNode;
  pulseAutoPlan?: boolean;
  onOpenAutoPlan?: () => void;
  onLoadProjects: () => Promise<void>;
  onProjectChange: (projectId: string) => Promise<void>;
  onLoadExistingSchedules: (
    from: string,
    to: string,
  ) => Promise<AworkTaskSchedule[]>;
  onLoadUserCapacity: () => Promise<AworkUserCapacity | undefined>;
  onCreate: (
    payloads: CreateTaskSchedulePayload[],
    options: CreateGroupOptions,
  ) => Promise<boolean>;
}

type TaskMode = "existing" | "new" | "auto";
type AutoTaskSource = "new" | "existing";

interface CreatePreviewSnapshot {
  payloads: CreateTaskSchedulePayload[];
  options: CreateGroupOptions;
  projectName?: string;
  taskName: string;
  userName: string;
  totalMinutes: number;
  overlaps: PayloadOverlap[];
  autoPlanResult?: AutoPlanResult;
  actionLabel: string;
}

const NEW_TASK_PLACEHOLDER_ID = "__new_task__";
const PROJECT_FILTER_ACTIVE = "__active_projects__";
const PROJECT_FILTER_ALL = "__all_projects__";
const PROJECT_TYPE_FILTER_ALL = "__all_project_types__";
const TASK_FILTER_ALL = "__all_task_statuses__";

const STATUS_TYPE_LABELS: Record<string, string> = {
  closed: "Abgeschlossen",
  "not-started": "Nicht begonnen",
  progress: "In Bearbeitung",
  stuck: "Blockiert",
  done: "Fertig",
};

const baseTaskModeOptions = [
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
  {
    value: "auto" as const,
    label: "Auto Plan",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 7h8M7 3v8M4.5 2.5l-1 1M10.5 2.5l1 1M4.5 11.5l-1-1M10.5 11.5l1-1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

const autoTaskSourceOptions = [
  { value: "new" as const, label: "Neue Aufgabe" },
  { value: "existing" as const, label: "Bestehende Aufgabe" },
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
    weekdays: ["1", "2", "3", "4", "5"],
    startTime: "09:00",
    endTime: "10:00",
    autoStartTime: "09:00",
    autoEndTime: "17:00",
    autoPlanHours: "5",
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
  absenceRanges,
  workflowToggle,
  pulseAutoPlan,
  onOpenAutoPlan,
  onLoadProjects,
  onProjectChange,
  onLoadExistingSchedules,
  onLoadUserCapacity,
  onCreate,
}: CreateScheduleGroupPanelProps) {
  const defaults = getDefaultScheduleFields();
  const taskModeOptions = useMemo(
    () =>
      baseTaskModeOptions.map((option) => ({
        ...option,
        className:
          pulseAutoPlan && option.value === "auto"
            ? "workflow-option-pulse"
            : undefined,
        badgeText:
          pulseAutoPlan && option.value === "auto" ? "NEU" : undefined,
      })),
    [pulseAutoPlan],
  );
  const [projectId, setProjectId] = useState("");
  const [taskMode, setTaskMode] = useState<TaskMode>("existing");
  const [autoTaskSource, setAutoTaskSource] = useState<AutoTaskSource>("new");
  const [taskId, setTaskId] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [weekday, setWeekday] = useState(defaults.weekday);
  const [selectedAutoWeekdays, setSelectedAutoWeekdays] = useState(
    defaults.weekdays,
  );
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [endTime, setEndTime] = useState(defaults.endTime);
  const [projectTypeFilter, setProjectTypeFilter] = useState(
    PROJECT_TYPE_FILTER_ALL,
  );
  const [autoPlanHours, setAutoPlanHours] = useState(defaults.autoPlanHours);
  const [existingSchedules, setExistingSchedules] = useState<
    AworkTaskSchedule[]
  >([]);
  const [userCapacity, setUserCapacity] = useState<AworkUserCapacity>();
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isPreparingPreview, setIsPreparingPreview] = useState(false);
  const [createPreview, setCreatePreview] =
    useState<CreatePreviewSnapshot | null>(null);
  const [isAutoPlanInfoOpen, setIsAutoPlanInfoOpen] = useState(false);
  // Per-week manual edits to the Auto Plan suggestion, keyed by ISO-week start.
  const [weekOverrides, setWeekOverrides] = useState<
    Map<string, CreateTaskSchedulePayload[]>
  >(new Map());
  const [editingWeek, setEditingWeek] = useState<AutoPlanWeek | null>(null);
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

  useEffect(() => {
    void refreshPreviewContext();
  }, [currentUser.id, from, to]);

  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedTask = tasks.find((task) => task.id === taskId);
  const effectiveTaskId =
    taskMode === "existing" ||
    (taskMode === "auto" && autoTaskSource === "existing")
      ? taskId
      : NEW_TASK_PLACEHOLDER_ID;
  const effectiveTaskName =
    taskMode === "existing" ||
    (taskMode === "auto" && autoTaskSource === "existing")
      ? (selectedTask?.name ?? "Keine Aufgabe ausgewählt")
      : newTaskName.trim() || "Neue Aufgabe";
  const projectTypeOptions = useMemo(
    () => [
      { value: PROJECT_TYPE_FILTER_ALL, label: "Alle Statustypen" },
      ...buildTypeOptions(projects),
    ],
    [projects],
  );
  const projectStatusOptions = useMemo(
    () => [
      { value: PROJECT_FILTER_ACTIVE, label: "Alle aktiven Projekte" },
      { value: PROJECT_FILTER_ALL, label: "Alle Projektstatus" },
      ...buildStatusOptions(projects, projectTypeFilter),
    ],
    [projects, projectTypeFilter],
  );
  const taskStatusOptions = useMemo(
    () => [
      { value: TASK_FILTER_ALL, label: "Alle Aufgabenstatus" },
      ...buildTaskStatusOptions(tasks),
    ],
    [tasks],
  );
  const filteredProjects = useMemo(
    () =>
      includeSelected(
        projects.filter(
          (project) =>
            matchesProjectStatus(project, projectStatusFilter) &&
            (projectTypeFilter === PROJECT_TYPE_FILTER_ALL ||
              project.statusType === projectTypeFilter) &&
            (!onlyMyProjects || myAssignedProjectIds.has(project.id)),
        ),
        selectedProject,
      ),
    [
      projectStatusFilter,
      projectTypeFilter,
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
        icon: (
          <StatusIcon
            icon={task.statusIcon}
            type={task.statusType}
            title={task.statusName ? `Status: ${task.statusName}` : undefined}
          />
        ),
      })),
    [filteredTasks],
  );
  const autoRequestedMinutes = readHoursToMinutes(autoPlanHours);
  const autoPlanResult = useMemo(
    () =>
      buildAutoPlan({
        currentUser,
        taskId: effectiveTaskId,
        from,
        to,
        weekdayValues: selectedAutoWeekdays.map(Number),
        startTime,
        endTime,
        requestedMinutes: autoRequestedMinutes,
        existingSchedules,
        userCapacity,
      }),
    [
      autoRequestedMinutes,
      currentUser,
      effectiveTaskId,
      existingSchedules,
      from,
      to,
      selectedAutoWeekdays,
      startTime,
      endTime,
      userCapacity,
    ],
  );
  // Auto Plan payloads after applying any per-week manual edits.
  const effectiveAutoPayloads = useMemo(
    () => combineWeekOverrides(autoPlanResult.payloads, weekOverrides),
    [autoPlanResult.payloads, weekOverrides],
  );

  // Manual week edits are tied to a specific suggestion. When the inputs that
  // define the plan change, the suggestion is recomputed, so drop stale edits.
  useEffect(() => {
    setWeekOverrides((current) => (current.size === 0 ? current : new Map()));
  }, [
    autoRequestedMinutes,
    effectiveTaskId,
    from,
    to,
    selectedAutoWeekdays,
    startTime,
    endTime,
  ]);

  const previewPayloads = useMemo(() => {
    if (taskMode === "auto") {
      return effectiveAutoPayloads;
    }

    return buildPayloads({
      currentUser,
      taskId: effectiveTaskId,
      from,
      to,
      weekday,
      startTime,
      endTime,
    });
  }, [
    effectiveAutoPayloads,
    currentUser,
    effectiveTaskId,
    from,
    to,
    weekday,
    startTime,
    endTime,
    taskMode,
  ]);
  const totalMinutes = previewPayloads.reduce(
    (sum, payload) => sum + payload.plannedDuration / 60,
    0,
  );
  const overlapEntries = useMemo(
    () => findPayloadOverlaps(previewPayloads, existingSchedules),
    [existingSchedules, previewPayloads],
  );
  const overlapDateCount = new Set(
    overlapEntries.map((entry) =>
      format(parseISO(entry.payload.startDate), "yyyy-MM-dd"),
    ),
  ).size;

  async function refreshPreviewContext() {
    if (!from || !to) {
      setExistingSchedules([]);
      return {
        schedules: [] as AworkTaskSchedule[],
        capacity: undefined as AworkUserCapacity | undefined,
      };
    }

    setIsLoadingContext(true);
    try {
      const [schedules, capacity] = await Promise.all([
        onLoadExistingSchedules(from, to),
        onLoadUserCapacity(),
      ]);
      setExistingSchedules(schedules);
      setUserCapacity(capacity);
      return { schedules, capacity };
    } catch {
      setExistingSchedules([]);
      setUserCapacity(undefined);
      return {
        schedules: [] as AworkTaskSchedule[],
        capacity: undefined as AworkUserCapacity | undefined,
      };
    } finally {
      setIsLoadingContext(false);
    }
  }

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
    if (nextMode === "auto") {
      onOpenAutoPlan?.();
    }
    setTaskMode(nextMode);
    setTaskId("");
    setCreatePreview(null);
    setError("");
    if (nextMode === "auto") {
      setStartTime(defaults.autoStartTime);
      setEndTime(defaults.autoEndTime);
    } else {
      setStartTime(defaults.startTime);
      setEndTime(defaults.endTime);
    }
  }

  async function handlePreviewRequest() {
    if (isPreparingPreview || isCreating) return;

    setIsPreparingPreview(true);
    setCreatePreview(null);
    try {
      const context = await refreshPreviewContext();
      const nextAutoPlanResult =
        taskMode === "auto"
          ? buildAutoPlan({
              currentUser,
              taskId: effectiveTaskId,
              from,
              to,
              weekdayValues: selectedAutoWeekdays.map(Number),
              startTime,
              endTime,
              requestedMinutes: autoRequestedMinutes,
              existingSchedules: context.schedules,
              userCapacity: context.capacity,
            })
          : undefined;
      const nextPreviewPayloads = nextAutoPlanResult
        ? combineWeekOverrides(nextAutoPlanResult.payloads, weekOverrides)
        : buildPayloads({
            currentUser,
            taskId: effectiveTaskId,
            from,
            to,
            weekday,
            startTime,
            endTime,
          });
      // Reconcile the summary with manual edits so the confirm step does not
      // show a stale "X offen" warning after gaps were filled by hand.
      const reconciledAutoPlanResult =
        nextAutoPlanResult && weekOverrides.size > 0
          ? (() => {
              const planned = Math.round(
                nextPreviewPayloads.reduce(
                  (sum, p) => sum + p.plannedDuration,
                  0,
                ) / 60,
              );
              return {
                ...nextAutoPlanResult,
                payloads: nextPreviewPayloads,
                plannedMinutes: planned,
                remainingMinutes: Math.max(
                  0,
                  nextAutoPlanResult.requestedMinutes - planned,
                ),
              };
            })()
          : nextAutoPlanResult;
      const validation = validate(nextPreviewPayloads);
      if (validation) {
        setError(validation);
        return;
      }

      setError("");
      setCreatePreview({
        payloads: nextPreviewPayloads,
        options: {
          projectId,
          newTaskName:
            taskMode === "new" ||
            (taskMode === "auto" && autoTaskSource === "new")
              ? newTaskName.trim()
              : undefined,
        },
        projectName: selectedProject?.name,
        taskName: effectiveTaskName,
        userName: formatUserName(currentUser),
        totalMinutes: nextPreviewPayloads.reduce(
          (sum, payload) => sum + payload.plannedDuration / 60,
          0,
        ),
        overlaps:
          taskMode === "auto"
            ? []
            : findPayloadOverlaps(nextPreviewPayloads, context.schedules),
        autoPlanResult: reconciledAutoPlanResult,
        actionLabel: getCreateActionLabel(taskMode, autoTaskSource),
      });
    } finally {
      setIsPreparingPreview(false);
    }
  }

  async function handleConfirmCreate() {
    if (!createPreview) return;

    const created = await onCreate(
      createPreview.payloads,
      createPreview.options,
    );

    if (created) {
      resetScheduleFields();
      setCreatePreview(null);
    }
  }

  function resetScheduleFields() {
    const nextDefaults = getDefaultScheduleFields();
    setFrom(nextDefaults.from);
    setTo(nextDefaults.to);
    setWeekday(nextDefaults.weekday);
    setSelectedAutoWeekdays(nextDefaults.weekdays);
    setStartTime(nextDefaults.startTime);
    setEndTime(nextDefaults.endTime);
    setAutoPlanHours(nextDefaults.autoPlanHours);
    setWeekOverrides(new Map());
    setError("");
  }

  function saveWeekOverride(
    week: AutoPlanWeek,
    payloads: CreateTaskSchedulePayload[],
  ) {
    const key = format(week.weekStart, "yyyy-MM-dd");
    setWeekOverrides((current) => {
      const next = new Map(current);
      next.set(key, payloads);
      return next;
    });
    setEditingWeek(null);
  }

  function validate(payloads = previewPayloads): string {
    if (!projectId) return "Bitte Projekt auswählen.";
    if (taskMode === "existing" && !taskId) return "Bitte Aufgabe auswählen.";
    if (taskMode === "auto" && autoTaskSource === "existing" && !taskId)
      return "Bitte Aufgabe für Auto Plan auswählen.";
    if (
      (taskMode === "new" ||
        (taskMode === "auto" && autoTaskSource === "new")) &&
      !newTaskName.trim()
    )
      return "Bitte Aufgabenname eingeben.";
    if (taskMode === "auto" && selectedAutoWeekdays.length === 0)
      return "Bitte mindestens einen Wochentag auswählen.";
    if (taskMode === "auto" && autoRequestedMinutes <= 0)
      return "Bitte gültige Stunden für Auto Plan eingeben.";
    if (
      taskMode === "auto" &&
      autoRequestedMinutes < MIN_AUTO_PLAN_BLOCKER_MINUTES
    )
      return "Auto Plan braucht mindestens 30 Minuten.";
    if (taskMode === "auto" && payloads.length === 0)
      return "Auto Plan findet in diesem Zeitraum keinen freien Slot ab 30 Minuten.";
    if (payloads.length === 0)
      return "Der ausgewählte Zeitraum enthält den Wochentag nicht.";
    if (!isAfter(parseISO(to), parseISO(from)) && to !== from)
      return "Das Bis-Datum muss nach dem Von-Datum liegen.";
    if (payloads.some((payload) => payload.plannedDuration <= 0))
      return "Die Startzeit muss vor der Endzeit liegen.";
    return "";
  }

  return (
    <>
      <form
        className="panel create-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void handlePreviewRequest();
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
            <label htmlFor="create-project-type">Statustyp</label>
            <SearchableSelect
              buttonId="create-project-type"
              value={projectTypeFilter}
              disabled={isLoadingProjects}
              options={projectTypeOptions}
              placeholder="Statustyp auswählen"
              searchPlaceholder={formatSearchPlaceholder(
                "Typ filtern",
                projectTypeOptions.length,
              )}
              emptyLabel="Keine Typen gefunden"
              onChange={(value) => {
                setProjectTypeFilter(value);
                setProjectStatusFilter(PROJECT_FILTER_ACTIVE);
                setProjectId("");
                setTaskId("");
                setTaskStatusFilter(TASK_FILTER_ALL);
                setNewTaskName("");
              }}
            />
          </div>
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
          <div className="form-row project-toggle-row">
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
          ) : taskMode === "auto" ? (
            <>
              <div className="form-row task-mode-row form-row-full auto-task-source-row">
                <label>Auto-Plan Aufgabe</label>
                <SegmentedControl
                  value={autoTaskSource}
                  options={autoTaskSourceOptions}
                  ariaLabel="Auto-Plan Aufgabe"
                  disabled={!projectId}
                  onChange={(value) => {
                    setAutoTaskSource(value);
                    setTaskId("");
                    setNewTaskName("");
                    setError("");
                  }}
                />
              </div>
              <div className="form-row form-row-full auto-plan-info-inline-row">
                <button
                  type="button"
                  className="auto-plan-info-link"
                  onClick={() => setIsAutoPlanInfoOpen(true)}
                >
                  <span className="auto-plan-info-link-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle
                        cx="7"
                        cy="7"
                        r="5.25"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M7 6.1v3M7 4.45h.01"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <span>Was ist Auto Plan?</span>
                </button>
              </div>
              {autoTaskSource === "existing" ? (
                <>
                  <div className="form-row">
                    <label htmlFor="create-auto-task-status">
                      Aufgabenstatus
                    </label>
                    <SearchableSelect
                      buttonId="create-auto-task-status"
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
                    <label htmlFor="create-auto-task">Aufgabe</label>
                    <SearchableSelect
                      buttonId="create-auto-task"
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
                      htmlFor="create-auto-only-my-assigned-tasks"
                      className="checkbox-row"
                    >
                      <input
                        id="create-auto-only-my-assigned-tasks"
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
                <div className="form-row form-row-full">
                  <label htmlFor="create-auto-new-task-name">
                    Neuer Aufgabenname
                  </label>
                  <input
                    id="create-auto-new-task-name"
                    type="text"
                    value={newTaskName}
                    disabled={!projectId}
                    placeholder="z.B. Implementierungs-Blocker"
                    onChange={(event) => setNewTaskName(event.target.value)}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="form-row form-row-full">
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
          {taskMode === "auto" ? (
            <>
              <div className="form-row">
                <label htmlFor="create-auto-weekdays">Wochentage</label>
                <MultiSearchableSelect
                  buttonId="create-auto-weekdays"
                  values={selectedAutoWeekdays}
                  options={weekdays
                    .filter((day) => day.value >= 1 && day.value <= 5)
                    .map((day) => ({
                      value: String(day.value),
                      label: day.label,
                    }))}
                  placeholder="Wochentage auswählen"
                  searchPlaceholder="Wochentage filtern (5 gefunden)"
                  emptyLabel="Kein Wochentag gefunden."
                  menuWidth="compact"
                  selectedLabel={(count) =>
                    `${count} Wochentag${count === 1 ? "" : "e"} ausgewählt`
                  }
                  onChange={setSelectedAutoWeekdays}
                />
              </div>
              <div className="form-row">
                <label htmlFor="create-auto-hours">Stunden pro Woche</label>
                <input
                  id="create-auto-hours"
                  type="text"
                  inputMode="decimal"
                  value={autoPlanHours}
                  placeholder="z.B. 5,5"
                  onChange={(event) => setAutoPlanHours(event.target.value)}
                />
              </div>
            </>
          ) : (
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
          )}
          <div className="form-row">
            <label htmlFor="create-from">Von</label>
            <DatePickerInput
              id="create-from"
              value={from}
              absenceRanges={absenceRanges}
              onChange={setFrom}
            />
          </div>
          <div className="form-row">
            <label htmlFor="create-to">Bis</label>
            <DatePickerInput
              id="create-to"
              value={to}
              absenceRanges={absenceRanges}
              onChange={setTo}
            />
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

        {overlapEntries.length > 0 && taskMode !== "auto" ? (
          <div className="alert alert-warning">
            {overlapEntries.length} Blocker überschneiden sich mit bestehenden
            Blockern an {overlapDateCount} Tag
            {overlapDateCount === 1 ? "" : "en"}. Anlegen bleibt möglich.
          </div>
        ) : null}

        {taskMode === "auto" ? (
          <AutoPlanPreview
            projectName={selectedProject?.name}
            taskName={effectiveTaskName}
            userName={formatUserName(currentUser)}
            result={autoPlanResult}
            effectivePayloads={effectiveAutoPayloads}
            overrides={weekOverrides}
            onEditWeek={setEditingWeek}
            isLoading={isLoadingContext}
          />
        ) : (
          <RegularPreview
            projectName={selectedProject?.name}
            taskName={effectiveTaskName}
            payloads={previewPayloads}
            totalMinutes={totalMinutes}
            overlaps={overlapEntries}
            isLoading={isLoadingContext}
          />
        )}

        <button
          type="submit"
          className="primary-button"
          disabled={isCreating || isPreparingPreview}
        >
          {isPreparingPreview ? (
            <>
              <span className="button-spinner" aria-hidden="true" />
              Vorschau wird erstellt...
            </>
          ) : (
            "Vorschau anzeigen"
          )}
        </button>
      </form>
      {createPreview ? (
        <CreateSubmitPreviewModal
          preview={createPreview}
          isCreating={isCreating}
          onBack={() => setCreatePreview(null)}
          onCancel={() => setCreatePreview(null)}
          onCreate={() => void handleConfirmCreate()}
        />
      ) : null}
      {editingWeek
        ? (() => {
            const weekStartKey = format(editingWeek.weekStart, "yyyy-MM-dd");
            const weekEndKey = format(editingWeek.weekEnd, "yyyy-MM-dd");
            const initial =
              weekOverrides.get(weekStartKey) ??
              editingWeek.days.flatMap((day) => day.plannedPayloads);
            return (
              <AutoPlanWeekEditModal
                weekLabel={`${format(editingWeek.weekStart, "dd.MM.", { locale: de })}-${format(editingWeek.weekEnd, "dd.MM.yyyy", { locale: de })}`}
                minDate={weekStartKey > from ? weekStartKey : from}
                maxDate={weekEndKey < to ? weekEndKey : to}
                defaultStart={startTime}
                defaultEnd={endTime}
                userId={initial[0]?.userId ?? currentUser.id}
                taskId={initial[0]?.taskId ?? effectiveTaskId}
                initialPayloads={initial}
                onClose={() => setEditingWeek(null)}
                onSave={(payloads) => saveWeekOverride(editingWeek, payloads)}
              />
            );
          })()
        : null}
      {isAutoPlanInfoOpen ? (
        <AutoPlanInfoModal onClose={() => setIsAutoPlanInfoOpen(false)} />
      ) : null}
      {error ? (
        <div className="status-toast-region">
          <StatusToast
            message={error}
            variant="error"
            autoDismissMs={4200}
            onDismiss={() => setError("")}
          />
        </div>
      ) : null}
    </>
  );
}

function getCreateActionLabel(
  taskMode: TaskMode,
  autoTaskSource: AutoTaskSource,
): string {
  return taskMode === "new" || (taskMode === "auto" && autoTaskSource === "new")
    ? "Aufgabe und Blocker anlegen"
    : "Blocker anlegen";
}

function AutoPlanInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell
      labelledBy="auto-plan-info-title"
      dialogClassName="modal auto-plan-info-modal"
      onClose={onClose}
    >
      <div className="modal-header">
        <div>
          <p className="eyebrow">Auto Plan</p>
          <h2 id="auto-plan-info-title">So funktioniert Auto Plan</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Schließen"
          onClick={onClose}
        >
          x
        </button>
      </div>
      <div className="auto-plan-info-content">
        <p>
          Auto Plan verteilt die eingetragenen Stunden pro Kalenderwoche auf
          passende freie Zeiten des ausgewählten Nutzers.
        </p>
        <ul>
          <li>Es werden nur die ausgewählten Wochentage berücksichtigt.</li>
          <li>
            Die awork-Tageskapazität begrenzt, wie viel an einem Tag geplant
            werden darf.
          </li>
          <li>
            Freie Zeit bedeutet hier nur: keine bestehenden awork-Blocker in
            diesem Zeitraum.
          </li>
          <li>
            Andere Outlook-Termine oder externe Kalendertermine werden dabei
            nicht berücksichtigt.
          </li>
          <li>
            Bestehende Blocker zählen nach ihrer Gesamtdauer, nicht nach ihrer
            Anzahl.
          </li>
          <li>
            Pro Woche wird zuerst der Tag mit der meisten freien Arbeitszeit
            genutzt.
          </li>
          <li>Bestehende Blocker werden vermieden.</li>
          <li>Auto Plan erstellt keine Blocker unter 30 Minuten.</li>
          <li>
            Wenn eine Woche zu voll ist, zeigt die Vorschau die offenen Stunden
            als Warnung.
          </li>
        </ul>
      </div>
      <div className="modal-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Verstanden
        </button>
      </div>
    </ModalShell>
  );
}

function CreateSubmitPreviewModal({
  preview,
  isCreating,
  onBack,
  onCancel,
  onCreate,
}: {
  preview: CreatePreviewSnapshot;
  isCreating: boolean;
  onBack: () => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const overlapsByStart = new Map(
    preview.overlaps.map((entry) => [entry.payload.startDate, entry]),
  );
  const isAutoPartial =
    preview.autoPlanResult !== undefined &&
    preview.autoPlanResult.remainingMinutes > 0;

  return (
    <ModalShell
      labelledBy="create-submit-preview-title"
      dialogClassName="modal modal-wide create-submit-preview-modal"
      onClose={isCreating ? undefined : onCancel}
    >
      <div className="modal-header">
        <div>
          <p className="eyebrow">Vorschau</p>
          <h2 id="create-submit-preview-title">
            {preview.payloads.length} Blocker werden angelegt
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Schließen"
          disabled={isCreating}
          onClick={onCancel}
        >
          x
        </button>
      </div>

      <div className="preview-summary">
        <span>{preview.projectName ?? "Kein Projekt ausgewählt"}</span>
        <span>{preview.taskName}</span>
        <span>{preview.userName}</span>
        <span>{formatMinutesAsHours(preview.totalMinutes)} geplant</span>
        {preview.autoPlanResult ? (
          <span>
            {formatMinutesAsHours(
              preview.autoPlanResult.weeklyRequestedMinutes,
            )}{" "}
            pro Woche
          </span>
        ) : null}
        {isAutoPartial ? (
          <span>
            {formatMinutesAsHours(preview.autoPlanResult!.remainingMinutes)}{" "}
            offen
          </span>
        ) : null}
      </div>

      {preview.overlaps.length > 0 ? (
        <div className="alert alert-warning">
          {preview.overlaps.length} Blocker überschneiden sich mit bestehenden
          Blockern. Anlegen bleibt möglich.
        </div>
      ) : null}

      {isAutoPartial ? (
        <div className="alert alert-warning">
          Auto Plan kann nicht alle Stunden im gewählten Zeitraum verteilen.
          Angelegt wird nur die hier gezeigte Teilplanung.
        </div>
      ) : null}

      <div className="preview-list">
        {preview.payloads.map((payload, index) => {
          const overlap = overlapsByStart.get(payload.startDate);
          return (
            <div
              key={`${payload.startDate}-${index}`}
              className={`preview-row${overlap ? " preview-row-warning" : ""}`}
            >
              <span>
                {format(parseISO(payload.startDate), "EEEE, dd.MM.yyyy", {
                  locale: de,
                })}
                {overlap ? (
                  <em className="warning-badge">
                    Überschneidung mit {overlap.overlaps.length} Blocker
                    {overlap.overlaps.length === 1 ? "" : "n"}
                  </em>
                ) : null}
              </span>
              <strong>{formatPayloadTimeWindow(payload)}</strong>
            </div>
          );
        })}
      </div>

      <div className="modal-actions">
        <button
          type="button"
          className="ghost-button"
          disabled={isCreating}
          onClick={onBack}
        >
          Zurück
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={isCreating}
          onClick={onCancel}
        >
          Schließen
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={isCreating}
          onClick={onCreate}
        >
          {isCreating ? (
            <>
              <span className="button-spinner" aria-hidden="true" />
              Wird angelegt...
            </>
          ) : (
            preview.actionLabel
          )}
        </button>
      </div>
    </ModalShell>
  );
}

function RegularPreview({
  projectName,
  taskName,
  payloads,
  totalMinutes,
  overlaps,
  isLoading,
}: {
  projectName?: string;
  taskName: string;
  payloads: CreateTaskSchedulePayload[];
  totalMinutes: number;
  overlaps: PayloadOverlap[];
  isLoading: boolean;
}) {
  const overlapsByStart = new Map(
    overlaps.map((entry) => [entry.payload.startDate, entry]),
  );

  return (
    <div className="create-preview">
      <h3>Vorschau</h3>
      <p>
        {projectName ?? "Kein Projekt ausgewählt"} · {taskName}
      </p>
      <p>
        {payloads.length} Blocker · {formatMinutesAsHours(totalMinutes)}
        {isLoading ? " · bestehende Blocker werden geprüft..." : ""}
      </p>
      <div className="preview-list create-preview-list">
        {payloads.slice(0, 12).map((payload) => {
          const overlap = overlapsByStart.get(payload.startDate);
          return (
            <div
              key={payload.startDate}
              className={`preview-row${overlap ? " preview-row-warning" : ""}`}
            >
              <span>
                {format(parseISO(payload.startDate), "EEEE, dd.MM.yyyy", {
                  locale: de,
                })}
                {overlap ? (
                  <em className="warning-badge">
                    Überschneidung mit {overlap.overlaps.length} Blocker
                    {overlap.overlaps.length === 1 ? "" : "n"}
                  </em>
                ) : null}
              </span>
              <strong>{formatPayloadTimeWindow(payload)}</strong>
            </div>
          );
        })}
        {payloads.length > 12 ? (
          <div className="preview-row">
            <span>{payloads.length - 12} weitere Blocker</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function describeUnplannedReason(result: AutoPlanResult): string {
  const fullDays = result.skippedDays.filter(
    (day) => day.reason === "full",
  ).length;

  if (fullDays > 0) {
    return `weil an ${fullDays} Tag${fullDays === 1 ? "" : "en"} im Zeitraum bereits bestehende Blocker keinen freien Slot ab 30 Minuten übrig lassen`;
  }

  return "weil im gewählten Zeitfenster an den ausgewählten Wochentagen nicht genug freie Slots ab 30 Minuten verfügbar sind";
}

function AutoPlanPreview({
  projectName,
  taskName,
  userName,
  result,
  effectivePayloads,
  overrides,
  onEditWeek,
  isLoading,
}: {
  projectName?: string;
  taskName: string;
  userName: string;
  result: AutoPlanResult;
  effectivePayloads: CreateTaskSchedulePayload[];
  overrides: Map<string, CreateTaskSchedulePayload[]>;
  onEditWeek: (week: AutoPlanWeek) => void;
  isLoading: boolean;
}) {
  const [showAllSkippedDays, setShowAllSkippedDays] = useState(false);
  // Summary reflects manual edits: recompute from the effective payloads so the
  // "geplant"/"Blocker"/"offen" figures stay in sync with what will be saved.
  const hasOverrides = overrides.size > 0;
  const plannedMinutes = hasOverrides
    ? Math.round(
        effectivePayloads.reduce((sum, p) => sum + p.plannedDuration, 0) / 60,
      )
    : result.plannedMinutes;
  const blockerCount = hasOverrides
    ? effectivePayloads.length
    : result.payloads.length;
  const remainingMinutes = Math.max(0, result.requestedMinutes - plannedMinutes);
  const isPartial = remainingMinutes > 0 && plannedMinutes > 0;
  const isEmpty = result.requestedMinutes > 0 && plannedMinutes === 0;
  const visibleSkippedDays = showAllSkippedDays
    ? result.skippedDays
    : result.skippedDays.slice(0, 12);
  const hiddenSkippedDayCount =
    result.skippedDays.length - visibleSkippedDays.length;
  const overallState = isEmpty ? "empty" : isPartial ? "partial" : "success";

  useEffect(() => {
    setShowAllSkippedDays(false);
  }, [
    result.requestedMinutes,
    result.plannedMinutes,
    result.remainingMinutes,
    result.skippedDays.length,
  ]);

  return (
    <div
      className={`create-preview auto-plan-preview${isPartial || isEmpty ? " auto-plan-preview-warning" : ""}`}
    >
      <div className="auto-plan-title-row">
        <div>
          <h3>Auto Plan Vorschau für {userName}</h3>
          <p>
            {projectName ?? "Kein Projekt ausgewählt"} · {taskName}
          </p>
        </div>
        <span
          className={`auto-plan-state-badge auto-plan-state-badge-${overallState}`}
        >
          {isEmpty
            ? "Nicht planbar"
            : isPartial
              ? "Teilweise geplant"
              : "Vollständig geplant"}
        </span>
      </div>
      <div className="auto-plan-summary">
        <span>
          {formatMinutesAsHours(result.weeklyRequestedMinutes)} pro Woche
        </span>
        <span>
          {result.weeks.length} Woche{result.weeks.length === 1 ? "" : "n"}
        </span>
        <span>
          {formatMinutesAsHours(result.requestedMinutes)} gesamt gewünscht
        </span>
        <span>{formatMinutesAsHours(plannedMinutes)} geplant</span>
        <span>{blockerCount} Blocker</span>
        {remainingMinutes > 0 ? (
          <span>{formatMinutesAsHours(remainingMinutes)} offen</span>
        ) : null}
        {hasOverrides ? <span>manuell angepasst</span> : null}
        {isLoading ? <span>bestehende Blocker werden geprüft...</span> : null}
      </div>
      {isEmpty ? (
        <p className="auto-plan-status-copy">
          Im ausgewählten Zeitraum wurde kein freier Slot ab 30 Minuten
          gefunden.
        </p>
      ) : isPartial && !hasOverrides ? (
        <p className="auto-plan-status-copy">
          {formatMinutesAsHours(remainingMinutes)} konnten insgesamt nicht
          eingeplant werden, {describeUnplannedReason(result)}.
        </p>
      ) : null}
      <div className="auto-plan-days">
        {result.weeks.map((week) => (
          <AutoPlanWeekPreview
            key={week.weekStart.toISOString()}
            week={week}
            override={overrides.get(format(week.weekStart, "yyyy-MM-dd"))}
            onEdit={() => onEditWeek(week)}
          />
        ))}
        {result.weeks.length === 0 || result.days.length === 0 ? (
          <div className="preview-row preview-row-warning">
            <span>Keine freien Slots im ausgewählten Zeitraum gefunden.</span>
          </div>
        ) : null}
      </div>
      {result.skippedDays.length > 0 ? (
        <div className="auto-plan-skipped-days">
          {visibleSkippedDays.map((day) => (
            <span
              key={`${day.reason}-${day.date.toISOString()}`}
              className={`auto-plan-skipped-day auto-plan-skipped-day-${day.reason}`}
              title={
                day.reason === "full"
                  ? "Kein freier Slot ab 30 Minuten"
                  : "Nicht benötigt, Stunden sind bereits verteilt"
              }
            >
              {format(day.date, "dd.MM.", { locale: de })} ·{" "}
              {day.reason === "full" ? "kein Platz" : "nicht benötigt"}
            </span>
          ))}
          {hiddenSkippedDayCount > 0 ? (
            <button
              type="button"
              className="auto-plan-skipped-day auto-plan-skipped-day-more"
              onClick={() => setShowAllSkippedDays(true)}
            >
              +{hiddenSkippedDayCount} weitere
            </button>
          ) : showAllSkippedDays && result.skippedDays.length > 12 ? (
            <button
              type="button"
              className="auto-plan-skipped-day auto-plan-skipped-day-more"
              onClick={() => setShowAllSkippedDays(false)}
            >
              weniger anzeigen
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AutoPlanWeekPreview({
  week,
  override,
  onEdit,
}: {
  week: AutoPlanWeek;
  override?: CreateTaskSchedulePayload[];
  onEdit: () => void;
}) {
  const isEdited = override !== undefined;
  const editedMinutes = isEdited
    ? Math.round(override.reduce((sum, p) => sum + p.plannedDuration, 0) / 60)
    : week.plannedMinutes;
  const remainingMinutes = isEdited
    ? Math.max(0, week.requestedMinutes - editedMinutes)
    : week.remainingMinutes;
  const isPartial = remainingMinutes > 0 && editedMinutes > 0;
  const isEmpty = remainingMinutes > 0 && editedMinutes === 0;

  return (
    <div
      className={`auto-plan-week${isPartial || isEmpty ? " auto-plan-week-warning" : ""}`}
    >
      <div className="auto-plan-week-head">
        <div className="auto-plan-week-title">
          <strong>
            Woche {format(week.weekStart, "dd.MM.", { locale: de })}-
            {format(week.weekEnd, "dd.MM.yyyy", { locale: de })}
          </strong>
          {isEdited ? (
            <span className="auto-plan-week-edited-badge">Bearbeitet</span>
          ) : null}
        </div>
        <div className="auto-plan-week-meta">
          <span
            className={`auto-plan-week-badge${isPartial || isEmpty ? " auto-plan-week-badge-warning" : ""}`}
          >
            {isEmpty
              ? "0 geplant"
              : isPartial
                ? `${formatMinutesAsHours(remainingMinutes)} offen`
                : "OK"}
          </span>
          <span className="auto-plan-week-hours">
            {formatMinutesAsHours(editedMinutes)} /{" "}
            {formatMinutesAsHours(week.requestedMinutes)}
          </span>
          <button
            type="button"
            className="ghost-button auto-plan-week-edit-btn"
            aria-label="Blocker dieser Woche bearbeiten"
            title="Blocker dieser Woche bearbeiten"
            onClick={onEdit}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10.9 2.1a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1l-6.7 6.7-2.8.7.7-2.8 6.7-6.7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              <path d="M9.6 3.4l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      {remainingMinutes > 0 && !isEdited ? (
        <p className="auto-plan-week-copy">
          {formatMinutesAsHours(week.requestedMinutes)} sollten geplant werden,
          aber nur {formatMinutesAsHours(editedMinutes)} konnten geplant werden.
        </p>
      ) : null}
      {isEdited ? (
        override.length > 0 ? (
          <ul className="auto-plan-week-edited-list">
            {override.map((payload, i) => (
              <li
                key={`${payload.startDate}-${i}`}
                className="auto-plan-week-edited-item"
              >
                <span className="auto-plan-week-edited-date">
                  {format(parseISO(payload.startDate), "EEE, dd.MM.", {
                    locale: de,
                  })}
                </span>
                <strong>{formatPayloadTimeWindow(payload)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="auto-plan-week-copy">
            Keine Blocker für diese Woche. Über den Stift kannst du wieder
            Blocker hinzufügen.
          </p>
        )
      ) : (
        <div className="auto-plan-week-days">
          {week.days.map((day) => (
            <AutoPlanDayPreview key={day.date.toISOString()} day={day} />
          ))}
        </div>
      )}
    </div>
  );
}

function AutoPlanWeekEditModal({
  weekLabel,
  minDate,
  maxDate,
  defaultStart,
  defaultEnd,
  userId,
  taskId,
  initialPayloads,
  onClose,
  onSave,
}: {
  weekLabel: string;
  minDate: string;
  maxDate: string;
  defaultStart: string;
  defaultEnd: string;
  userId: string;
  taskId: string;
  initialPayloads: CreateTaskSchedulePayload[];
  onClose: () => void;
  onSave: (payloads: CreateTaskSchedulePayload[]) => void;
}) {
  const [allPayloads, setAllPayloads] =
    useState<CreateTaskSchedulePayload[]>(initialPayloads);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [formDate, setFormDate] = useState(minDate);
  const [formStart, setFormStart] = useState(defaultStart);
  const [formEnd, setFormEnd] = useState(defaultEnd);

  const sortByStart = (list: CreateTaskSchedulePayload[]) =>
    [...list].sort((a, b) => a.startDate.localeCompare(b.startDate));

  function startEditRow(i: number, payload: CreateTaskSchedulePayload) {
    setEditingIdx(i);
    setEditDate(format(parseISO(payload.startDate), "yyyy-MM-dd"));
    setEditStart(format(parseISO(payload.startDate), "HH:mm"));
    setEditEnd(format(parseISO(payload.endDate), "HH:mm"));
  }

  function saveEditRow() {
    if (editingIdx === null) return;
    const s = parseISO(`${editDate}T${editStart}:00`);
    const e = parseISO(`${editDate}T${editEnd}:00`);
    if (!isValid(s) || !isValid(e) || !isAfter(e, s)) return;
    setAllPayloads((prev) => {
      const updated = [...prev];
      updated[editingIdx] = {
        ...updated[editingIdx],
        startDate: format(s, "yyyy-MM-dd'T'HH:mm:ssxxx"),
        endDate: format(e, "yyyy-MM-dd'T'HH:mm:ssxxx"),
        plannedDuration: Math.round((e.getTime() - s.getTime()) / 1000),
      };
      return updated;
    });
    setEditingIdx(null);
  }

  function removeRow(i: number) {
    setAllPayloads((prev) => prev.filter((_, idx) => idx !== i));
    setEditingIdx(null);
  }

  const formStartDt = isValid(parseISO(`${formDate}T${formStart}:00`))
    ? parseISO(`${formDate}T${formStart}:00`)
    : null;
  const formEndDt = isValid(parseISO(`${formDate}T${formEnd}:00`))
    ? parseISO(`${formDate}T${formEnd}:00`)
    : null;
  const formMinutes =
    formStartDt && formEndDt && isAfter(formEndDt, formStartDt)
      ? Math.round((formEndDt.getTime() - formStartDt.getTime()) / 60000)
      : 0;

  function handleAddBlocker() {
    if (!formStartDt || !formEndDt || !isAfter(formEndDt, formStartDt)) return;
    const newPayload: CreateTaskSchedulePayload = {
      taskId,
      userId,
      startDate: format(formStartDt, "yyyy-MM-dd'T'HH:mm:ssxxx"),
      endDate: format(formEndDt, "yyyy-MM-dd'T'HH:mm:ssxxx"),
      plannedDuration: Math.round(
        (formEndDt.getTime() - formStartDt.getTime()) / 1000,
      ),
    };
    setAllPayloads((prev) => sortByStart([...prev, newPayload]));
    setFormStart(defaultStart);
    setFormEnd(defaultEnd);
  }

  const totalMinutes = allPayloads.reduce(
    (sum, p) => sum + Math.round(p.plannedDuration / 60),
    0,
  );
  const canAdd = editingIdx === null && formDate.length > 0 && formMinutes > 0;

  return (
    <ModalShell labelledBy="auto-plan-week-edit-title" onClose={onClose}>
      <div className="modal-header">
        <div>
          <p className="eyebrow">Blocker bearbeiten</p>
          <h2 id="auto-plan-week-edit-title">Woche {weekLabel}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Schließen"
          onClick={onClose}
        >
          x
        </button>
      </div>

      <div className="manual-resolve-context">
        <span className="manual-resolve-context-window">
          {allPayloads.length} Blocker · {formatMinutesAsHours(totalMinutes)} ·
          Zeitraum {format(parseISO(minDate), "dd.MM.", { locale: de })} bis{" "}
          {format(parseISO(maxDate), "dd.MM.yyyy", { locale: de })}
        </span>
      </div>

      {allPayloads.length > 0 ? (
        <div className="manual-resolve-planned">
          <p className="manual-resolve-planned-label">
            Alle Blocker ({allPayloads.length}):
          </p>
          <ul className="manual-resolve-planned-list">
            {allPayloads.map((payload, i) => (
              <li
                key={`${payload.startDate}-${payload.endDate}-${i}`}
                className={`manual-resolve-planned-item${editingIdx === i ? " is-editing" : ""}`}
              >
                {editingIdx === i ? (
                  <div className="manual-resolve-planned-edit-row">
                    <DatePickerInput
                      value={editDate}
                      minDate={minDate}
                      maxDate={maxDate}
                      onChange={setEditDate}
                    />
                    <input
                      type="time"
                      value={editStart}
                      className="manual-resolve-planned-edit-input"
                      onChange={(e) => setEditStart(e.target.value)}
                    />
                    <input
                      type="time"
                      value={editEnd}
                      className="manual-resolve-planned-edit-input"
                      onChange={(e) => setEditEnd(e.target.value)}
                    />
                    <button
                      type="button"
                      className="manual-resolve-planned-save"
                      title="Speichern"
                      onClick={saveEditRow}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="manual-resolve-planned-cancel"
                      title="Abbrechen"
                      onClick={() => setEditingIdx(null)}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="manual-resolve-planned-row-btn"
                    onClick={() => startEditRow(i, payload)}
                    title="Bearbeiten"
                  >
                    <span className="manual-resolve-planned-date">
                      {format(parseISO(payload.startDate), "dd.MM.", {
                        locale: de,
                      })}
                    </span>
                    <span className="manual-resolve-planned-window">
                      {formatPayloadTimeWindow(payload)}
                    </span>
                    <span className="manual-resolve-planned-duration">
                      {formatMinutesAsHours(
                        Math.round(payload.plannedDuration / 60),
                      )}
                    </span>
                    <span
                      className="manual-resolve-planned-edit-icon"
                      aria-hidden="true"
                    >
                      ✎
                    </span>
                    <button
                      type="button"
                      className="manual-resolve-planned-remove"
                      title="Entfernen"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRow(i);
                      }}
                    >
                      ×
                    </button>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="manual-resolve-context-window">
          Noch keine Blocker für diese Woche. Füge unten welche hinzu.
        </p>
      )}

      <div className="manual-resolve-add-section">
        <p className="manual-resolve-planned-label">
          Weiteren Blocker hinzufügen:
        </p>
        <div className="create-grid manual-resolve-add-grid">
          <div className="form-row">
            <label htmlFor="auto-week-add-date">Datum</label>
            <DatePickerInput
              id="auto-week-add-date"
              value={formDate}
              minDate={minDate}
              maxDate={maxDate}
              onChange={setFormDate}
            />
          </div>
          <div className="form-row">
            <label htmlFor="auto-week-add-start">Start</label>
            <input
              id="auto-week-add-start"
              type="time"
              value={formStart}
              onChange={(e) => setFormStart(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="auto-week-add-end">Ende</label>
            <input
              id="auto-week-add-end"
              type="time"
              value={formEnd}
              onChange={(e) => setFormEnd(e.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          className="ghost-button"
          disabled={!canAdd}
          onClick={handleAddBlocker}
        >
          Blocker hinzufügen
          {formMinutes > 0 ? ` (${formatMinutesAsHours(formMinutes)})` : ""}
        </button>
      </div>

      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => onSave(sortByStart(allPayloads))}
        >
          Übernehmen
        </button>
      </div>
    </ModalShell>
  );
}

function AutoPlanDayPreview({ day }: { day: AutoPlanDay }) {
  const existingPreview = day.existingSchedules.slice(0, 3);

  return (
    <div className="auto-plan-day">
      <div className="auto-plan-day-head">
        <div className="auto-plan-day-title">
          <strong>
            {format(day.date, "EEEE, dd.MM.yyyy", { locale: de })}
          </strong>
          <div className="auto-plan-day-metrics">
            {day.capacityMinutes !== undefined ? (
              <span>{formatMinutesAsHours(day.capacityMinutes)} Kapazität</span>
            ) : null}
            <span>
              {formatMinutesAsHours(day.existingPlannedMinutes)} belegt
            </span>
            <span>{formatMinutesAsHours(day.availableMinutes)} frei</span>
          </div>
        </div>
        <div className="auto-plan-day-plan">
          <span>{formatMinutesAsHours(day.plannedMinutes)} geplant</span>
          <div className="auto-plan-payloads">
            {day.plannedPayloads.map((payload) => (
              <strong
                key={payload.startDate}
                className="auto-plan-payload-chip"
              >
                {formatPayloadTimeWindow(payload)}
              </strong>
            ))}
          </div>
        </div>
      </div>
      {existingPreview.length > 0 ? (
        <div className="auto-plan-existing">
          <span>Bestehend</span>
          {existingPreview.map((schedule) => (
            <em key={schedule.id}>
              {format(parseISO(schedule.start), "HH:mm")}-
              {format(parseISO(schedule.end), "HH:mm")}
              {schedule.taskName ? ` · ${schedule.taskName}` : ""}
            </em>
          ))}
          {day.existingSchedules.length > existingPreview.length ? (
            <em>
              +{day.existingSchedules.length - existingPreview.length} weitere
            </em>
          ) : null}
        </div>
      ) : null}
    </div>
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
  typeFilter?: string,
): Array<{ value: string; label: string }> {
  const statuses = new Map<string, string>();
  items.forEach((item) => {
    if (
      typeFilter &&
      typeFilter !== PROJECT_TYPE_FILTER_ALL &&
      "statusType" in item &&
      item.statusType !== typeFilter
    )
      return;
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

function buildTypeOptions(
  projects: AworkProject[],
): Array<{ value: string; label: string }> {
  const types = new Set<string>();
  projects.forEach((p) => {
    if (p.statusType) types.add(p.statusType);
  });
  return Array.from(types)
    .sort((a, b) =>
      (STATUS_TYPE_LABELS[a] ?? a).localeCompare(STATUS_TYPE_LABELS[b] ?? b),
    )
    .map((t) => ({ value: t, label: STATUS_TYPE_LABELS[t] ?? t }));
}

function buildTaskStatusOptions(tasks: AworkProjectTask[]): SelectOption[] {
  const statuses = new Map<string, AworkProjectTask>();
  tasks.forEach((task) => {
    const value = statusFilterValue(task);
    if (value && !statuses.has(value)) {
      statuses.set(value, task);
    }
  });

  return Array.from(statuses.entries())
    .map(([value, task]) => ({
      value,
      label: task.statusName ?? task.statusType ?? task.statusId ?? value,
      icon: (
        <StatusIcon
          icon={task.statusIcon}
          type={task.statusType}
          title={task.statusName ? `Status: ${task.statusName}` : undefined}
        />
      ),
    }))
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

function formatUserName(user: AworkUser): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email ||
    user.id
  );
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

function readHoursToMinutes(value: string): number {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.round(parsed * 60);
}
