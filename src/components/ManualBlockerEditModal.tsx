import { addDays, format, parseISO, set } from "date-fns";
import { useMemo, useState } from "react";
import type { AworkUser, CreateTaskSchedulePayload } from "../types/awork";
import type { BlockerOperation, ScheduleGroup } from "../types/planner";
import { isOwnSchedule } from "../services/scheduleMapper";
import {
  calculateDurationMinutes,
  formatMinutesAsHours,
  formatScheduleDateLabel,
  getTimeHHmm,
} from "../services/scheduleTimeCalculator";

interface ManualBlockerEditModalProps {
  group: ScheduleGroup;
  currentUser: AworkUser;
  onBack: () => void;
  onClose: () => void;
  onPreview: (operations: BlockerOperation[]) => void;
}

interface ExistingRowState {
  scheduleId: string;
  date: string;
  startTime: string;
  endTime: string;
  remove: boolean;
}

interface NewRowState {
  tempId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export function ManualBlockerEditModal({ group, currentUser, onBack, onClose, onPreview }: ManualBlockerEditModalProps) {
  const [existingRows, setExistingRows] = useState<ExistingRowState[]>(() =>
    group.schedules.map((schedule) => ({
      scheduleId: schedule.id,
      date: format(parseISO(schedule.start), "yyyy-MM-dd"),
      startTime: getTimeHHmm(schedule.start),
      endTime: getTimeHHmm(schedule.end),
      remove: false,
    })),
  );
  const [newRows, setNewRows] = useState<NewRowState[]>([]);
  const [error, setError] = useState("");

  const existingViews = useMemo(
    () =>
      existingRows.map((row) => {
        const schedule = group.schedules.find((candidate) => candidate.id === row.scheduleId);
        if (!schedule) return { row, schedule: undefined, changed: false, rowError: "Schedule not found." };

        const oldDate = format(parseISO(schedule.start), "yyyy-MM-dd");
        const oldStart = getTimeHHmm(schedule.start);
        const oldEnd = getTimeHHmm(schedule.end);
        const changed = row.remove || row.date !== oldDate || row.startTime !== oldStart || row.endTime !== oldEnd;
        return { row, schedule, changed, rowError: changed ? validateExistingRow(schedule, row, currentUser) : "" };
      }),
    [currentUser, existingRows, group.schedules],
  );
  const newViews = useMemo(() => newRows.map((row) => ({ row, rowError: validateNewRow(row) })), [newRows]);
  const operationCount = existingViews.filter((view) => view.changed && !view.rowError).length + newViews.filter((view) => !view.rowError).length;
  const invalidCount = existingViews.filter((view) => view.rowError).length + newViews.filter((view) => view.rowError).length;

  function updateExistingRow(scheduleId: string, patch: Partial<ExistingRowState>) {
    setError("");
    setExistingRows((rows) => rows.map((row) => (row.scheduleId === scheduleId ? { ...row, ...patch } : row)));
  }

  function resetExistingRow(scheduleId: string) {
    const schedule = group.schedules.find((candidate) => candidate.id === scheduleId);
    if (!schedule) return;
    updateExistingRow(scheduleId, { date: format(parseISO(schedule.start), "yyyy-MM-dd"), startTime: getTimeHHmm(schedule.start), endTime: getTimeHHmm(schedule.end), remove: false });
  }

  function addNewRow() {
    setError("");
    const lastDate = group.schedules.reduce((latest, schedule) => {
      const date = parseISO(schedule.start);
      return date > latest ? date : latest;
    }, parseISO(group.schedules[0].start));
    const date = addDays(lastDate, 7 * (newRows.length + 1));
    setNewRows((rows) => [
      ...rows,
      {
        tempId: `new-${Date.now()}-${rows.length}`,
        date: format(date, "yyyy-MM-dd"),
        startTime: group.startTime,
        endTime: group.endTime,
      },
    ]);
  }

  function updateNewRow(tempId: string, patch: Partial<NewRowState>) {
    setError("");
    setNewRows((rows) => rows.map((row) => (row.tempId === tempId ? { ...row, ...patch } : row)));
  }

  function removeNewRow(tempId: string) {
    setError("");
    setNewRows((rows) => rows.filter((row) => row.tempId !== tempId));
  }

  function handlePreview() {
    if (operationCount === 0) {
      setError("Add, remove, or change at least one blocker before previewing.");
      return;
    }
    if (invalidCount > 0) {
      setError("Fix invalid blocker rows before previewing.");
      return;
    }

    const operations: BlockerOperation[] = [];
    existingViews.forEach((view) => {
      if (!view.schedule || !view.changed || view.rowError) return;
      if (view.row.remove) {
        operations.push({
          kind: "delete",
          schedule: view.schedule,
          dateLabel: formatScheduleDateLabel(view.schedule.start),
          oldStart: getTimeHHmm(view.schedule.start),
          oldEnd: getTimeHHmm(view.schedule.end),
          beforeMinutes: calculateDurationMinutes(view.schedule.start, view.schedule.end),
        });
        return;
      }

      const updated = buildExistingWindow(view.row);
      operations.push({
        kind: "update",
        schedule: view.schedule,
        dateLabel: formatScheduleDateLabel(view.schedule.start),
        oldStart: getTimeHHmm(view.schedule.start),
        oldEnd: getTimeHHmm(view.schedule.end),
        newDateLabel: formatScheduleDateLabel(updated.newStartIso),
        newStart: getTimeHHmm(updated.newStartIso),
        newEnd: getTimeHHmm(updated.newEndIso),
        newStartIso: updated.newStartIso,
        newEndIso: updated.newEndIso,
        beforeMinutes: calculateDurationMinutes(view.schedule.start, view.schedule.end),
        afterMinutes: calculateDurationMinutes(updated.newStartIso, updated.newEndIso),
      });
    });

    newViews.forEach(({ row, rowError }) => {
      if (rowError) return;
      const payload = buildCreatePayload(row, group.taskId, currentUser.id);
      operations.push({
        kind: "create",
        tempId: row.tempId,
        taskId: group.taskId,
        dateLabel: formatScheduleDateLabel(payload.startDate),
        newStart: getTimeHHmm(payload.startDate),
        newEnd: getTimeHHmm(payload.endDate),
        payload,
        afterMinutes: payload.plannedDuration / 60,
      });
    });

    onPreview(operations);
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
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>x</button>
        </div>

        <div className="preview-summary">
          <span>{group.weekdayLabel} {group.startTime}-{group.endTime}</span>
          <span>{group.schedules.length} current blockers</span>
          <span>{newRows.length} new</span>
          <span>{existingRows.filter((row) => row.remove).length} to unplan</span>
        </div>

        <div className="manual-edit-toolbar">
          <button type="button" className="manual-edit-button" onClick={addNewRow}>Add blocker</button>
        </div>

        <div className="manual-edit-list">
          {existingViews.map((view) => {
            const schedule = view.schedule;
            if (!schedule) return <div key={view.row.scheduleId} className="manual-edit-row has-error"><strong>{view.rowError}</strong></div>;
            const rowClassName = ["manual-edit-row", view.changed ? "is-changed" : "", view.rowError ? "has-error" : "", view.row.remove ? "is-removing" : ""].filter(Boolean).join(" ");
            return (
              <div key={schedule.id} className={rowClassName}>
                <div className="manual-row-date">
                  <strong>{formatScheduleDateLabel(schedule.start)}</strong>
                  <span>{getTimeHHmm(schedule.start)}-{getTimeHHmm(schedule.end)}</span>
                </div>
                <div className="manual-row-fields">
                  <label>Date<input type="date" value={view.row.date} disabled={view.row.remove} onChange={(event) => updateExistingRow(schedule.id, { date: event.target.value })} /></label>
                  <label>Start<input type="time" value={view.row.startTime} disabled={view.row.remove} onChange={(event) => updateExistingRow(schedule.id, { startTime: event.target.value })} /></label>
                  <label>End<input type="time" value={view.row.endTime} disabled={view.row.remove} onChange={(event) => updateExistingRow(schedule.id, { endTime: event.target.value })} /></label>
                  <label className="remove-blocker-check">Unplan<span className="unplan-checkbox-field"><input type="checkbox" checked={view.row.remove} onChange={(event) => updateExistingRow(schedule.id, { remove: event.target.checked })} /></span></label>
                  <button type="button" className="ghost-button manual-reset-button" disabled={!view.changed} onClick={() => resetExistingRow(schedule.id)}>Reset</button>
                </div>
                {view.rowError ? <div className="manual-row-error">{view.rowError}</div> : null}
              </div>
            );
          })}

          {newRows.map((row) => {
            const rowError = validateNewRow(row);
            return (
              <div key={row.tempId} className={["manual-edit-row", "is-new", rowError ? "has-error" : ""].filter(Boolean).join(" ")}>
                <div className="manual-row-date"><strong>New blocker</strong><span>{row.date}</span></div>
                <div className="manual-row-fields">
                  <label>Date<input type="date" value={row.date} onChange={(event) => updateNewRow(row.tempId, { date: event.target.value })} /></label>
                  <label>Start<input type="time" value={row.startTime} onChange={(event) => updateNewRow(row.tempId, { startTime: event.target.value })} /></label>
                  <label>End<input type="time" value={row.endTime} onChange={(event) => updateNewRow(row.tempId, { endTime: event.target.value })} /></label>
                  <button type="button" className="ghost-button manual-reset-button" onClick={() => removeNewRow(row.tempId)}>Remove</button>
                </div>
                {rowError ? <div className="manual-row-error">{rowError}</div> : null}
              </div>
            );
          })}
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onBack}>Back</button>
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" onClick={handlePreview}>Preview {operationCount} change{operationCount === 1 ? "" : "s"}</button>
        </div>
      </div>
    </div>
  );
}

