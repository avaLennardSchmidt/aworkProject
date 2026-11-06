import { addDays, format, getISOWeek, parseISO, set } from "date-fns";
import { DatePickerInput } from "./DatePickerInput";
import { TimePickerInput } from "./TimePickerInput";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { de } from "date-fns/locale";
import { SearchableSelect } from "./SearchableSelect";
import type { AworkUser, CreateTaskSchedulePayload } from "../types/awork";
import type { BlockerOperation, ScheduleGroup } from "../types/planner";
import { isOwnSchedule } from "../services/scheduleMapper";
import { ModalShell } from "./ModalShell";
import {
  calculateDurationMinutes,
  formatScheduleDateLabel,
  getTimeHHmm,
} from "../services/scheduleTimeCalculator";

interface ManualBlockerEditModalProps {
  group: ScheduleGroup;
  currentUser: AworkUser;
  /** Rows to restore when the user comes back from the preview. */
  initialState?: ManualEditState;
  onBack: () => void;
  onClose: () => void;
  onPreview: (operations: BlockerOperation[], state: ManualEditState) => void;
}

export interface ManualEditState {
  existingRows: ExistingRowState[];
  newRows: NewRowState[];
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

export function ManualBlockerEditModal({
  group,
  currentUser,
  initialState,
  onBack,
  onClose,
  onPreview,
}: ManualBlockerEditModalProps) {
  const [existingRows, setExistingRows] = useState<ExistingRowState[]>(() =>
    initialState?.existingRows ??
    group.schedules.map((schedule) => ({
      scheduleId: schedule.id,
      date: format(parseISO(schedule.start), "yyyy-MM-dd"),
      startTime: getTimeHHmm(schedule.start),
      endTime: getTimeHHmm(schedule.end),
      remove: false,
    })),
  );
  const [newRows, setNewRows] = useState<NewRowState[]>(
    initialState?.newRows ?? [],
  );
  const [bulkCount, setBulkCount] = useState("4");
  const [bulkInterval, setBulkInterval] = useState("1");
  const [error, setError] = useState("");

  const existingViews = useMemo(
    () =>
      existingRows.map((row) => {
        const schedule = group.schedules.find(
          (candidate) => candidate.id === row.scheduleId,
        );
        if (!schedule)
          return {
            row,
            schedule: undefined,
            changed: false,
            rowError: "Schedule not found.",
          };

        const oldDate = format(parseISO(schedule.start), "yyyy-MM-dd");
        const oldStart = getTimeHHmm(schedule.start);
        const oldEnd = getTimeHHmm(schedule.end);
        const changed =
          row.remove ||
          row.date !== oldDate ||
          row.startTime !== oldStart ||
          row.endTime !== oldEnd;
        return {
          row,
          schedule,
          changed,
          rowError: changed
            ? validateExistingRow(schedule, row, currentUser)
            : "",
        };
      }),
    [currentUser, existingRows, group.schedules],
  );
  const newViews = useMemo(
    () => newRows.map((row) => ({ row, rowError: validateNewRow(row) })),
    [newRows],
  );
  const operationCount =
    existingViews.filter((view) => view.changed && !view.rowError).length +
    newViews.filter((view) => !view.rowError).length;
  const invalidCount =
    existingViews.filter((view) => view.rowError).length +
    newViews.filter((view) => view.rowError).length;

  function updateExistingRow(
    scheduleId: string,
    patch: Partial<ExistingRowState>,
  ) {
    setError("");
    setExistingRows((rows) =>
      rows.map((row) =>
        row.scheduleId === scheduleId ? { ...row, ...patch } : row,
      ),
    );
  }

  function resetExistingRow(scheduleId: string) {
    const schedule = group.schedules.find(
      (candidate) => candidate.id === scheduleId,
    );
    if (!schedule) return;
    updateExistingRow(scheduleId, {
      date: format(parseISO(schedule.start), "yyyy-MM-dd"),
      startTime: getTimeHHmm(schedule.start),
      endTime: getTimeHHmm(schedule.end),
      remove: false,
    });
  }

  /** Appends `count` blockers after the latest one, `intervalWeeks` apart. */
  function addNewRows(count: number, intervalWeeks: number) {
    setError("");
    setNewRows((rows) => [
      ...rows,
      ...buildFollowingDates(existingRows, rows, count, intervalWeeks).map(
        (date, index) => ({
          tempId: `new-${Date.now()}-${rows.length + index}`,
          date,
          startTime: group.startTime,
          endTime: group.endTime,
        }),
      ),
    ]);
  }

  function updateNewRow(tempId: string, patch: Partial<NewRowState>) {
    setError("");
    setNewRows((rows) =>
      rows.map((row) => (row.tempId === tempId ? { ...row, ...patch } : row)),
    );
  }

  function removeNewRow(tempId: string) {
    setError("");
    setNewRows((rows) => rows.filter((row) => row.tempId !== tempId));
  }

  function handlePreview() {
    if (operationCount === 0) {
      setError("Mindestens einen Blocker hinzufügen, entfernen oder ändern.");
      return;
    }
    if (invalidCount > 0) {
      setError("Ungültige Blocker-Zeilen vor der Vorschau korrigieren.");
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
          beforeMinutes: calculateDurationMinutes(
            view.schedule.start,
            view.schedule.end,
          ),
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
        beforeMinutes: calculateDurationMinutes(
          view.schedule.start,
          view.schedule.end,
        ),
        afterMinutes: calculateDurationMinutes(
          updated.newStartIso,
          updated.newEndIso,
        ),
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

    onPreview(operations, { existingRows, newRows });
  }

  const changedCount = existingViews.filter(
    (view) => view.changed && !view.row.remove,
  ).length;
  const removedCount = existingRows.filter((row) => row.remove).length;
  const bulkCountValue = Math.min(52, Math.max(0, Math.floor(Number(bulkCount)) || 0));
  const bulkDates = buildFollowingDates(
    existingRows,
    newRows,
    bulkCountValue,
    Number(bulkInterval),
  );

  return (
    <ModalShell
      labelledBy="manual-edit-title"
      dialogClassName="modal series-edit-modal manual-edit-modal"
      onClose={onClose}
    >
      <div className="modal-header">
        <div>
          <button type="button" className="series-edit-back" onClick={onBack}>
            ← Zurück zur Serie
          </button>
          <p className="series-edit-eyebrow">Einzeln bearbeiten</p>
          <h2 id="manual-edit-title">{group.taskName}</h2>
          <p>
            {group.projectName ?? "Projekt nicht aufgelöst"} · {group.weekdayLabel}{" "}
            {group.startTime}–{group.endTime}
          </p>
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

      <p className="manual-summary">
        <strong>{group.schedules.length} Blocker</strong>
        {changedCount > 0 ? (
          <span className="is-accent"> · {changedCount} geändert</span>
        ) : null}
        {removedCount > 0 ? (
          <span className="is-danger"> · {removedCount} ausgeplant</span>
        ) : null}
        {newRows.length > 0 ? (
          <span className="is-accent"> · {newRows.length} neu</span>
        ) : null}
      </p>

      <div className="manual-table-wrap">
        <table className="manual-table">
          <thead>
            <tr>
              <th>KW</th>
              <th>Datum</th>
              <th>Start</th>
              <th>Ende</th>
              <th aria-label="Aktionen" />
            </tr>
          </thead>
          <tbody>
            {existingViews.map((view) => {
              const schedule = view.schedule;
              if (!schedule)
                return (
                  <tr key={view.row.scheduleId} className="has-error">
                    <td colSpan={5}>{view.rowError}</td>
                  </tr>
                );
              const oldDate = format(parseISO(schedule.start), "yyyy-MM-dd");
              const oldStart = getTimeHHmm(schedule.start);
              const oldEnd = getTimeHHmm(schedule.end);
              const rowClassName = [
                view.row.remove ? "is-removed" : "",
                view.rowError && !view.row.remove ? "has-error" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <Fragment key={schedule.id}>
                <tr className={rowClassName}>
                  <td className="manual-kw">KW {weekOf(view.row.date)}</td>
                  <td>
                    <ManualCell
                      changed={!view.row.remove && view.row.date !== oldDate}
                      previous={formatShort(oldDate)}
                      weekday={weekdayShort(view.row.date)}
                    >
                      <DatePickerInput
                        value={view.row.date}
                        disabled={view.row.remove}
                        highlightWeekday={group.weekday}
                        onChange={(val) =>
                          updateExistingRow(schedule.id, { date: val })
                        }
                      />
                    </ManualCell>
                  </td>
                  <td>
                    <ManualCell
                      changed={!view.row.remove && view.row.startTime !== oldStart}
                      previous={oldStart}
                    >
                      <TimePickerInput
                        value={view.row.startTime}
                        disabled={view.row.remove}
                        onChange={(val) =>
                          updateExistingRow(schedule.id, { startTime: val })
                        }
                      />
                    </ManualCell>
                  </td>
                  <td>
                    <ManualCell
                      changed={!view.row.remove && view.row.endTime !== oldEnd}
                      previous={oldEnd}
                    >
                      <TimePickerInput
                        value={view.row.endTime}
                        disabled={view.row.remove}
                        onChange={(val) =>
                          updateExistingRow(schedule.id, { endTime: val })
                        }
                      />
                    </ManualCell>
                  </td>
                  <td className="manual-actions">
                    {view.row.remove ? (
                      <button
                        type="button"
                        className="series-edit-link is-danger"
                        onClick={() =>
                          updateExistingRow(schedule.id, { remove: false })
                        }
                      >
                        Rückgängig
                      </button>
                    ) : (
                      <>
                        {view.changed ? (
                          <button
                            type="button"
                            className="manual-icon-button is-accent"
                            title="Zurücksetzen"
                            aria-label="Zurücksetzen"
                            onClick={() => resetExistingRow(schedule.id)}
                          >
                            <ResetIcon />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="manual-icon-button"
                          title="Blocker ausplanen"
                          aria-label="Blocker ausplanen"
                          onClick={() =>
                            updateExistingRow(schedule.id, { remove: true })
                          }
                        >
                          <TrashIcon />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {view.rowError && !view.row.remove ? (
                  <tr className="manual-error-row">
                    <td colSpan={5}>{view.rowError}</td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}

            {newRows.map((row) => {
              const rowError = validateNewRow(row);
              return (
                <Fragment key={row.tempId}>
                <tr
                  className={["is-new", rowError ? "has-error" : ""]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td className="manual-kw">KW {weekOf(row.date)}</td>
                  <td>
                    <ManualCell isNew weekday={weekdayShort(row.date)}>
                      <DatePickerInput
                        value={row.date}
                        highlightWeekday={group.weekday}
                        onChange={(val) => updateNewRow(row.tempId, { date: val })}
                      />
                    </ManualCell>
                  </td>
                  <td>
                    <ManualCell isNew>
                      <TimePickerInput
                        value={row.startTime}
                        onChange={(val) =>
                          updateNewRow(row.tempId, { startTime: val })
                        }
                      />
                    </ManualCell>
                  </td>
                  <td>
                    <ManualCell isNew>
                      <TimePickerInput
                        value={row.endTime}
                        onChange={(val) =>
                          updateNewRow(row.tempId, { endTime: val })
                        }
                      />
                    </ManualCell>
                  </td>
                  <td className="manual-actions">
                    <button
                      type="button"
                      className="manual-icon-button"
                      title="Neuen Blocker entfernen"
                      aria-label="Neuen Blocker entfernen"
                      onClick={() => removeNewRow(row.tempId)}
                    >
                      <CrossIcon />
                    </button>
                  </td>
                </tr>
                {rowError ? (
                  <tr className="manual-error-row">
                    <td colSpan={5}>{rowError}</td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="manual-add">
        <button
          type="button"
          className="manual-add-one"
          onClick={() => addNewRows(1, 1)}
        >
          + 1 Blocker
        </button>
        <span className="manual-add-or">oder</span>
        <div className="manual-add-many">
          <input
            type="number"
            min="1"
            max="52"
            step="1"
            inputMode="numeric"
            aria-label="Anzahl Blocker"
            value={bulkCount}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setBulkCount(event.target.value)}
          />
          <span>Blocker</span>
          <div className="manual-add-interval">
            <SearchableSelect
              value={bulkInterval}
              options={INTERVAL_OPTIONS}
              placeholder="Rhythmus"
              searchPlaceholder="Rhythmus filtern"
              emptyLabel="Kein Rhythmus gefunden."
              menuWidth="compact"
              onChange={setBulkInterval}
            />
          </div>
          <button
            type="button"
            className="primary-button manual-add-submit"
            disabled={bulkDates.length === 0}
            onClick={() => addNewRows(bulkCountValue, Number(bulkInterval))}
          >
            Hinzufügen
          </button>
        </div>
        {bulkDates.length > 0 ? (
          <p className="manual-add-hint">
            Fügt an: <strong>{formatDateList(bulkDates, group.weekday)}</strong> ·{" "}
            {group.startTime}–{group.endTime} · danach einzeln anpassbar
          </p>
        ) : null}
      </div>

      {error ? <div className="alert alert-error series-edit-error">{error}</div> : null}

      <div className="series-edit-footer">
        <div />
        <div className="series-edit-footer-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={operationCount === 0}
            onClick={handlePreview}
          >
            {operationCount === 1
              ? "1 Änderung prüfen"
              : `${operationCount} Änderungen prüfen`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

const INTERVAL_OPTIONS = [
  { value: "1", label: "jede Woche" },
  { value: "2", label: "alle 2 Wochen" },
  { value: "4", label: "alle 4 Wochen" },
];

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/**
 * Table cell around a date or time picker. Shows the previous value crossed
 * out when the row was edited, and an optional weekday prefix for dates.
 */
function ManualCell({
  changed = false,
  isNew = false,
  previous,
  weekday,
  children,
}: {
  changed?: boolean;
  isNew?: boolean;
  previous?: string;
  weekday?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        "manual-cell",
        changed ? "is-changed" : "",
        isNew ? "is-new" : "",
        weekday ? "has-weekday" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {weekday ? <span className="manual-cell-weekday">{weekday}</span> : null}
      {children}
      {isNew && weekday ? <span className="manual-cell-badge">neu</span> : null}
      {changed && previous ? (
        <span className="manual-cell-previous">{previous}</span>
      ) : null}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.7h2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 4.5l7 7M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Dates for `count` new blockers, `intervalWeeks` apart, starting after the
 * latest blocker that is kept or already added.
 */
function buildFollowingDates(
  existingRows: ExistingRowState[],
  newRows: NewRowState[],
  count: number,
  intervalWeeks: number,
): string[] {
  const dates = [
    ...existingRows.filter((row) => !row.remove).map((row) => row.date),
    ...newRows.map((row) => row.date),
  ].filter(Boolean);
  if (dates.length === 0 || count <= 0) return [];
  const latest = dates.reduce((max, date) => (date > max ? date : max));
  const step = Math.max(1, intervalWeeks) * 7;
  return Array.from({ length: count }, (_, index) =>
    format(addDays(parseISO(latest), step * (index + 1)), "yyyy-MM-dd"),
  );
}

function weekOf(date: string): string {
  const parsed = parseISO(date);
  return Number.isNaN(parsed.getTime()) ? "–" : String(getISOWeek(parsed));
}

function weekdayShort(date: string): string {
  const parsed = parseISO(date);
  return Number.isNaN(parsed.getTime()) ? "" : WEEKDAY_SHORT[parsed.getDay()];
}

function formatShort(date: string): string {
  return format(parseISO(date), "dd.MM.", { locale: de });
}

/** "Di 05.01., 12.01., 19.01.2027" — the year only on the last date. */
function formatDateList(dates: string[], weekday: number): string {
  const prefix = WEEKDAY_SHORT[weekday] ?? "";
  return `${prefix} ${dates
    .map((date, index) =>
      format(parseISO(date), index === dates.length - 1 ? "dd.MM.yyyy" : "dd.MM."),
    )
    .join(", ")}`;
}

function validateExistingRow(
  schedule: ScheduleGroup["schedules"][number],
  row: ExistingRowState,
  currentUser: AworkUser,
): string {
  if (!isOwnSchedule(schedule, currentUser))
    return "Berechtigung konnte nicht geprüft werden.";
  if (row.remove) return "";
  try {
    const updated = buildExistingWindow(row);
    if (calculateDurationMinutes(updated.newStartIso, updated.newEndIso) <= 0)
      return "Start muss vor Ende liegen.";
  } catch {
    return "Gültiges Datum, Start und Ende eingeben.";
  }
  return "";
}

function buildExistingWindow(row: ExistingRowState): {
  newStartIso: string;
  newEndIso: string;
} {
  const payload = buildCreatePayload(
    {
      tempId: row.scheduleId,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
    },
    "task",
    "user",
  );

  return {
    newStartIso: payload.startDate,
    newEndIso: payload.endDate,
  };
}

function validateNewRow(row: NewRowState): string {
  if (!row.date || !row.startTime || !row.endTime)
    return "Datum, Start und Ende eingeben.";
  try {
    const payload = buildCreatePayload(row, "task", "user");
    if (payload.plannedDuration <= 0) return "Start muss vor Ende liegen.";
  } catch {
    return "Gültiges Datum und Zeiten eingeben.";
  }
  return "";
}

function buildCreatePayload(
  row: NewRowState,
  taskId: string,
  userId: string,
): CreateTaskSchedulePayload {
  const base = parseISO(row.date);
  if (Number.isNaN(base.getTime())) throw new Error("Invalid date.");
  const start = setTime(base, row.startTime);
  const end = setTime(base, row.endTime);
  return {
    taskId,
    userId,
    startDate: format(start, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    endDate: format(end, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    plannedDuration: Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 1000),
    ),
  };
}

function setTime(date: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return set(date, { hours, minutes, seconds: 0, milliseconds: 0 });
}
