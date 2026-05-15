import { addMinutes, format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import type { AworkUser } from "../types/awork";
import type {
  BlockerOperation,
  PreviewChange,
  ScheduleGroup,
} from "../types/planner";
import { isOwnSchedule } from "../services/scheduleMapper";
import { SearchableSelect } from "./SearchableSelect";
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
  onUnplanPreview: (operations: BlockerOperation[]) => void;
}

type Direction = "add" | "remove";
type EditMode = "delta" | "shift" | "set-window";

const editModeOptions = [
  { value: "delta", label: "Add or remove time" },
  { value: "shift", label: "Move blockers" },
  { value: "set-window", label: "Set time frame" },
] as const;

const durationDirectionOptions = [
  { value: "add", label: "Add time" },
  { value: "remove", label: "Remove time" },
] as const;

const moveDirectionOptions = [
  { value: "add", label: "Move up" },
  { value: "remove", label: "Move down" },
] as const;

const weekdayOptions = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

export function MultiGroupDurationEditModal({
  groups,
  currentUser,
  onClose,
  onPreview,
  onUnplanPreview,
}: MultiGroupDurationEditModalProps) {
  const [editMode, setEditMode] = useState<EditMode>("delta");
  const [direction, setDirection] = useState<Direction>("add");
  const [days, setDays] = useState("0");
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
  const deltaMinutes = buildDeltaMinutes(direction, days, hours, minutes);
  const isDurationEditMode = editMode === "delta" || editMode === "shift";
  const effectiveWeekdayOverride = editMode === "shift" ? "" : weekdayOverride;
  const totalAfterMinutes = schedules.reduce((sum, schedule) => {
    const updated = buildUpdatedSchedule(schedule, {
      editMode,
      deltaMinutes,
      windowStartTime,
      windowEndTime,
      weekdayOverride: effectiveWeekdayOverride,
    });
    if (!updated) {
      return sum;
    }

    return (
      sum + calculateDurationMinutes(updated.newStartIso, updated.newEndIso)
    );
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
        weekdayOverride: effectiveWeekdayOverride,
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

  function handleUnplanPreview() {
    const validation = validateUnplan();
    if (validation) {
      setError(validation);
      return;
    }

    onUnplanPreview(
      schedules.map((schedule) => ({
        kind: "delete",
        schedule,
        dateLabel: formatScheduleDateLabel(schedule.start),
        oldStart: getTimeHHmm(schedule.start),
        oldEnd: getTimeHHmm(schedule.end),
        beforeMinutes: calculateDurationMinutes(schedule.start, schedule.end),
      })),
    );
  }

  function validate(): string {
    if (groups.length === 0) return "Select at least one group.";
    if (schedules.length === 0) return "The selected groups have no blockers.";
    if (schedules.some((schedule) => !isOwnSchedule(schedule, currentUser))) {
      return "Ownership could not be verified for every selected blocker.";
    }

    if (isDurationEditMode && deltaMinutes === 0 && !effectiveWeekdayOverride) {
      return editMode === "shift"
        ? "Enter a time offset to move blockers."
        : "Enter a duration to add/remove or choose a new weekday.";
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
          weekdayOverride: effectiveWeekdayOverride,
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

      return editMode === "shift"
        ? "Moving these blockers produced an invalid time range."
        : "Removing that much time would make at least one blocker end before it starts.";
    }

    return "";
  }

  function validateUnplan(): string {
    if (groups.length === 0) return "Select at least one group.";
    if (schedules.length === 0) return "The selected groups have no blockers.";
    if (schedules.some((schedule) => !isOwnSchedule(schedule, currentUser))) {
      return "Ownership could not be verified for every selected blocker.";
    }
    return "";
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal multi-edit-modal"
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
          ) : editMode === "shift" ? (
            <span>
              {direction === "add" ? "Move up" : "Move down"}{" "}
              {formatMinutesAsHours(Math.abs(deltaMinutes))} per blocker
            </span>
          ) : (
            <span>
              {windowStartTime}-{windowEndTime} per blocker
            </span>
          )}
          <span>{formatMinutesAsHours(totalAfterMinutes)} after</span>
        </div>

        <div className="multi-edit-grid">
          <div className="multi-edit-row multi-edit-row-top">
            <div className="form-row">
              <label htmlFor="multi-mode">Mode</label>
              <SearchableSelect
                buttonId="multi-mode"
                value={editMode}
                options={[...editModeOptions]}
                placeholder="Select mode"
                searchPlaceholder="Filter modes (3 found)"
                emptyLabel="No mode found."
                menuWidth="compact"
                onChange={(value) => setEditMode(value as EditMode)}
              />
            </div>

            {isDurationEditMode ? (
              <div className="form-row">
                <label htmlFor="multi-direction">Change</label>
                <SearchableSelect
                  buttonId="multi-direction"
                  value={direction}
                  options={[
                    ...(editMode === "shift"
                      ? moveDirectionOptions
                      : durationDirectionOptions),
                  ]}
                  placeholder="Select change"
                  searchPlaceholder={
                    editMode === "shift"
                      ? "Filter move directions (2 found)"
                      : "Filter changes (2 found)"
                  }
                  emptyLabel="No change found."
                  menuWidth="compact"
                  onChange={(value) => setDirection(value as Direction)}
                />
              </div>
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
          </div>

          {isDurationEditMode ? (
            <div className="multi-edit-row multi-edit-row-duration">
              <div className="form-row">
                <label htmlFor="multi-days">Days</label>
                <input
                  id="multi-days"
                  type="number"
                  min="0"
                  step="1"
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
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
            </div>
          ) : null}

          {editMode !== "shift" ? (
            <div className="multi-edit-row multi-edit-row-weekday">
              <div className="form-row">
                <label htmlFor="multi-weekday">New weekday</label>
                <SearchableSelect
                  buttonId="multi-weekday"
                  value={weekdayOverride}
                  options={[
                    { value: "", label: "Keep current weekdays" },
                    ...weekdayOptions.map((day) => ({
                      value: String(day.value),
                      label: day.label,
                    })),
                  ]}
                  placeholder="Select weekday"
                  searchPlaceholder="Filter weekdays (8 found)"
                  emptyLabel="No weekday found."
                  menuWidth="compact"
                  onChange={setWeekdayOverride}
                />
              </div>
            </div>
          ) : null}
        </div>

        {effectiveWeekdayOverride ? (
          <p className="modal-note">
            All selected blockers will be moved to the same weekday.
          </p>
        ) : null}

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="modal-actions">
          <button
            type="button"
            className="danger-button unplan-selected-button"
            onClick={handleUnplanPreview}
          >
            Preview unplan selected
          </button>
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

function buildDeltaMinutes(
  direction: Direction,
  days: string,
  hours: string,
  minutes: string,
): number {
  const parsedDays = Math.max(0, Number(days) || 0);
  const parsedHours = Math.max(0, Number(hours) || 0);
  const parsedMinutes = Math.max(0, Number(minutes) || 0);
  const totalMinutes = Math.round(
    parsedDays * 24 * 60 + parsedHours * 60 + parsedMinutes,
  );
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
    } else if (options.editMode === "shift") {
      newStartIso = format(
        addMinutes(parseISO(schedule.start), options.deltaMinutes),
        "yyyy-MM-dd'T'HH:mm:ssxxx",
      );
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