function validateExistingRow(schedule: ScheduleGroup["schedules"][number], row: ExistingRowState, currentUser: AworkUser): string {
  if (!isOwnSchedule(schedule, currentUser)) return "Ownership could not be verified.";
  if (row.remove) return "";
  try {
    const updated = buildExistingWindow(row);
    if (calculateDurationMinutes(updated.newStartIso, updated.newEndIso) <= 0) return "Start must be before end.";
  } catch {
    return "Enter valid date, start, and end.";
  }
  return "";
}

function buildExistingWindow(row: ExistingRowState): { newStartIso: string; newEndIso: string } {
  const payload = buildCreatePayload({ tempId: row.scheduleId, date: row.date, startTime: row.startTime, endTime: row.endTime }, "task", "user");

  return {
    newStartIso: payload.startDate,
    newEndIso: payload.endDate,
  };
}

function validateNewRow(row: NewRowState): string {
  if (!row.date || !row.startTime || !row.endTime) return "Enter date, start, and end.";
  try {
    const payload = buildCreatePayload(row, "task", "user");
    if (payload.plannedDuration <= 0) return "Start must be before end.";
  } catch {
    return "Enter valid date and times.";
  }
  return "";
}

function buildCreatePayload(row: NewRowState, taskId: string, userId: string): CreateTaskSchedulePayload {
  const base = parseISO(row.date);
  if (Number.isNaN(base.getTime())) throw new Error("Invalid date.");
  const start = setTime(base, row.startTime);
  const end = setTime(base, row.endTime);
  return {
    taskId,
    userId,
    startDate: format(start, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    endDate: format(end, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    plannedDuration: Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)),
  };
}

function setTime(date: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return set(date, { hours, minutes, seconds: 0, milliseconds: 0 });
}
