import { addMinutes, format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { TimePickerInput } from "./TimePickerInput";
import type { AworkUser } from "../types/awork";
import type {
  BlockerOperation,
  PreviewChange,
  ScheduleGroup,
} from "../types/planner";
import { isOwnSchedule } from "../services/scheduleMapper";
import { ModalShell } from "./ModalShell";
import { SearchableSelect } from "./SearchableSelect";
import { SegmentedControl } from "./SegmentedControl";
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
  { value: "delta", label: "Dauer anpassen" },
  { value: "shift", label: "Datum verschieben" },
  { value: "set-window", label: "Zeitfenster setzen" },
] as const;

const durationDirectionOptions = [
  { value: "add", label: "Verlängern" },
  { value: "remove", label: "Verkürzen" },
] as const;

const moveDirectionOptions = [
  { value: "add", label: "Vorziehen" },
  { value: "remove", label: "Später legen" },
] as const;

const weekdayOptions = [
  { value: 1, label: "Montag" },
  { value: 2, label: "Dienstag" },
  { value: 3, label: "Mittwoch" },
  { value: 4, label: "Donnerstag" },
  { value: 5, label: "Freitag" },
  { value: 6, label: "Samstag" },
  { value: 0, label: "Sonntag" },
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
        throw new Error("Ungültige aktualisierte Blocker-Werte.");
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
    if (groups.length === 0) return "Mindestens eine Gruppe auswählen.";
    if (schedules.length === 0) return "Die ausgewählten Gruppen haben keine Blocker.";
    if (schedules.some((schedule) => !isOwnSchedule(schedule, currentUser))) {
      return "Berechtigung konnte nicht für jeden Blocker geprüft werden.";
    }

    if (isDurationEditMode && deltaMinutes === 0 && !effectiveWeekdayOverride) {
      return editMode === "shift"
        ? "Einen Zeitversatz zum Verschieben eingeben."
        : "Eine Dauer zum Hinzufügen/Entfernen eingeben oder einen neuen Wochentag wählen.";
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
      return "Die ausgewählten Blocker verwenden bereits dieses Zeitfenster.";
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
        return "Die neue Startzeit muss vor der neuen Endzeit liegen.";
      }

      return editMode === "shift"
        ? "Das Verschieben führte zu einem ungültigen Zeitbereich."
        : "Das Entfernen dieser Zeit würde mindestens einen Blocker ungültig machen.";
    }

    return "";
  }

  function validateUnplan(): string {
    if (groups.length === 0) return "Mindestens eine Gruppe auswählen.";
    if (schedules.length === 0) return "Die ausgewählten Gruppen haben keine Blocker.";
    if (schedules.some((schedule) => !isOwnSchedule(schedule, currentUser))) {
      return "Berechtigung konnte nicht für jeden Blocker geprüft werden.";
    }
    return "";
  }

  return (
    <ModalShell labelledBy="multi-duration-title" dialogClassName="modal multi-edit-modal" onClose={onClose}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Mehrfach-Bearbeitung</p>
            <h2 id="multi-duration-title">Ausgewählte Gruppen anpassen</h2>
            <p>
              {groups.length} Gruppen · {schedules.length} Blocker
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

        <div className="summary-strip">
          <span>{formatMinutesAsHours(totalBeforeMinutes)} vorher</span>
          {editMode === "delta" ? (
            <span>
              {deltaMinutes >= 0 ? "+" : ""}
              {formatMinutesAsHours(deltaMinutes)} pro Blocker
            </span>
          ) : editMode === "shift" ? (
            <span>
              {direction === "add" ? "Vorziehen" : "Nach hinten verschieben"}{" "}
              {formatMinutesAsHours(Math.abs(deltaMinutes))} pro Blocker
            </span>
          ) : (
            <span>
              {windowStartTime}-{windowEndTime} pro Blocker
            </span>
          )}
          <span>{formatMinutesAsHours(totalAfterMinutes)} nachher</span>
        </div>

        <div className="multi-edit-mode-switch">
          <label>Modus</label>
          <SegmentedControl
            value={editMode}
            options={[...editModeOptions]}
            ariaLabel="Mehrfach-Bearbeitungsmodus"
            onChange={(value) => setEditMode(value as EditMode)}
          />
        </div>

        <div className="multi-edit-grid">
          <div className="multi-edit-row multi-edit-row-top">
            {isDurationEditMode ? (
              <div className="form-row form-row-full multi-edit-panel">
                <label>
                  {editMode === "shift"
                    ? "Wie sollen die Blocker verschoben werden?"
                    : "Wie soll die Dauer geändert werden?"}
                </label>
                <SegmentedControl
                  value={direction}
                  options={[
                    ...(editMode === "shift"
                      ? moveDirectionOptions
                      : durationDirectionOptions),
                  ]}
                  ariaLabel="Art der Änderung"
                  onChange={(value) => setDirection(value as Direction)}
                />
              </div>
            ) : (
              <>
                <div className="form-row multi-edit-panel">
                  <label htmlFor="multi-window-start">Startzeit</label>
                  <TimePickerInput
                    id="multi-window-start"
                    value={windowStartTime}
                    onChange={setWindowStartTime}
                  />
                </div>
                <div className="form-row multi-edit-panel">
                  <label htmlFor="multi-window-end">Endzeit</label>
                  <TimePickerInput
                    id="multi-window-end"
                    value={windowEndTime}
                    onChange={setWindowEndTime}
                  />
                </div>
              </>
            )}
          </div>

          {isDurationEditMode ? (
            <div className="multi-edit-row multi-edit-row-duration">
              <div className="form-row multi-edit-panel">
                <label htmlFor="multi-days">
                  {editMode === "shift"
                    ? "Kalendertage"
                    : "Tage"}
                </label>
                <div className="multi-edit-input-box">
                  <input
                    id="multi-days"
                    type="number"
                    min="0"
                    step="1"
                    value={days}
                    onChange={(event) => setDays(event.target.value)}
                  />
                </div>
                <p className="multi-edit-helper">
                  {editMode === "shift"
                    ? "Ändert das Datum um ganze Kalendertage, nicht einfach plus 24 Stunden."
                    : "Optionaler Tagesanteil fuer die Aenderung pro Blocker."}
                </p>
              </div>
              <div className="form-row multi-edit-panel">
                <label htmlFor="multi-hours">Stunden</label>
                <div className="multi-edit-input-box">
                  <input
                    id="multi-hours"
                    type="number"
                    min="0"
                    step="1"
                    value={hours}
                    onChange={(event) => setHours(event.target.value)}
                  />
                </div>
              </div>
              <div className="form-row multi-edit-panel">
                <label htmlFor="multi-minutes">Minuten</label>
                <div className="multi-edit-input-box">
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
            </div>
          ) : null}

          {editMode !== "shift" ? (
            <div className="multi-edit-row multi-edit-row-weekday">
              <div className="form-row multi-edit-panel">
                <label htmlFor="multi-weekday">Neuer Wochentag</label>
                <SearchableSelect
                  buttonId="multi-weekday"
                  value={weekdayOverride}
                  options={[
                    { value: "", label: "Aktuelle Wochentage behalten" },
                    ...weekdayOptions.map((day) => ({
                      value: String(day.value),
                      label: day.label,
                    })),
                  ]}
                  placeholder="Wochentag auswählen"
                  searchPlaceholder="Wochentage filtern (8 gefunden)"
                  emptyLabel="Kein Wochentag gefunden."
                  menuWidth="compact"
                  onChange={setWeekdayOverride}
                />
                <p className="multi-edit-helper">
                  Wenn gesetzt, werden die Blocker auf diesen Wochentag gelegt.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {effectiveWeekdayOverride ? (
          <p className="modal-note">
            Alle ausgewählten Blocker werden auf denselben Wochentag verschoben.
          </p>
        ) : null}

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="modal-actions modal-actions-split">
          <div className="modal-actions-left">
            <button
              type="button"
              className="danger-button unplan-selected-button"
              onClick={handleUnplanPreview}
            >
              Ausplanen
            </button>
          </div>
          <div className="modal-actions-right">
            <button type="button" className="ghost-button" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="primary-button" onClick={handlePreview}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M3 9l4.5 4.5L15 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Vorschau
            </button>
          </div>
        </div>
    </ModalShell>
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
