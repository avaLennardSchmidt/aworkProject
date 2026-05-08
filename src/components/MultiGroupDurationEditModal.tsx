import { addMinutes, format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import type { AworkUser } from "../types/awork";
import type { PreviewChange, ScheduleGroup } from "../types/planner";
import { isOwnSchedule } from "../services/scheduleMapper";
import {
  calculateDurationMinutes,
  formatMinutesAsHours,
  formatScheduleDateLabel,
  getTimeHHmm,
  setTimeOnSameDate,
  setWeekdayPreservingTime,
} from "../services/scheduleTimeCalculator";

interface MultiGroupDurationEditModalProps {
  groups: ScheduleGroup[];
  currentUser: AworkUser;
  onClose: () => void;
  onPreview: (changes: PreviewChange[]) => void;
}

type Direction = "add" | "remove";
type EditMode = "delta" | "set-window";

export function MultiGroupDurationEditModal({
  groups,
  currentUser,
  onClose,
  onPreview,
}: MultiGroupDurationEditModalProps) {
  const [editMode, setEditMode] = useState<EditMode>("delta");
  const [direction, setDirection] = useState<Direction>("add");
  const [hours, setHours] = useState("1");
  const [minutes, setMinutes] = useState("0");
  const [windowStartTime, setWindowStartTime] = useState(
    groups[0]?.startTime ?? "09:00",
  );
  const [windowEndTime, setWindowEndTime] = useState(
    groups[0]?.endTime ?? "10:00",
  );
  const [weekdayOverride, setWeekdayOverride] = useState("");
  const [error, setError] = useState("");
  const schedules = useMemo(
    () => groups.flatMap((group) => group.schedules),
    [groups],
  );
  const totalBeforeMinutes = schedules.reduce(
    (sum, schedule) =>
      sum + calculateDurationMinutes(schedule.start, schedule.end),
    0,
  );
  const deltaMinutes = buildDeltaMinutes(direction, hours, minutes);
  const totalAfterMinutes = schedules.reduce((sum, schedule) => {
    const updated = buildUpdatedSchedule(schedule, {
      editMode,
      deltaMinutes,
      windowStartTime,
      windowEndTime,
      weekdayOverride,
    });
    if (!updated) {
      return sum;
    }

    return sum + calculateDurationMinutes(updated.newStartIso, updated.newEndIso);
  }, 0);

  function handlePreview() {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }

    const changes = schedules.map((schedule) => {
      const updated = buildUpdatedSchedule(schedule, {
        editMode,
        deltaMinutes,
        windowStartTime,
        windowEndTime,
        weekdayOverride,
      });
      if (!updated) {
        throw new Error("Invalid updated schedule values.");
      }

      const { newStartIso, newEndIso } = updated;

      return {
        schedule,
        dateLabel: formatScheduleDateLabel(schedule.start),
        newDateLabel: formatScheduleDateLabel(newStartIso),
        oldStart: getTimeHHmm(schedule.start),
        oldEnd: getTimeHHmm(schedule.end),
        newStart: getTimeHHmm(newStartIso),
        newEnd: getTimeHHmm(newEndIso),
        newStartIso,
        newEndIso,
        beforeMinutes: calculateDurationMinutes(schedule.start, schedule.end),
        afterMinutes: calculateDurationMinutes(newStartIso, newEndIso),
      };
    });

    onPreview(changes);
  }

  function validate(): string {
    if (groups.length < 2) return "Select at least two groups.";
    if (schedules.length === 0) return "The selected groups have no blockers.";
    if (schedules.some((schedule) => !isOwnSchedule(schedule, currentUser))) {
      return "Ownership could not be verified for every selected blocker.";
    }
    if (editMode === "delta" && deltaMinutes === 0 && !weekdayOverride) {
      return "Enter a duration to add/remove or choose a new weekday.";
    }

    if (
      editMode === "set-window" &&
      !weekdayOverride &&
      schedules.every(
        (schedule) =>
          getTimeHHmm(schedule.start) === windowStartTime &&
          getTimeHHmm(schedule.end) === windowEndTime,
      )
    ) {
      return "The selected blockers already use this time frame.";
    }

    if (
      schedules.some((schedule) => {
        const updated = buildUpdatedSchedule(schedule, {
          editMode,
          deltaMinutes,
          windowStartTime,
          windowEndTime,
          weekdayOverride,
        });
        if (!updated) {
          return true;
        }

        return (
          calculateDurationMinutes(updated.newStartIso, updated.newEndIso) <= 0
        );
      })
    ) {
      if (editMode === "set-window") {
        return "New start time must be before new end time.";
      }

      return "Removing that much time would make at least one blocker end before it starts.";
    }
    return "";
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="multi-duration-title"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Multi edit</p>
            <h2 id="multi-duration-title">Adjust selected groups</h2>
            <p>
              {groups.length} groups · {schedules.length} blockers
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            x
          </button>
        </div>

        <div className="summary-strip">
          <span>{formatMinutesAsHours(totalBeforeMinutes)} before</span>
          {editMode === "delta" ? (
            <span>
              {deltaMinutes >= 0 ? "+" : ""}
              {formatMinutesAsHours(deltaMinutes)} per blocker
            </span>
          ) : (
            <span>
              {windowStartTime}-{windowEndTime} per blocker
            </span>
          )}
          <span>{formatMinutesAsHours(totalAfterMinutes)} after</span>
        </div>

        <div className="filter-grid multi-edit-grid">
          <div className="form-row">
            <label htmlFor="multi-mode">Mode</label>
            <select
              id="multi-mode"
              value={editMode}
              onChange={(event) => setEditMode(event.target.value as EditMode)}
            >
              <option value="delta">Add or remove time</option>
              <option value="set-window">Set time frame</option>
            </select>
          </div>

          {editMode === "delta" ? (
            <>
              <div className="form-row">
                <label htmlFor="multi-direction">Change</label>
                <select
                  id="multi-direction"
                  value={direction}
                  onChange={(event) =>
                    setDirection(event.target.value as Direction)
                  }
                >
                  <option value="add">Add time</option>
                  <option value="remove">Remove time</option>
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="multi-hours">Hours</label>
                <input
                  id="multi-hours"
                  type="number"
                  min="0"
                  step="1"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="multi-minutes">Minutes</label>
                <input
                  id="multi-minutes"
                  type="number"
                  min="0"
                  max="59"
                  step="5"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="multi-window-start">Start time</label>
                <input
                  id="multi-window-start"
                  type="time"
                  value={windowStartTime}
                  onChange={(event) => setWindowStartTime(event.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="multi-window-end">End time</label>
                <input
                  id="multi-window-end"
                  type="time"
                  value={windowEndTime}
                  onChange={(event) => setWindowEndTime(event.target.value)}
                />
              </div>
            </>
          )}

          <div className="form-row">
            <label htmlFor="multi-weekday">New weekday</label>
            <select
              id="multi-weekday"
              value={weekdayOverride}
              onChange={(event) => setWeekdayOverride(event.target.value)}
            >
              <option value="">Keep current weekdays</option>
              {weekdayOptions.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {weekdayOverride ? (
          <p className="modal-note">
            All selected blockers will be moved to the same weekday.
          </p>
        ) : null}

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handlePreview}
          >
            Preview changes
          </button>
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

function buildDeltaMinutes(
  direction: Direction,
  hours: string,
  minutes: string,
): number {
  const parsedHours = Math.max(0, Number(hours) || 0);
  const parsedMinutes = Math.max(0, Number(minutes) || 0);
  const totalMinutes = Math.round(parsedHours * 60 + parsedMinutes);
  return direction === "add" ? totalMinutes : -totalMinutes;
}

function buildUpdatedSchedule(
  schedule: ScheduleGroup["schedules"][number],
  options: {
    editMode: EditMode;
    deltaMinutes: number;
    windowStartTime: string;
    windowEndTime: string;
    weekdayOverride: string;
  },
): { newStartIso: string; newEndIso: string } | null {
  try {
    let newStartIso = schedule.start;
    let newEndIso = schedule.end;

    if (options.editMode === "delta") {
      newEndIso = format(
        addMinutes(parseISO(schedule.end), options.deltaMinutes),
        "yyyy-MM-dd'T'HH:mm:ssxxx",
      );
    } else {
      newStartIso = setTimeOnSameDate(schedule.start, options.windowStartTime);
      newEndIso = setTimeOnSameDate(schedule.end, options.windowEndTime);
    }

    if (options.weekdayOverride) {
      const weekday = Number(options.weekdayOverride);
      newStartIso = setWeekdayPreservingTime(newStartIso, weekday);
      newEndIso = setWeekdayPreservingTime(newEndIso, weekday);
    }

    return { newStartIso, newEndIso };
  } catch {
    return null;
  }
}
