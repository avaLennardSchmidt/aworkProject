import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addMinutes,
  eachDayOfInterval,
  format,
  getDay,
  isAfter,
  isValid,
  parseISO,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import type {
  AworkProject,
  AworkProjectTask,
  AworkTaskSchedule,
  AworkUser,
  AworkUserCapacity,
  CreateTaskSchedulePayload,
} from "../types/awork";
import {
  buildProjectTaskPlan,
  countIsoWeeksInRange,
  findPayloadOverlaps,
  formatPayloadTimeWindow,
  type AutoPlanDistributionMode,
  type ProjectTaskPlanResult,
} from "../services/autoPlanScheduler";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";
import { StatusIcon } from "./StatusIcon";
import { ModalShell } from "./ModalShell";
import {
  formatSearchPlaceholder,
  MultiSearchableSelect,
  SearchableSelect,
} from "./SearchableSelect";
import { SegmentedControl } from "./SegmentedControl";
import { DatePickerInput } from "./DatePickerInput";

interface ProjectPlanPanelProps {
  currentUser: AworkUser;
  projects: AworkProject[];
  isLoadingProjects: boolean;
  isCreating: boolean;
  myAssignedProjectIds: Set<string>;
  workflowToggle?: ReactNode;
  onLoadProjects: () => Promise<void>;
  onLoadProjectTasks: (projectId: string) => Promise<AworkProjectTask[]>;
  onLoadExistingSchedules: (
    from: string,
    to: string,
  ) => Promise<AworkTaskSchedule[]>;
  onLoadUserCapacity: () => Promise<AworkUserCapacity | undefined>;
  onCreate: (payloads: CreateTaskSchedulePayload[]) => Promise<boolean>;
}

const NO_LIST_LABEL = "Ohne Liste";

const weekdayOptions = [
  { value: "1", label: "Montag" },
  { value: "2", label: "Dienstag" },
  { value: "3", label: "Mittwoch" },
  { value: "4", label: "Donnerstag" },
  { value: "5", label: "Freitag" },
];

const distributionOptions = [
  { value: "even", label: "Gleichmäßig" },
  { value: "packed", label: "Gebündelt" },
] satisfies Array<{ value: AutoPlanDistributionMode; label: string }>;

function renderHoverTaskName(label: string, textClassName: string) {
  return (
    <span className="project-plan-name-hover" aria-label={label}>
      <span className={textClassName}>{label}</span>
      <span className="project-plan-name-hover-tooltip" role="tooltip">
        {label}
      </span>
    </span>
  );
}

interface PlanPreview {
  results: ProjectTaskPlanResult[];
  payloads: CreateTaskSchedulePayload[];
  existingSchedules: AworkTaskSchedule[];
  plannedMinutes: number;
  remainingMinutes: number;
  distributionMode: AutoPlanDistributionMode;
  allowOverbooking: boolean;
}

interface TaskPlanHint {
  isLoading: boolean;
  result?: Pick<
    ProjectTaskPlanResult,
    "taskId" | "taskName" | "payloads" | "plannedMinutes" | "remainingMinutes" | "reason"
  >;
  error?: string;
}

