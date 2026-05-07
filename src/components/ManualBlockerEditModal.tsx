import { useMemo, useState } from "react";
import type { AworkUser } from "../types/awork";
import type { PreviewChange, ScheduleGroup } from "../types/planner";
import { isOwnSchedule } from "../services/scheduleMapper";
import {
  buildUpdatedTimeWindow,
  calculateDurationMinutes,
  formatMinutesAsHours,
  formatScheduleDateLabel,
  getTimeHHmm,
  isSameLocalDate,
} from "../services/scheduleTimeCalculator";

interface ManualBlockerEditModalProps {
  group: ScheduleGroup;
  currentUser: AworkUser;
  onBack: () => void;
  onClose: () => void;
  onPreview: (changes: PreviewChange[]) => void;
}

interface ManualRowState {
  scheduleId: string;
  startTime: string;
  endTime: string;
}

export function ManualBlockerEditModal({ group, currentUser, onBack, onClose, onPreview }: ManualBlockerEditModalProps) {
  const [rows, setRows] = useState<ManualRowState[]>(() =>
    group.schedules.map((schedule) => ({
      scheduleId: schedule.id,
      startTime: getTimeHHmm(schedule.start),
      endTime: getTimeHHmm(schedule.end),
    })),
  );
  const [error, setError] = useState("");

  const rowViews = useMemo(
    () =>
      rows.map((row) => {
        const schedule = group.schedules.find((candidate) => candidate.id === row.scheduleId);
        if (!schedule) {
          return { row, schedule: undefined, changed: false, rowError: "Schedule not found." };
        }

        const oldStart = getTimeHHmm(schedule.start);
        const oldEnd = getTimeHHmm(schedule.end);
        const changed = row.startTime !== oldStart || row.endTime !== oldEnd;
        return { row, schedule, changed, rowError: changed ? validateRow(schedule, row, currentUser) : "" };
      }),
    [currentUser, group.schedules, rows],
  );

  const changedCount = rowViews.filter((view) => view.changed).length;
  const invalidCount = rowViews.filter((view) => view.rowError).length;

  function updateRow(scheduleId: string, field: "startTime" | "endTime", value: string) {
    setError("");
    setRows((currentRows) => currentRows.map((row) => (row.scheduleId === scheduleId ? { ...row, [field]: value } : row)));
  }

  function resetRow(scheduleId: string) {
    const schedule = group.schedules.find((candidate) => candidate.id === scheduleId);
    if (!schedule) return;

    setError("");
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.scheduleId === scheduleId
          ? {
              ...row,
              startTime: getTimeHHmm(schedule.start),
              endTime: getTimeHHmm(schedule.end),
            }
          : row,
      ),
    );
  }

  function handlePreview() {
    if (changedCount === 0) {
      setError("Change at least one blocker before previewing.");
      return;
    }

    if (invalidCount > 0) {
      setError("Fix invalid blocker rows before previewing.");
      return;
    }

    const changes = rowViews
      .filter((view): view is ManualRowViewWithSchedule => Boolean(view.schedule) && view.changed && !view.rowError)
      .map((view) => {
        const updated = buildUpdatedTimeWindow(view.schedule, view.row.startTime, view.row.endTime);
        return {
          schedule: view.schedule,
          dateLabel: formatScheduleDateLabel(view.schedule.start),
          oldStart: getTimeHHmm(view.schedule.start),
          oldEnd: getTimeHHmm(view.schedule.end),
          newStart: getTimeHHmm(updated.newStartIso),
          newEnd: getTimeHHmm(updated.newEndIso),
          newStartIso: updated.newStartIso,
          newEndIso: updated.newEndIso,
          beforeMinutes: calculateDurationMinutes(view.schedule.start, view.schedule.end),
          afterMinutes: calculateDurationMinutes(updated.newStartIso, updated.newEndIso),
        };
      });

    onPreview(changes);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal-wide manual-edit-modal" role="dialog" aria-modal="true" aria-labelledby="manual-edit-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Manual edit</p>
            <h2 id="manual-edit-title">{group.taskName}</h2>
            <p>{group.projectName ?? "Project not resolved"}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            x
          </button>
        </div>

        <div className="preview-summary">
          <span>{group.weekdayLabel} {group.startTime}-{group.endTime}</span>
          <span>{group.schedules.length} blockers</span>
          <span>{formatMinutesAsHours(group.totalMinutes)} before</span>
          <span>{changedCount} changed</span>
        </div>

        <div className="manual-edit-list">
          {rowViews.map((view) => {
            const schedule = view.schedule;
            if (!schedule) {
              return (
                <div key={view.row.scheduleId} className="manual-edit-row has-error">
                  <span>{view.row.scheduleId}</span>
                  <strong>{view.rowError}</strong>
                </div>
              );
            }

            const oldStart = getTimeHHmm(schedule.start);
            const oldEnd = getTimeHHmm(schedule.end);
            const rowClassName = ["manual-edit-row", view.changed ? "is-changed" : "", view.rowError ? "has-error" : ""].filter(Boolean).join(" ");
            return (
              <div key={schedule.id} className={rowClassName}>
                <div className="manual-row-date">
                  <strong>{formatScheduleDateLabel(schedule.start)}</strong>
                  <span>{oldStart}-{oldEnd}</span>
                </div>
                <div className="manual-row-fields">
                  <label>
                    Start
                    <input type="time" value={view.row.startTime} onChange={(event) => updateRow(schedule.id, "startTime", event.target.value)} />
                  </label>
                  <label>
                    End
                    <input type="time" value={view.row.endTime} onChange={(event) => updateRow(schedule.id, "endTime", event.target.value)} />
                  </label>
                  <button type="button" className="ghost-button manual-reset-button" disabled={!view.changed} onClick={() => resetRow(schedule.id)}>
                    Reset
                  </button>
                </div>
                {view.rowError ? <div className="manual-row-error">{view.rowError}</div> : null}
              </div>
            );
          })}
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            Back
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={handlePreview}>
            Preview {changedCount} changed blocker{changedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ManualRowViewWithSchedule = {
  row: ManualRowState;
  schedule: ScheduleGroup["schedules"][number];
  changed: boolean;
  rowError: string;
};

function validateRow(schedule: ScheduleGroup["schedules"][number], row: ManualRowState, currentUser: AworkUser): string {
  if (!isOwnSchedule(schedule, currentUser)) {
    return "Ownership could not be verified.";
  }

  try {
    const updated = buildUpdatedTimeWindow(schedule, row.startTime, row.endTime);
    if (calculateDurationMinutes(updated.newStartIso, updated.newEndIso) <= 0) {
      return "Start must be before end.";
    }
    if (!isSameLocalDate(schedule.start, updated.newStartIso) || !isSameLocalDate(schedule.end, updated.newEndIso)) {
      return "Date cannot change.";
    }
  } catch {
    return "Enter valid start and end times.";
  }

  return "";
}
