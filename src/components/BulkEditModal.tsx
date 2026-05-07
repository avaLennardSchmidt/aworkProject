import { useMemo, useState } from "react";
import type { AworkUser } from "../types/awork";
import type { PreviewChange, ScheduleGroup } from "../types/planner";
import {
  buildUpdatedTimeWindowOnWeekday,
  calculateDurationMinutes,
  formatMinutesAsHours,
  formatScheduleDateLabel,
  getTimeHHmm,
} from "../services/scheduleTimeCalculator";
import { isOwnSchedule } from "../services/scheduleMapper";

interface BulkEditModalProps {
  group: ScheduleGroup;
  currentUser: AworkUser;
  onClose: () => void;
  onPreview: (changes: PreviewChange[]) => void;
  onManualEditRequest: (group: ScheduleGroup) => void;
}

export function BulkEditModal({ group, currentUser, onClose, onPreview, onManualEditRequest }: BulkEditModalProps) {
  const [newStartTime, setNewStartTime] = useState(group.startTime);
  const [newEndTime, setNewEndTime] = useState(group.endTime);
  const [newWeekday, setNewWeekday] = useState(String(group.weekday));
  const [error, setError] = useState("");

  const computedWindow = useMemo(() => {
    const weekdayLabel = weekdayOptions.find((day) => day.value === Number(newWeekday))?.label ?? group.weekdayLabel;
    return `${weekdayLabel} ${newStartTime}-${newEndTime}`;
  }, [group.weekdayLabel, newEndTime, newStartTime, newWeekday]);

  function handlePreview() {
    const validationMessage = validate();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    const changes = group.schedules.map((schedule) => {
      const updated = buildUpdatedTimeWindowOnWeekday(schedule, newStartTime, newEndTime, Number(newWeekday));
      return {
        schedule,
        dateLabel: formatScheduleDateLabel(schedule.start),
        newDateLabel: formatScheduleDateLabel(updated.newStartIso),
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

    const sample = safeBuildWindow(() => buildUpdatedTimeWindowOnWeekday(group.schedules[0], newStartTime, newEndTime, Number(newWeekday)));
    if (!sample) {
      return "Enter a valid weekday, start time, and end time.";
    }

    if (calculateDurationMinutes(sample.newStartIso, sample.newEndIso) <= 0) {
      return "New start time must be before new end time.";
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

        <div className="filter-grid">
          <div className="form-row">
            <label htmlFor="new-weekday">New weekday</label>
            <select id="new-weekday" value={newWeekday} onChange={(event) => setNewWeekday(event.target.value)}>
              {weekdayOptions.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="new-start">New start time</label>
            <input id="new-start" type="time" value={newStartTime} onChange={(event) => setNewStartTime(event.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="new-end">New end time</label>
            <input id="new-end" type="time" value={newEndTime} onChange={(event) => setNewEndTime(event.target.value)} />
          </div>
        </div>

        <div className="computed-window">New pattern: {computedWindow}</div>
        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="modal-actions modal-actions-split">
          <div className="modal-actions-left">
            <button type="button" className="manual-edit-button" onClick={() => onManualEditRequest(group)}>
              Manual edit
            </button>
          </div>
          <div className="modal-actions-right">
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handlePreview}>
              Preview changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const weekdayOptions = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

function safeBuildWindow(build: () => { newStartIso: string; newEndIso: string }) {
  try {
    return build();
  } catch {
    return null;
  }
}
