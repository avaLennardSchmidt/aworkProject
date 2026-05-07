import { useMemo, useState } from "react";
import type { AworkUser } from "../types/awork";
import type { BulkEditMode, PreviewChange, ScheduleGroup } from "../types/planner";
import {
  buildUpdatedTimeWindow,
  buildUpdatedTimeWindowKeepEnd,
  buildUpdatedTimeWindowKeepStart,
  calculateDurationMinutes,
  formatMinutesAsHours,
  formatScheduleDateLabel,
  getTimeHHmm,
  isSameLocalDate,
} from "../services/scheduleTimeCalculator";
import { isOwnSchedule } from "../services/scheduleMapper";

interface BulkEditModalProps {
  group: ScheduleGroup;
  currentUser: AworkUser;
  onClose: () => void;
  onPreview: (changes: PreviewChange[]) => void;
}

export function BulkEditModal({ group, currentUser, onClose, onPreview }: BulkEditModalProps) {
  const originalDuration = calculateDurationMinutes(group.schedules[0].start, group.schedules[0].end);
  const [mode, setMode] = useState<BulkEditMode>("manual");
  const [newStartTime, setNewStartTime] = useState(group.startTime);
  const [newEndTime, setNewEndTime] = useState(group.endTime);
  const [durationMinutes, setDurationMinutes] = useState(String(originalDuration));
  const [error, setError] = useState("");

  const computedWindow = useMemo(() => {
    const duration = Number(durationMinutes);
    if (mode === "manual") {
      return `${newStartTime}-${newEndTime}`;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      return "Invalid duration";
    }
    const sample = buildWindowForSchedule(mode, group.schedules[0], newStartTime, newEndTime, duration);
    return `${getTimeHHmm(sample.newStartIso)}-${getTimeHHmm(sample.newEndIso)}`;
  }, [durationMinutes, group.schedules, mode, newEndTime, newStartTime]);

  function handlePreview() {
    const validationMessage = validate();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    const duration = Number(durationMinutes);
    const changes = group.schedules.map((schedule) => {
      const updated = buildWindowForSchedule(mode, schedule, newStartTime, newEndTime, duration);
      return {
        schedule,
        dateLabel: formatScheduleDateLabel(schedule.start),
        oldStart: getTimeHHmm(schedule.start),
        oldEnd: getTimeHHmm(schedule.end),
        newStart: getTimeHHmm(updated.newStartIso),
        newEnd: getTimeHHmm(updated.newEndIso),
        newStartIso: updated.newStartIso,
        newEndIso: updated.newEndIso,
        beforeMinutes: calculateDurationMinutes(schedule.start, schedule.end),
        afterMinutes: calculateDurationMinutes(updated.newStartIso, updated.newEndIso),
      };
    });

    onPreview(changes);
  }

  function validate(): string {
    if (group.schedules.length === 0) {
      return "This group has no schedules to edit.";
    }

    if (group.schedules.some((schedule) => !isOwnSchedule(schedule, currentUser))) {
      return "Ownership could not be verified for every schedule in this group.";
    }

    if (
      group.schedules.some(
        (schedule) => getTimeHHmm(schedule.start) !== group.startTime || getTimeHHmm(schedule.end) !== group.endTime,
      )
    ) {
      return "This group contains mixed original time windows and cannot be edited safely.";
    }

    const duration = Number(durationMinutes);
    if (mode === "manual") {
      const sample = safeBuildWindow(() => buildUpdatedTimeWindow(group.schedules[0], newStartTime, newEndTime));
      if (!sample) {
        return "Enter a valid start and end time.";
      }
      if (calculateDurationMinutes(sample.newStartIso, sample.newEndIso) <= 0) {
        return "New start time must be before new end time.";
      }
      return "";
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      return "Duration must be greater than 0 minutes.";
    }

    const changesDate = group.schedules.some((schedule) => {
      const updated = buildWindowForSchedule(mode, schedule, newStartTime, newEndTime, duration);
      return !isSameLocalDate(schedule.start, updated.newStartIso) || !isSameLocalDate(schedule.end, updated.newEndIso);
    });

    if (changesDate) {
      return "Duration cannot move a blocker to a different calendar date.";
    }

    return "";
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="bulk-edit-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Bulk edit</p>
            <h2 id="bulk-edit-title">{group.taskName}</h2>
            <p>{group.projectName ?? "No project in schedule response"}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            x
          </button>
        </div>

        <div className="summary-strip">
          <span>{group.weekdayLabel} {group.startTime}-{group.endTime}</span>
          <span>{group.schedules.length} blockers</span>
          <span>{formatMinutesAsHours(group.totalMinutes)} before</span>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="Edit mode">
          <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>
            Set start/end
          </button>
          <button type="button" className={mode === "keep-start" ? "active" : ""} onClick={() => setMode("keep-start")}>
            Keep start
          </button>
          <button type="button" className={mode === "keep-end" ? "active" : ""} onClick={() => setMode("keep-end")}>
            Keep end
          </button>
        </div>

        {mode === "manual" ? (
          <div className="filter-grid">
            <div className="form-row">
              <label htmlFor="new-start">New start time</label>
              <input id="new-start" type="time" value={newStartTime} onChange={(event) => setNewStartTime(event.target.value)} />
            </div>
            <div className="form-row">
              <label htmlFor="new-end">New end time</label>
              <input id="new-end" type="time" value={newEndTime} onChange={(event) => setNewEndTime(event.target.value)} />
            </div>
          </div>
        ) : (
          <div className="form-row compact-input">
            <label htmlFor="duration">New duration in minutes</label>
            <input
              id="duration"
              type="number"
              min="1"
              step="15"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
            />
          </div>
        )}

        <div className="computed-window">New pattern: {computedWindow}</div>
        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={handlePreview}>
            Preview changes
          </button>
        </div>
      </div>
    </div>
  );
}

function safeBuildWindow(build: () => { newStartIso: string; newEndIso: string }) {
  try {
    return build();
  } catch {
    return null;
  }
}

function buildWindowForSchedule(
  mode: BulkEditMode,
  schedule: ScheduleGroup["schedules"][number],
  newStartTime: string,
  newEndTime: string,
  durationMinutes: number,
) {
  if (mode === "keep-start") {
    return buildUpdatedTimeWindowKeepStart(schedule, durationMinutes);
  }

  if (mode === "keep-end") {
    return buildUpdatedTimeWindowKeepEnd(schedule, durationMinutes);
  }

  return buildUpdatedTimeWindow(schedule, newStartTime, newEndTime);
}