export function ProjectPlanPanel({
  currentUser,
  projects,
  isLoadingProjects,
  isCreating,
  myAssignedProjectIds,
  workflowToggle,
  onLoadProjects,
  onLoadProjectTasks,
  onLoadExistingSchedules,
  onLoadUserCapacity,
  onCreate,
}: ProjectPlanPanelProps) {
  const [projectId, setProjectId] = useState("");
  const [onlyMyProjects, setOnlyMyProjects] = useState(false);
  const [tasks, setTasks] = useState<AworkProjectTask[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [manuallyEditedDurationIds, setManuallyEditedDurationIds] = useState<Set<string>>(
    new Set(),
  );
  const [weeklyBudgetHours, setWeeklyBudgetHours] = useState("");
  const [distributionMode, setDistributionMode] =
    useState<AutoPlanDistributionMode>("even");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [weekdays, setWeekdays] = useState<string[]>(["1", "2", "3", "4", "5"]);
  const [allowOverbooking, setAllowOverbooking] = useState(false);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [taskPlanHints, setTaskPlanHints] = useState<Record<string, TaskPlanHint>>({});
  const [taskPlanHintPlacements, setTaskPlanHintPlacements] = useState<
    Record<string, "up" | "down">
  >({});
  const [openHintId, setOpenHintId] = useState<string | null>(null);
  const openHintRef = useRef<HTMLSpanElement | null>(null);
  const [manualTask, setManualTask] = useState<AworkProjectTask | null>(null);
  const [manualOpenMinutes, setManualOpenMinutes] = useState(0);
  const [manualPlannedPayloads, setManualPlannedPayloads] = useState<CreateTaskSchedulePayload[]>([]);
  const [pendingManualPayloads, setPendingManualPayloads] = useState<Record<string, { payloads: CreateTaskSchedulePayload[]; remainingMinutes: number }>>({});
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (projects.length === 0 && !isLoadingProjects) {
      void onLoadProjects();
    }
  }, [isLoadingProjects, onLoadProjects, projects.length]);

  // Close open hint popover when clicking outside of it.
  useEffect(() => {
    if (!openHintId) return;
    function handleMouseDown(event: MouseEvent) {
      if (
        openHintRef.current &&
        !openHintRef.current.contains(event.target as Node)
      ) {
        setOpenHintId(null);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openHintId]);

  const projectOptions = useMemo(
    () =>
      projects
        .filter(
          (p) => !onlyMyProjects || myAssignedProjectIds.has(p.id),
        )
        .map((p) => ({ value: p.id, label: p.name })),
    [projects, onlyMyProjects, myAssignedProjectIds],
  );

  // Only tasks that are not yet scheduled at all ("ungeplant").
  const plannableTasks = useMemo(
    () => tasks.filter((task) => (task.scheduledCount ?? 0) === 0),
    [tasks],
  );

  const groups = useMemo(() => groupByList(plannableTasks), [plannableTasks]);

  const effectiveSeconds = (task: AworkProjectTask) =>
    parseHoursToSeconds(durationValue(task));

  const selectableIds = useMemo(
    () =>
      plannableTasks
        .filter((task) => effectiveSeconds(task) > 0)
        .map((task) => task.id),
    [plannableTasks, durations, manuallyEditedDurationIds, weeklyBudgetHours],
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const selectable = new Set(selectableIds);
      const next = new Set([...current].filter((id) => selectable.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [selectableIds]);

  useEffect(() => {
    if (!projectId || isLoadingTasks || weekdays.length === 0) {
      setTaskPlanHints({});
      return;
    }

    const candidates = plannableTasks.filter(
      (task) => effectiveSeconds(task) > 0,
    );
    if (candidates.length === 0) {
      setTaskPlanHints({});
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setTaskPlanHints((current) =>
        Object.fromEntries(
          candidates.map((task) => [
            task.id,
            {
              ...current[task.id],
              isLoading: true,
            },
          ]),
        ),
      );

      void (async () => {
        try {
          const [from, to] = scheduleSpan(candidates);
          const existing = await onLoadExistingSchedules(from, to);
          const capacity = await onLoadUserCapacity();
          const fallbackDate = format(new Date(), "yyyy-MM-dd");
          const nextHints: Record<string, TaskPlanHint> = {};

          for (const task of [...candidates].sort(timelineSort)) {
            const result = buildProjectTaskPlan({
              currentUser,
              task: {
                id: task.id,
                name: task.name,
                startOn: task.startOn,
                dueOn: task.dueOn,
                plannedDurationSeconds: effectiveSeconds(task),
                weeklyBudgetSeconds: aworkWeeklyBudgetSeconds(task),
              },
              weekdayValues: weekdays.map(Number),
              startTime,
              endTime,
              distributionMode,
              allowOverbooking,
              existingSchedules: existing,
              userCapacity: capacity,
              fallbackDate,
            });
            nextHints[task.id] = { isLoading: false, result };
          }

          if (!cancelled) setTaskPlanHints(nextHints);
        } catch (hintError) {
          if (cancelled) return;
          setTaskPlanHints(
            Object.fromEntries(
              candidates.map((task) => [
                task.id,
                {
                  isLoading: false,
                  error:
                    hintError instanceof Error
                      ? hintError.message
                      : "Mini-Vorschau konnte nicht berechnet werden.",
                },
              ]),
            ),
          );
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    allowOverbooking,
    currentUser,
    distributionMode,
    durations,
    endTime,
    isLoadingTasks,
    manuallyEditedDurationIds,
    onLoadExistingSchedules,
    onLoadUserCapacity,
    plannableTasks,
    projectId,
    startTime,
    weekdays,
    weeklyBudgetHours,
  ]);

  const selectedCount = selectedIds.size;
  const hasPendingPayloads = Object.keys(pendingManualPayloads).length > 0;
  const previewDisabledReason =
    selectedCount === 0 && !hasPendingPayloads
      ? "Wähle mindestens eine Aufgabe aus."
      : selectedCount > 0 && weekdays.length === 0
        ? "Wähle mindestens einen Wochentag aus."
        : "";
  const selectedDurationMinutes = useMemo(
    () =>
      plannableTasks
        .filter((task) => selectedIds.has(task.id))
        .reduce(
          (sum, task) => sum + Math.round(effectiveSeconds(task) / 60),
          0,
        ),
    [plannableTasks, selectedIds, durations, manuallyEditedDurationIds, weeklyBudgetHours],
  );

  async function handleProjectChange(nextProjectId: string) {
    setProjectId(nextProjectId);
    setSelectedIds(new Set());
    setPreview(null);
    setError("");
    setPendingManualPayloads({});
    if (!nextProjectId) {
      setTasks([]);
      setDurations({});
      setManuallyEditedDurationIds(new Set());
      return;
    }
    setIsLoadingTasks(true);
    try {
      const loaded = await onLoadProjectTasks(nextProjectId);
      setTasks(loaded);
      // Prefill the per-task duration from awork's plannedDuration; tasks
      // without one start empty so the user can enter it.
      setDurations(
        Object.fromEntries(
          loaded.map((task) => [
            task.id,
            formatHours(task.plannedDurationSeconds ?? 0),
          ]),
        ),
      );
      setManuallyEditedDurationIds(new Set());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Projektaufgaben konnten nicht geladen werden.",
      );
      setTasks([]);
      setDurations({});
      setManuallyEditedDurationIds(new Set());
    } finally {
      setIsLoadingTasks(false);
    }
  }

  function setDuration(id: string, value: string) {
    setPreview(null);
    setManuallyEditedDurationIds((current) => new Set(current).add(id));
    setDurations((current) => ({ ...current, [id]: value }));
    if (parseHoursToSeconds(value) <= 0) {
      setSelectedIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function durationValue(task: AworkProjectTask): string {
    const explicitValue = durations[task.id];
    if (explicitValue) return explicitValue;
    if (!usesWeeklyBudget(task)) return explicitValue ?? "";
    return formatHours(
      parseHoursToSeconds(weeklyBudgetHours) * countTaskBudgetWeeks(task),
    );
  }

  function usesWeeklyBudget(task: AworkProjectTask): boolean {
    return (
      (task.plannedDurationSeconds ?? 0) <= 0 &&
      !manuallyEditedDurationIds.has(task.id) &&
      parseHoursToSeconds(weeklyBudgetHours) > 0
    );
  }

  function getDurationSource(
    task: AworkProjectTask,
  ): "awork" | "budget" | "manual" {
    if (manuallyEditedDurationIds.has(task.id)) return "manual";
    if ((task.plannedDurationSeconds ?? 0) > 0) return "awork";
    if (usesWeeklyBudget(task)) return "budget";
    return "manual";
  }

  function aworkWeeklyBudgetSeconds(task: AworkProjectTask): number | undefined {
    if (usesWeeklyBudget(task)) return parseHoursToSeconds(weeklyBudgetHours);
    const total = effectiveSeconds(task);
    if (total > 0) {
      const start = task.startOn ? parseISO(task.startOn) : null;
      const due = task.dueOn ? parseISO(task.dueOn) : null;
      if (start && isValid(start) && due && isValid(due)) {
        const weeks = countIsoWeeksInRange(startOfDay(start), startOfDay(due));
        return Math.ceil(total / weeks);
      }
      // No valid timeframe — fall through to total-budget mode in scheduler
      return undefined;
    }
    return undefined;
  }

  function countTaskBudgetWeeks(task: AworkProjectTask): number {
    const start = task.startOn ? parseISO(task.startOn) : null;
    const due = task.dueOn ? parseISO(task.dueOn) : null;
    const validStart = start && isValid(start);
    const validDue = due && isValid(due);
    if (!validStart || !validDue) return 1;
    if (format(start, "yyyy-MM-dd") === format(due, "yyyy-MM-dd")) return 1;

    const from = isAfter(start, due) ? due : start;
    const to = isAfter(start, due) ? start : due;
    const selectedWeekdays = new Set(weekdays.map(Number));
    const weekKeys = new Set(
      eachDayOfInterval({ start: from, end: to })
        .filter((date) => selectedWeekdays.has(getDay(date)))
        .map((date) => format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd")),
    );
    return weekKeys.size;
  }

  function toggleTask(id: string) {
    setPreview(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(ids: string[], allSelected: boolean) {
    setPreview(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function toggleAll() {
    setPreview(null);
    setSelectedIds((current) =>
      current.size === selectableIds.length ? new Set() : new Set(selectableIds),
    );
  }

  async function handlePreview() {
    if (previewDisabledReason) return;
    setIsPreparing(true);
    setError("");
    try {
      // Exclude tasks that already have pending manual payloads — their blockers
      // come from `pendingManualPayloads` and are appended below. Letting the algo
      // also plan them (e.g. if the checkbox was re-selected) would duplicate them.
      const selectedTasks = plannableTasks.filter(
        (task) => selectedIds.has(task.id) && !pendingManualPayloads[task.id],
      );
      const pendingPayloadsAll = Object.values(pendingManualPayloads).flatMap(
        (p) => p.payloads,
      );
      // Widen the existing-schedule fetch window so manual blockers (which may sit
      // outside the selected tasks' span) are still checked for overlaps.
      let [from, to] = scheduleSpan(selectedTasks);
      for (const p of pendingPayloadsAll) {
        const day = format(parseISO(p.startDate), "yyyy-MM-dd");
        if (day < from) from = day;
        if (day > to) to = day;
      }
      const existing = await onLoadExistingSchedules(from, to);
      const capacity = await onLoadUserCapacity();
      const fallbackDate = format(new Date(), "yyyy-MM-dd");

      // Treat pending manual payloads as already-occupied so the algo doesn't re-fill those slots.
      const pendingAsSchedules = pendingPayloadsAll.map(payloadToSchedule);
      // Accumulate generated blockers so later tasks avoid earlier ones.
      const accumulated: AworkTaskSchedule[] = [...existing, ...pendingAsSchedules];
      const results: ProjectTaskPlanResult[] = [];
      for (const task of [...selectedTasks].sort(timelineSort)) {
        const result = buildProjectTaskPlan({
          currentUser,
          task: {
            id: task.id,
            name: task.name,
            startOn: task.startOn,
            dueOn: task.dueOn,
            plannedDurationSeconds: effectiveSeconds(task),
            weeklyBudgetSeconds: aworkWeeklyBudgetSeconds(task),
          },
          weekdayValues: weekdays.map(Number),
          startTime,
          endTime,
          distributionMode,
          allowOverbooking,
          existingSchedules: accumulated,
          userCapacity: capacity,
          fallbackDate,
        });
        results.push(result);
        result.payloads.forEach((payload) =>
          accumulated.push(payloadToSchedule(payload)),
        );
      }

      const autoPayloads = results.flatMap((result) => result.payloads);
      const pendingMinutes = pendingPayloadsAll.reduce((s, p) => s + Math.round(p.plannedDuration / 60), 0);
      setPreview({
        results,
        payloads: [...autoPayloads, ...pendingPayloadsAll],
        existingSchedules: existing,
        plannedMinutes: results.reduce((s, r) => s + r.plannedMinutes, 0) + pendingMinutes,
        remainingMinutes: results.reduce((s, r) => s + r.remainingMinutes, 0),
        distributionMode,
        allowOverbooking,
      });
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Vorschau konnte nicht berechnet werden.",
      );
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleConfirm() {
    if (!preview || preview.payloads.length === 0) return;
    const created = await onCreate(preview.payloads);
    if (created) {
      setPreview(null);
      setSelectedIds(new Set());
      setPendingManualPayloads({});
      if (projectId) void handleProjectChange(projectId);
    }
  }

  function updatePreviewPayload(
    index: number,
    patch: Partial<Pick<CreateTaskSchedulePayload, "startDate" | "endDate">>,
  ) {
    setPreview((current) => {
      if (!current) return current;
      const payloads = current.payloads.map((payload, payloadIndex) => {
        if (payloadIndex !== index) return payload;
        const next = {
          ...payload,
          ...patch,
        };
        return {
          ...next,
          plannedDuration: getPayloadDurationSeconds(next),
        };
      });
      return {
        ...current,
        payloads,
        plannedMinutes: getPayloadsMinutes(payloads),
      };
    });
  }

  function removePreviewPayload(index: number) {
    setPreview((current) => {
      if (!current) return current;
      const payloads = current.payloads.filter((_, payloadIndex) => payloadIndex !== index);
      return {
        ...current,
        payloads,
        plannedMinutes: getPayloadsMinutes(payloads),
      };
    });
  }

  async function prepareTaskPlanHint(task: AworkProjectTask) {
    const pending = pendingManualPayloads[task.id];
    if (pending) {
      const plannedMinutes = pending.payloads.reduce((s, p) => s + Math.round(p.plannedDuration / 60), 0);
      setTaskPlanHints((current) => ({
        ...current,
        [task.id]: {
          isLoading: false,
          result: { taskId: task.id, payloads: pending.payloads, plannedMinutes, remainingMinutes: pending.remainingMinutes },
        },
      }));
      return;
    }
    setTaskPlanHints((current) => ({
      ...current,
      [task.id]: { isLoading: true },
    }));
    try {
      const plannedTasks = selectedIds.has(task.id)
        ? plannableTasks.filter((entry) => selectedIds.has(entry.id))
        : [task];
      const [from, to] = scheduleSpan(plannedTasks);
      const existing = await onLoadExistingSchedules(from, to);
      const capacity = await onLoadUserCapacity();
      const fallbackDate = format(new Date(), "yyyy-MM-dd");
      const pendingHintSchedules = Object.values(pendingManualPayloads)
        .flatMap((p) => p.payloads)
        .map(payloadToSchedule);
      const accumulated: AworkTaskSchedule[] = [...existing, ...pendingHintSchedules];
      let targetResult: ProjectTaskPlanResult | undefined;
      for (const entry of [...plannedTasks].sort(timelineSort)) {
        const result = buildProjectTaskPlan({
          currentUser,
          task: {
            id: entry.id,
            name: entry.name,
            startOn: entry.startOn,
            dueOn: entry.dueOn,
            plannedDurationSeconds: effectiveSeconds(entry),
            weeklyBudgetSeconds: aworkWeeklyBudgetSeconds(entry),
          },
          weekdayValues: weekdays.map(Number),
          startTime,
          endTime,
          distributionMode,
          allowOverbooking,
          existingSchedules: accumulated,
          userCapacity: capacity,
          fallbackDate,
        });
        if (entry.id === task.id) {
          targetResult = result;
          break;
        }
        result.payloads.forEach((payload) =>
          accumulated.push(payloadToSchedule(payload)),
        );
      }
      setTaskPlanHints((current) => ({
        ...current,
        [task.id]: { isLoading: false, result: targetResult },
      }));
    } catch (hintError) {
      setTaskPlanHints((current) => ({
        ...current,
        [task.id]: {
          isLoading: false,
          error:
            hintError instanceof Error
              ? hintError.message
              : "Mini-Vorschau konnte nicht berechnet werden.",
        },
      }));
    }
  }

  function positionTaskPlanHint(taskId: string, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement = spaceBelow < 360 && spaceAbove > spaceBelow ? "up" : "down";
    setTaskPlanHintPlacements((current) =>
      current[taskId] === placement
        ? current
        : { ...current, [taskId]: placement },
    );
  }

  function openManualResolve(task: AworkProjectTask, openMinutes: number, algorithmPayloads: CreateTaskSchedulePayload[] = []) {
    setManualTask(task);
    setManualOpenMinutes(openMinutes);
    setManualPlannedPayloads(pendingManualPayloads[task.id]?.payloads ?? algorithmPayloads);
  }

  function handleManualSave(payloads: CreateTaskSchedulePayload[]) {
    if (!manualTask) return;
    const taskId = manualTask.id;
    // What the task still needs = originally-open minutes + whatever the algorithm
    // had already placed. Subtracting everything currently planned (incl. edits and
    // deletions of algorithm rows) gives the true remaining gap.
    const requiredMinutes =
      manualOpenMinutes +
      manualPlannedPayloads.reduce((s, p) => s + Math.round(p.plannedDuration / 60), 0);
    const coveredMinutes = payloads.reduce((s, p) => s + Math.round(p.plannedDuration / 60), 0);
    const remainingMinutes = Math.max(0, requiredMinutes - coveredMinutes);
    setPendingManualPayloads((current) => ({ ...current, [taskId]: { payloads, remainingMinutes } }));
    setSelectedIds((current) => {
      if (!current.has(taskId)) return current;
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
    setTaskPlanHints((current) => {
      const { [taskId]: _, ...rest } = current;
      return rest;
    });
    // Keep the existing preview in sync: remove stale payloads for this task, add the new ones.
    setPreview((current) => {
      if (!current) return current;
      const oldMinutes = current.payloads
        .filter((p) => p.taskId === taskId)
        .reduce((s, p) => s + Math.round(p.plannedDuration / 60), 0);
      const newMinutes = payloads.reduce((s, p) => s + Math.round(p.plannedDuration / 60), 0);
      const merged = [...current.payloads.filter((p) => p.taskId !== taskId), ...payloads];
      return { ...current, payloads: merged, plannedMinutes: current.plannedMinutes - oldMinutes + newMinutes };
    });
    setManualTask(null);
  }

  const projectName = projects.find((p) => p.id === projectId)?.name;

  return (
    <>
      <section className="panel create-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Workflow</p>
            <h2>Projekt einplanen</h2>
          </div>
          {workflowToggle}
        </div>

        <div className="create-grid project-selection-grid">
          <div className="form-row">
            <label htmlFor="project-plan-project">Projekt</label>
            <SearchableSelect
              buttonId="project-plan-project"
              value={projectId}
              disabled={isLoadingProjects}
              options={projectOptions}
              placeholder={
                isLoadingProjects ? "Projekte werden geladen..." : "Projekt auswählen"
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
            <label htmlFor="project-plan-only-my-projects" className="checkbox-row">
              <input
                id="project-plan-only-my-projects"
                type="checkbox"
                checked={onlyMyProjects}
                disabled={myAssignedProjectIds.size === 0}
                onChange={(event) => {
                  setOnlyMyProjects(event.target.checked);
                  if (event.target.checked && projectId && !myAssignedProjectIds.has(projectId)) {
                    void handleProjectChange("");
                  }
                }}
              />
              <span>Nur mir zugewiesene Projekte</span>
            </label>
          </div>
        </div>

        {projectId ? (
          <div className="create-grid project-plan-schedule-grid">
            <div className="form-row">
              <label htmlFor="project-plan-weekdays">Wochentage</label>
              <MultiSearchableSelect
                buttonId="project-plan-weekdays"
                values={weekdays}
                options={weekdayOptions}
                placeholder="Wochentage auswählen"
                searchPlaceholder="Wochentage filtern (5 gefunden)"
                emptyLabel="Kein Wochentag gefunden."
                menuWidth="compact"
                selectedLabel={(count) =>
                  `${count} Wochentag${count === 1 ? "" : "e"} ausgewählt`
                }
                onChange={(values) => {
                  setWeekdays(values);
                  setPreview(null);
                }}
              />
            </div>
            <div className="form-row">
              <label
                htmlFor="project-plan-weekly-budget"
                className="project-plan-weekly-budget-label"
              >
                <span>Wochenzeitbudget</span>
                <span className="project-plan-weekly-budget-hint">
                  Wird nur genutzt, wenn im awork-Task keine geplante Zeit steht.
                </span>
              </label>
              <input
                id="project-plan-weekly-budget"
                type="number"
                min="0"
                step="0.5"
                value={weeklyBudgetHours}
                placeholder="Std./Woche"
                onChange={(event) => {
                  setWeeklyBudgetHours(event.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <div className="form-row">
              <label htmlFor="project-plan-start">Start</label>
              <input
                id="project-plan-start"
                type="time"
                value={startTime}
                onChange={(event) => {
                  setStartTime(event.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <div className="form-row">
              <label htmlFor="project-plan-end">Ende</label>
              <input
                id="project-plan-end"
                type="time"
                value={endTime}
                onChange={(event) => {
                  setEndTime(event.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <div className="form-row form-row-full project-plan-distribution-row">
              <label>Verteilung</label>
              <SegmentedControl
                value={distributionMode}
                options={distributionOptions}
                ariaLabel="Verteilung der Projektblocker"
                onChange={(value) => {
                  setDistributionMode(value);
                  setPreview(null);
                }}
              />
              <div className="project-plan-distribution-help">
                <div className="project-plan-distribution-card is-active">
                  <strong>
                    {distributionMode === "even" ? "Gleichmäßig" : "Gebündelt"}
                  </strong>
                  <span>
                    {distributionMode === "even"
                      ? "Teilt die Stunden über die gewählten Wochentage. Beispiel: 12 h Wochenbudget, Mo-Fr und 09:00-17:00 ergibt ungefähr 2-3 h pro Tag."
                      : "Macht möglichst wenige, lange Blocker. Beispiel: 16 h Budget, Mo+Di und 08:00-16:00 ergibt zwei volle Tage."}
                  </span>
                </div>
              </div>
              <p className="project-plan-distribution-hint">
                Jeden Blocker kannst du in der Vorschau manuell anpassen, bevor du einplanst.
              </p>
            </div>
            <div className="form-row form-row-full project-plan-overbook-row">
              <label htmlFor="project-plan-overbook" className="checkbox-row">
                <input
                  id="project-plan-overbook"
                  type="checkbox"
                  checked={allowOverbooking}
                  onChange={(event) => {
                    setAllowOverbooking(event.target.checked);
                    setPreview(null);
                    setTaskPlanHints({});
                  }}
                />
                <span>Überbuchen erlauben</span>
              </label>
              <p className="project-plan-overbook-copy">
                Wenn aktiv, werden Blocker trotzdem im gewählten Zeitfenster
                angelegt. Überschneidungen mit bestehenden awork-Blockern
                werden in der Vorschau markiert.
              </p>
            </div>
          </div>
        ) : null}

        {error ? <div className="alert alert-error">{error}</div> : null}

        {projectId ? (
          isLoadingTasks ? (
            <p className="loading-text-hint">Aufgaben werden geladen...</p>
          ) : plannableTasks.length === 0 ? (
            <p className="project-plan-empty">
              Keine ungeplanten Aufgaben in diesem Projekt gefunden.
            </p>
          ) : (
            <>
              <div className="project-plan-toolbar">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={toggleAll}
                  disabled={selectableIds.length === 0}
                >
                  {selectedCount === selectableIds.length && selectableIds.length > 0
                    ? "Auswahl aufheben"
                    : "Alle auswählen"}
                </button>
                <span className="project-plan-toolbar-info">
                  {selectedCount} ausgewählt ·{" "}
                  {formatMinutesAsHours(selectedDurationMinutes)} gesamt
                </span>
              </div>

              <div className="project-plan-groups">
                {groups.map((group) => {
                  const groupSelectable = group.tasks
                    .filter((task) => effectiveSeconds(task) > 0)
                    .map((task) => task.id);
                  const allSelected =
                    groupSelectable.length > 0 &&
                    groupSelectable.every((id) => selectedIds.has(id));
                  return (
                    <div key={group.name} className="project-plan-group">
                      <div className="project-plan-group-header">
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            disabled={groupSelectable.length === 0}
                            onChange={() =>
                              toggleGroup(groupSelectable, allSelected)
                            }
                          />
                          <span>{group.name}</span>
                        </label>
                        <span className="project-plan-group-count">
                          {group.tasks.length}
                        </span>
                      </div>
                      <ul className="project-plan-task-list">
                        {group.tasks.map((task) => {
                          const selectable = effectiveSeconds(task) > 0;
                          const fromWeeklyBudget = usesWeeklyBudget(task);
                          const durationSource = getDurationSource(task);
                          const hasTimeframe = !!task.startOn && !!task.dueOn;
                          const taskWeeks = hasTimeframe ? countIsoWeeksInRange(startOfDay(parseISO(task.startOn!)), startOfDay(parseISO(task.dueOn!))) : 0;
                          const durationSourceTitle =
                            durationSource === "awork"
                              ? hasTimeframe
                                ? `Gesamtzeit aus awork (${formatHours(task.plannedDurationSeconds ?? 0)} h gesamt). Wird gleichmäßig auf ${taskWeeks} ${taskWeeks === 1 ? "Woche" : "Wochen"} verteilt – ca. ${formatHours(Math.ceil((task.plannedDurationSeconds ?? 0) / taskWeeks))} h/Woche.`
                                : `Gesamtzeit aus awork (${formatHours(task.plannedDurationSeconds ?? 0)} h). Kein Aufgabenzeitraum – wird so früh wie möglich eingeplant.`
                              : durationSource === "budget"
                                ? `${weeklyBudgetHours} h pro Woche aus dem globalen Wochenbudget. Wird jede Woche über den gesamten Aufgabenzeitraum eingeplant.`
                                : hasTimeframe
                                  ? `Manuell eingetragen als Gesamtzeit. Wird gleichmäßig auf ${taskWeeks} ${taskWeeks === 1 ? "Woche" : "Wochen"} verteilt.`
                                  : `Manuell eingetragen als Gesamtzeit. Kein Aufgabenzeitraum – wird so früh wie möglich eingeplant.`;
                          const taskHint = taskPlanHints[task.id];
                          const taskHintPlacement =
                            taskPlanHintPlacements[task.id] ?? "down";
                          const taskOpenMinutes =
                            taskHint?.result?.remainingMinutes ?? 0;
                          const taskPending = pendingManualPayloads[task.id];
                          const pendingRemainingMinutes = taskPending?.remainingMinutes ?? 0;
                          const isOverbooked = taskOpenMinutes > 0 && !taskPending;
                          return (
                            <li
                              key={task.id}
                              className={`project-plan-task${isOverbooked ? " is-overbooked" : ""}${taskPending ? (pendingRemainingMinutes > 0 ? " is-overbooked has-pending" : " has-pending") : ""}`}
                            >
                              <label className="checkbox-row project-plan-task-main">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(task.id)}
                                  disabled={!selectable}
                                  onChange={() => toggleTask(task.id)}
                                />
                                <StatusIcon
                                  icon={task.statusIcon}
                                  type={task.statusType}
                                  title={
                                    task.statusName
                                      ? `Status: ${task.statusName}`
                                      : undefined
                                  }
                                />
                                {renderHoverTaskName(
                                  task.name ?? task.id,
                                  "project-plan-task-name",
                                )}
                              </label>
                              <div className="project-plan-task-meta">
                                <span className="project-plan-task-window">
                                  {describeWindow(task)}
                                </span>
                                <span
                                  className="project-plan-help-anchor"
                                  ref={openHintId === task.id ? openHintRef : null}
                                >
                                  <button
                                    type="button"
                                    className={`project-plan-help-button${openHintId === task.id ? " is-active" : ""}`}
                                    aria-label={`Blocker-Vorschau für ${task.name ?? "Aufgabe"}`}
                                    aria-expanded={openHintId === task.id}
                                    onClick={(event) => {
                                      const next = openHintId === task.id ? null : task.id;
                                      positionTaskPlanHint(task.id, event.currentTarget);
                                      setOpenHintId(next);
                                      if (next) void prepareTaskPlanHint(task);
                                    }}
                                  >
                                    ?
                                  </button>
                                  <span
                                    className={`project-plan-help-popover project-plan-help-popover-${taskHintPlacement}${openHintId === task.id ? " project-plan-help-popover-open" : ""}`}
                                  >
                                    <TaskPlanHintContent hint={taskHint} />
                                  </span>
                                </span>
                                <span className="project-plan-duration-field">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    className="project-plan-duration-input"
                                    value={durationValue(task)}
                                    placeholder="Std."
                                    aria-label={`Dauer in Stunden für ${task.name ?? "Aufgabe"}`}
                                    title={
                                      fromWeeklyBudget
                                        ? `${weeklyBudgetHours} h pro Woche`
                                        : undefined
                                    }
                                    onChange={(event) =>
                                      setDuration(task.id, event.target.value)
                                    }
                                  />
                                  <span className="project-plan-duration-unit">
                                    h
                                  </span>
                                  <span
                                    className={`project-plan-duration-source project-plan-duration-source-${durationSource}`}
                                    title={durationSourceTitle}
                                  >
                                    {durationSource === "awork"
                                      ? "awork Zeit"
                                      : durationSource === "budget"
                                        ? "Wochenbudget"
                                        : "manuell"}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  className="ghost-button project-plan-manual-btn"
                                  aria-label="Blocker manuell bearbeiten"
                                  title="Blocker manuell bearbeiten"
                                  onClick={() => openManualResolve(task, taskOpenMinutes, taskHint?.result?.payloads ?? [])}
                                >
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                    <path d="M10.9 2.1a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1l-6.7 6.7-2.8.7.7-2.8 6.7-6.7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                                    <path d="M9.6 3.4l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                  </svg>
                                </button>
                              </div>
                              {taskPending ? (
                                <div className="project-plan-task-overbook-row">
                                  {pendingRemainingMinutes > 0 ? (
                                    <span className="project-plan-overbook-badge">
                                      {formatMinutesAsHours(pendingRemainingMinutes)} offen · keine freien Slots
                                    </span>
                                  ) : null}
                                  <span className="project-plan-pending-badge">
                                    {taskPending.payloads.length} Blocker bereit
                                  </span>
                                </div>
                              ) : isOverbooked ? (
                                <div className="project-plan-task-overbook-row">
                                  <span className="project-plan-overbook-badge">
                                    {formatMinutesAsHours(taskOpenMinutes)} offen · keine freien Slots
                                  </span>
                                  <span className="project-plan-manual-action-badge">
                                    Bearbeite die Blocker manuell →
                                  </span>
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="project-plan-actions">
                {previewDisabledReason ? (
                  <span className="project-plan-preview-disabled-reason">
                    {previewDisabledReason}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="primary-button"
                  disabled={!!previewDisabledReason || isPreparing}
                  title={previewDisabledReason || undefined}
                  onClick={() => void handlePreview()}
                >
                  {isPreparing ? "Berechne Vorschau..." : "Vorschau anzeigen"}
                </button>
              </div>
            </>
          )
        ) : null}
      </section>

      {preview ? (
        <ModalShell
          labelledBy="project-plan-preview-title"
          dialogClassName="modal modal-wide create-submit-preview-modal project-plan-preview-modal"
          onClose={isCreating ? undefined : () => setPreview(null)}
        >
          <div className="modal-header">
            <div>
              <p className="eyebrow">Vorschau</p>
              <h2 id="project-plan-preview-title">Projekt einplanen</h2>
              {projectName ? <p className="modal-subtitle">{projectName}</p> : null}
            </div>
          </div>

          <div className="preview-summary">
            <span>{preview.payloads.length} Blocker</span>
            <span>{formatMinutesAsHours(preview.plannedMinutes)} geplant</span>
            <span>
              {preview.distributionMode === "even"
                ? "Gleichmäßig verteilt"
                : "Gebündelt geplant"}
            </span>
            {preview.allowOverbooking ? (
              <span>Überbuchung erlaubt</span>
            ) : null}
            {preview.remainingMinutes > 0 ? (
              <span className="project-plan-task-warn">
                {formatMinutesAsHours(preview.remainingMinutes)} offen
              </span>
            ) : null}
            {getPreviewOverlapCount(preview) > 0 ? (
              <span className="project-plan-task-warn">
                {getPreviewOverlapCount(preview)} Überschneidung
                {getPreviewOverlapCount(preview) === 1 ? "" : "en"}
              </span>
            ) : null}
          </div>

          <div className="project-plan-preview-note-panel">
            <strong>Vor dem Anlegen anpassbar</strong>
            <span>
              Jede Zeile ist ein awork-Blocker, der erstellt wird. Datum, Start
              und Ende können hier noch manuell geändert oder einzelne Blocker
              entfernt werden.
            </span>
          </div>

          <div className="preview-list project-plan-edit-preview-list">
            {preview.payloads.map((payload, index) => {
              const result = preview.results.find(
                (entry) => entry.taskId === payload.taskId,
              );
              const task = tasks.find((entry) => entry.id === payload.taskId);
              const overlapCount = getPayloadPreviewOverlapCount(preview, payload, index);
              return (
                <div
                  key={`${payload.taskId}-${payload.startDate}-${index}`}
                  className={`preview-row project-plan-edit-preview-row${
                    overlapCount > 0 ? " preview-row-warning" : ""
                  }`}
                >
                  <span className="project-plan-preview-main">
                    <span>
                      {format(parseISO(payload.startDate), "EEEE, dd.MM.yyyy", {
                        locale: de,
                      })}
                      {overlapCount > 0 ? (
                        <em className="warning-badge">
                          Überschneidung mit {overlapCount} Blocker
                          {overlapCount === 1 ? "" : "n"}
                        </em>
                      ) : null}
                    </span>
                    <span className="project-plan-preview-task">
                      <StatusIcon
                        icon={task?.statusIcon}
                        type={task?.statusType}
                        title={
                          task?.statusName
                            ? `Status: ${task.statusName}`
                            : undefined
                        }
                      />
                      {renderHoverTaskName(
                        result?.taskName ?? task?.name ?? payload.taskId,
                        "project-plan-preview-task-name",
                      )}
                    </span>
                  </span>
                  <div className="project-plan-preview-edit-controls">
                    <div className="project-plan-preview-edit-fields">
                      <label>
                        <span>Datum</span>
                        <input
                          type="date"
                          value={format(parseISO(payload.startDate), "yyyy-MM-dd")}
                          onChange={(event) =>
                            updatePreviewPayload(
                              index,
                              movePayloadToDate(payload, event.target.value),
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>Start</span>
                        <input
                          type="time"
                          value={format(parseISO(payload.startDate), "HH:mm")}
                          onChange={(event) =>
                            updatePreviewPayload(
                              index,
                              movePayloadStartTime(payload, event.target.value),
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>Ende</span>
                        <input
                          type="time"
                          value={format(parseISO(payload.endDate), "HH:mm")}
                          onChange={(event) =>
                            updatePreviewPayload(
                              index,
                              movePayloadEndTime(payload, event.target.value),
                            )
                          }
                        />
                      </label>
                    </div>
                    <div className="project-plan-preview-row-actions">
                      <strong>{formatPayloadTimeWindow(payload)}</strong>
                      <button
                        type="button"
                        className="ghost-button project-plan-preview-remove"
                        onClick={() => removePreviewPayload(index)}
                      >
                        Entfernen
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {preview.results
              .filter((result) => result.payloads.length === 0)
              .map((result) => {
                const task = tasks.find((entry) => entry.id === result.taskId);
                return (
                  <div
                    key={`empty-${result.taskId}`}
                    className="preview-row preview-row-warning"
                  >
                    <span className="project-plan-preview-main">
                      <span className="project-plan-preview-task">
                        <StatusIcon
                          icon={task?.statusIcon}
                          type={task?.statusType}
                          title={
                            task?.statusName
                              ? `Status: ${task.statusName}`
                              : undefined
                          }
                        />
                        {renderHoverTaskName(
                          result.taskName ?? result.taskId,
                          "project-plan-preview-task-name",
                        )}
                      </span>
                      <span className="project-plan-preview-note">
                        {result.reason === "no-duration"
                          ? "keine Dauer"
                          : "nicht einplanbar"}
                      </span>
                    </span>
                    <strong>0 h</strong>
                  </div>
                );
              })}
          </div>

          <div className="modal-actions modal-actions-split">
            <div className="modal-actions-right">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setPreview(null)}
                disabled={isCreating}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => { void handleConfirm(); }}
                disabled={isCreating || preview.payloads.length === 0}
              >
                {isCreating
                  ? "Wird eingeplant..."
                  : `${preview.payloads.length} Blocker einplanen`}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {manualTask ? (
        <ManualResolveModal
          task={manualTask}
          openMinutes={manualOpenMinutes}
          plannedPayloads={manualPlannedPayloads}
          userId={currentUser.id}
          defaultStartTime={startTime}
          defaultEndTime={endTime}
          onClose={() => setManualTask(null)}
          onSave={handleManualSave}
        />
      ) : null}
    </>
  );
}

interface TaskGroup {
  name: string;
  tasks: AworkProjectTask[];
}

function TaskPlanHintContent({ hint }: { hint?: TaskPlanHint }) {
  if (!hint || (hint.isLoading && !hint.result && !hint.error)) {
    return (
      <span className="project-plan-help-empty">
        Mini-Vorschau wird berechnet...
      </span>
    );
  }
  if (hint.error) {
    return <span className="project-plan-help-empty">{hint.error}</span>;
  }
  if (!hint.result || hint.result.reason === "no-duration") {
    return (
      <span className="project-plan-help-empty">
        Keine Blocker: Für diese Aufgabe ist keine Dauer eingetragen.
      </span>
    );
  }
  if (hint.result.payloads.length === 0) {
    return (
      <span className="project-plan-help-empty">
        Keine Blocker im gewählten Zeitraum einplanbar.
      </span>
    );
  }
  return (
    <span className="project-plan-help-content">
      <strong>
        {hint.result.payloads.length} Blocker ·{" "}
        {formatMinutesAsHours(hint.result.plannedMinutes)}
      </strong>
      {hint.result.remainingMinutes > 0 ? (
        <>
          <span className="project-plan-help-warning">
            {formatMinutesAsHours(hint.result.remainingMinutes)} offen
          </span>
          <span className="project-plan-help-empty">
            Diese Stunden konnten nicht platziert werden, weil im gewählten
            Zeitraum, Tagesfenster oder in der Kapazität nicht genug freie
            Slots übrig sind.
          </span>
          <span className="project-plan-help-suggestion">
            Schalte „Überbuchen erlauben" ein, wenn diese Blocker trotzdem
            erzeugt werden sollen.
          </span>
        </>
      ) : null}
      <span className="project-plan-help-list">
        {hint.result.payloads.map((payload, index) => (
          <span key={`${payload.startDate}-${index}`}>
            <span>
              {format(parseISO(payload.startDate), "dd.MM.", { locale: de })}
            </span>
            <span>{formatPayloadTimeWindow(payload)}</span>
            <strong>{formatMinutesAsHours(payload.plannedDuration / 60)}</strong>
          </span>
        ))}
      </span>
    </span>
  );
}

interface ManualResolveModalProps {
  task: AworkProjectTask;
  openMinutes: number;
  plannedPayloads: CreateTaskSchedulePayload[];
  userId: string;
  defaultStartTime: string;
  defaultEndTime: string;
  onClose: () => void;
  onSave: (payloads: CreateTaskSchedulePayload[]) => void;
}

function ManualResolveModal({
  task,
  openMinutes,
  plannedPayloads,
  userId,
  defaultStartTime,
  defaultEndTime,
  onClose,
  onSave,
}: ManualResolveModalProps) {
  const windowStart = task.startOn
    ? format(parseISO(task.startOn), "yyyy-MM-dd")
    : undefined;
  const windowEnd = task.dueOn
    ? format(parseISO(task.dueOn), "yyyy-MM-dd")
    : undefined;

  const defaultDate = task.startOn
    ? format(parseISO(task.startOn), "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  // List of all payloads — starts from algo-planned, user can edit + add more.
  const [allPayloads, setAllPayloads] = useState<CreateTaskSchedulePayload[]>(plannedPayloads);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  // Form for adding a new blocker.
  const [formDate, setFormDate] = useState(defaultDate);
  const [formStart, setFormStart] = useState(defaultStartTime);
  const [formEnd, setFormEnd] = useState(defaultEndTime);

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
    if (!isAfter(e, s)) return;
    const updated = [...allPayloads];
    updated[editingIdx] = {
      ...updated[editingIdx],
      startDate: format(s, "yyyy-MM-dd'T'HH:mm:ssxxx"),
      endDate: format(e, "yyyy-MM-dd'T'HH:mm:ssxxx"),
      plannedDuration: Math.round((e.getTime() - s.getTime()) / 1000),
    };
    setAllPayloads(updated);
    setEditingIdx(null);
  }

  function removeRow(i: number) {
    setAllPayloads((prev) => prev.filter((_, idx) => idx !== i));
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

  // Required = originally-open minutes + what the algorithm had already placed.
  // Remaining = required minus everything currently in the list, so editing or
  // deleting an algorithm row correctly reopens those hours.
  const requiredMinutes =
    openMinutes +
    plannedPayloads.reduce((s, p) => s + Math.round(p.plannedDuration / 60), 0);
  const coveredMinutes = allPayloads.reduce(
    (s, p) => s + Math.round(p.plannedDuration / 60),
    0,
  );
  const remainingOpen = Math.max(0, requiredMinutes - coveredMinutes);

  function handleAddBlocker() {
    if (!formStartDt || !formEndDt || !isAfter(formEndDt, formStartDt)) return;
    const newPayload: CreateTaskSchedulePayload = {
      taskId: task.id,
      userId,
      startDate: format(formStartDt, "yyyy-MM-dd'T'HH:mm:ssxxx"),
      endDate: format(formEndDt, "yyyy-MM-dd'T'HH:mm:ssxxx"),
      plannedDuration: Math.round((formEndDt.getTime() - formStartDt.getTime()) / 1000),
    };
    setAllPayloads((prev) => [...prev, newPayload]);
    setFormStart(defaultStartTime);
    setFormEnd(defaultEndTime);
  }

  const canAdd = editingIdx === null && formDate.length > 0 && formMinutes > 0;

  return (
    <ModalShell labelledBy="manual-resolve-title" onClose={onClose}>
      <div className="modal-header">
        <div>
          <p className="eyebrow">Manuell Blocker anlegen</p>
          <h2 id="manual-resolve-title">{task.name ?? task.id}</h2>
        </div>
      </div>

      <div className="manual-resolve-context">
        {openMinutes > 0 ? (
          <>
            <span className="manual-resolve-context-open">
              {formatMinutesAsHours(openMinutes)} konnten nicht automatisch eingeplant werden.
            </span>
            {remainingOpen > 0 ? (
              <span className="manual-resolve-context-window">
                Noch <strong>{formatMinutesAsHours(remainingOpen)}</strong> ausstehend · Projektzeitraum: {describeWindow(task)}
              </span>
            ) : (
              <span className="manual-resolve-context-covered">
                Alle Stunden abgedeckt · Speichern um fortzufahren
              </span>
            )}
          </>
        ) : (
          <span className="manual-resolve-context-window">
            Projektzeitraum: {describeWindow(task)}
          </span>
        )}
      </div>

      {allPayloads.length > 0 ? (
        <div className="manual-resolve-planned">
          <p className="manual-resolve-planned-label">
            Alle Blocker ({allPayloads.length}):
          </p>
          <ul className="manual-resolve-planned-list">
            {allPayloads.map((payload, i) => (
              <li key={`${payload.startDate}-${payload.endDate}-${i}`} className={`manual-resolve-planned-item${editingIdx === i ? " is-editing" : ""}${i >= plannedPayloads.length ? " is-new" : ""}`}>
                {editingIdx === i ? (
                  <div className="manual-resolve-planned-edit-row">
                    <DatePickerInput
                      value={editDate}
                      minDate={windowStart}
                      maxDate={windowEnd}
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
                    <button type="button" className="manual-resolve-planned-save" title="Speichern" onClick={saveEditRow}>✓</button>
                    <button type="button" className="manual-resolve-planned-cancel" title="Abbrechen" onClick={() => setEditingIdx(null)}>×</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="manual-resolve-planned-row-btn"
                    onClick={() => startEditRow(i, payload)}
                    title="Bearbeiten"
                  >
                    <span className="manual-resolve-planned-date">
                      {format(parseISO(payload.startDate), "dd.MM.", { locale: de })}
                    </span>
                    <span className="manual-resolve-planned-window">
                      {formatPayloadTimeWindow(payload)}
                    </span>
                    <span className="manual-resolve-planned-duration">
                      {formatMinutesAsHours(Math.round(payload.plannedDuration / 60))}
                    </span>
                    {i >= plannedPayloads.length ? (
                      <span className="manual-resolve-planned-new-badge">Neu</span>
                    ) : (
                      <span className="manual-resolve-planned-edit-icon" aria-hidden="true">✎</span>
                    )}
                    <button
                      type="button"
                      className="manual-resolve-planned-remove"
                      title="Entfernen"
                      onClick={(e) => { e.stopPropagation(); removeRow(i); }}
                    >
                      ×
                    </button>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="manual-resolve-add-section">
        <p className="manual-resolve-planned-label">Weiteren Blocker hinzufügen:</p>
        <div className="create-grid manual-resolve-add-grid">
          <div className="form-row">
            <label htmlFor="manual-add-date">Datum</label>
            <DatePickerInput
              id="manual-add-date"
              value={formDate}
              minDate={windowStart}
              maxDate={windowEnd}
              onChange={setFormDate}
            />
          </div>
          <div className="form-row">
            <label htmlFor="manual-add-start">Start</label>
            <input
              id="manual-add-start"
              type="time"
              value={formStart}
              onChange={(e) => setFormStart(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="manual-add-end">Ende</label>
            <input
              id="manual-add-end"
              type="time"
              value={formEnd}
              onChange={(e) => setFormEnd(e.target.value)}
            />
          </div>
        </div>
        {formMinutes > 0 ? (
          <p className="manual-resolve-duration-hint">
            Dieser Blocker deckt <strong>{formatMinutesAsHours(formMinutes)}</strong> ab.
          </p>
        ) : null}
        <button
          type="button"
          className="ghost-button manual-resolve-add-btn"
          disabled={!canAdd}
          onClick={handleAddBlocker}
        >
          + Hinzufügen
        </button>
      </div>

      <div className="modal-actions modal-actions-split">
        <div className="modal-actions-right">
          <button type="button" className="ghost-button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={allPayloads.length === 0 || editingIdx !== null}
            onClick={() => onSave(allPayloads)}
          >
            Speichern & schließen
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function groupByList(tasks: AworkProjectTask[]): TaskGroup[] {
  const byList = new Map<string, AworkProjectTask[]>();
  tasks.forEach((task) => {
    const key = task.listName ?? NO_LIST_LABEL;
    byList.set(key, [...(byList.get(key) ?? []), task]);
  });
  return [...byList.entries()]
    .map(([name, groupTasks]) => ({
      name,
      tasks: [...groupTasks].sort(timelineSort),
    }))
    .sort((a, b) => {
      if (a.name === NO_LIST_LABEL) return 1;
      if (b.name === NO_LIST_LABEL) return -1;
      return a.name.localeCompare(b.name);
    });
}

function timelineSort(a: AworkProjectTask, b: AworkProjectTask): number {
  const aKey = a.startOn ?? a.dueOn ?? "";
  const bKey = b.startOn ?? b.dueOn ?? "";
  if (aKey && bKey && aKey !== bKey) return aKey.localeCompare(bKey);
  return (a.name ?? "").localeCompare(b.name ?? "");
}

function describeWindow(task: AworkProjectTask): string {
  const start = task.startOn ? parseISO(task.startOn) : null;
  const due = task.dueOn ? parseISO(task.dueOn) : null;
  const startValid = start && isValid(start);
  const dueValid = due && isValid(due);

  if (startValid && dueValid) {
    const sameDay =
      format(start, "yyyy-MM-dd") === format(due, "yyyy-MM-dd");
    if (sameDay) return `1 Blocker am ${format(due, "dd.MM.", { locale: de })}`;
    return `verteilt ${format(start, "dd.MM.", { locale: de })}–${format(due, "dd.MM.", { locale: de })}`;
  }
  if (dueValid) return `1 Blocker am ${format(due, "dd.MM.", { locale: de })}`;
  if (startValid) return `1 Blocker am ${format(start, "dd.MM.", { locale: de })}`;
  return "ohne Termin";
}

function scheduleSpan(tasks: AworkProjectTask[]): [string, string] {
  const today = format(new Date(), "yyyy-MM-dd");
  let min = "";
  let max = "";
  tasks.forEach((task) => {
    const dates = [task.startOn, task.dueOn].filter(
      (value): value is string => !!value && isValid(parseISO(value)),
    );
    dates.forEach((value) => {
      const day = format(parseISO(value), "yyyy-MM-dd");
      if (!min || day < min) min = day;
      if (!max || day > max) max = day;
    });
  });
  return [min || today, max || today];
}

function movePayloadToDate(
  payload: CreateTaskSchedulePayload,
  dateValue: string,
): Partial<Pick<CreateTaskSchedulePayload, "startDate" | "endDate">> {
  const start = parseISO(payload.startDate);
  const end = parseISO(payload.endDate);
  return normalizePayloadWindow(
    dateValue,
    format(start, "HH:mm"),
    format(end, "HH:mm"),
  );
}

function movePayloadStartTime(
  payload: CreateTaskSchedulePayload,
  timeValue: string,
): Partial<Pick<CreateTaskSchedulePayload, "startDate" | "endDate">> {
  const start = parseISO(payload.startDate);
  const end = parseISO(payload.endDate);
  const durationMinutes = Math.max(
    30,
    Math.round((end.getTime() - start.getTime()) / 60000),
  );
  const nextStart = parseISO(`${format(start, "yyyy-MM-dd")}T${timeValue}:00`);
  const nextEnd = addMinutes(nextStart, durationMinutes);
  return {
    startDate: formatPayloadDate(nextStart),
    endDate: formatPayloadDate(nextEnd),
  };
}

function movePayloadEndTime(
  payload: CreateTaskSchedulePayload,
  timeValue: string,
): Partial<Pick<CreateTaskSchedulePayload, "startDate" | "endDate">> {
  const start = parseISO(payload.startDate);
  return normalizePayloadWindow(
    format(start, "yyyy-MM-dd"),
    format(start, "HH:mm"),
    timeValue,
  );
}

function normalizePayloadWindow(
  dateValue: string,
  startTimeValue: string,
  endTimeValue: string,
): Partial<Pick<CreateTaskSchedulePayload, "startDate" | "endDate">> {
  const start = parseISO(`${dateValue}T${startTimeValue}:00`);
  let end = parseISO(`${dateValue}T${endTimeValue}:00`);
  if (!isAfter(end, start)) {
    end = addMinutes(start, 30);
  }
  return {
    startDate: formatPayloadDate(start),
    endDate: formatPayloadDate(end),
  };
}

function formatPayloadDate(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ssxxx");
}

function getPayloadDurationSeconds(payload: CreateTaskSchedulePayload): number {
  return Math.max(
    0,
    Math.round(
      (parseISO(payload.endDate).getTime() -
        parseISO(payload.startDate).getTime()) /
        1000,
    ),
  );
}

function getPayloadsMinutes(payloads: CreateTaskSchedulePayload[]): number {
  return payloads.reduce(
    (sum, payload) => sum + Math.round(payload.plannedDuration / 60),
    0,
  );
}

function getPreviewOverlapCount(preview: PlanPreview): number {
  return preview.payloads.reduce(
    (sum, payload, index) =>
      sum + getPayloadPreviewOverlapCount(preview, payload, index),
    0,
  );
}

function getPayloadPreviewOverlapCount(
  preview: PlanPreview,
  payload: CreateTaskSchedulePayload,
  index: number,
): number {
  const schedules = [
    ...preview.existingSchedules,
    ...preview.payloads
      .filter((_, payloadIndex) => payloadIndex !== index)
      .map(payloadToSchedule),
  ];
  return findPayloadOverlaps([payload], schedules)[0]?.overlaps.length ?? 0;
}

function formatHours(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const hours = seconds / 3600;
  return Number.isInteger(hours)
    ? String(hours)
    : String(Math.round(hours * 100) / 100);
}

function parseHoursToSeconds(value: string | undefined): number {
  if (!value) return 0;
  const hours = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600) : 0;
}

function payloadToSchedule(
  payload: CreateTaskSchedulePayload,
): AworkTaskSchedule {
  return {
    id: `tmp-${payload.taskId}-${payload.startDate}`,
    taskId: payload.taskId,
    start: payload.startDate,
    end: payload.endDate,
    raw: {},
  } as AworkTaskSchedule;
}
