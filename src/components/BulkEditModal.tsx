import { useMemo, useState } from "react";
import { TimePickerInput } from "./TimePickerInput";
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
import { ModalShell } from "./ModalShell";
import { SearchableSelect } from "./SearchableSelect";

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
      return "Diese Gruppe hat keine Blocker.";
    }

    if (group.schedules.some((schedule) => !isOwnSchedule(schedule, currentUser))) {
      return "Berechtigung konnte nicht für jeden Blocker geprüft werden.";
    }

    if (
      group.schedules.some(
        (schedule) => getTimeHHmm(schedule.start) !== group.startTime || getTimeHHmm(schedule.end) !== group.endTime,
      )
    ) {
      return "Die Gruppe hat unterschiedliche Zeitfenster und kann nicht sicher bearbeitet werden.";
    }

    const sample = safeBuildWindow(() => buildUpdatedTimeWindowOnWeekday(group.schedules[0], newStartTime, newEndTime, Number(newWeekday)));
    if (!sample) {
      return "Gültige Werte für Wochentag, Start- und Endzeit eingeben.";
    }

    if (calculateDurationMinutes(sample.newStartIso, sample.newEndIso) <= 0) {
      return "Die neue Startzeit muss vor der neuen Endzeit liegen.";
    }

    return "";
  }

  return (
    <ModalShell labelledBy="bulk-edit-title" onClose={onClose}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Gruppen-Bearbeitung</p>
            <h2 id="bulk-edit-title">{group.taskName}</h2>
            <p>{group.projectName ?? "Kein Projekt im Blocker"}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Schließen" onClick={onClose}>
            x
          </button>
        </div>

        <div className="summary-strip">
          <span>{group.weekdayLabel} {group.startTime}-{group.endTime}</span>
          <span>{group.schedules.length} Blocker</span>
          <span>{formatMinutesAsHours(group.totalMinutes)} vorher</span>
        </div>

        <div className="filter-grid">
          <div className="form-row">
            <label htmlFor="new-weekday">Neuer Wochentag</label>
            <SearchableSelect
              buttonId="new-weekday"
              value={newWeekday}
              options={weekdayOptions.map((day) => ({
                value: String(day.value),
                label: day.label,
              }))}
              placeholder="Wochentag auswählen"
              searchPlaceholder="Wochentage filtern (7 gefunden)"
              emptyLabel="Kein Wochentag gefunden."
              menuWidth="compact"
              onChange={setNewWeekday}
            />
          </div>
          <div className="form-row">
            <label htmlFor="new-start">Neue Startzeit</label>
            <TimePickerInput id="new-start" value={newStartTime} onChange={setNewStartTime} />
          </div>
          <div className="form-row">
            <label htmlFor="new-end">Neue Endzeit</label>
            <TimePickerInput id="new-end" value={newEndTime} onChange={setNewEndTime} />
          </div>
        </div>

        <div className="computed-window">Neues Muster: {computedWindow}</div>
        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="modal-actions modal-actions-split">
          <div className="modal-actions-left">
            <button type="button" className="manual-edit-button" onClick={() => onManualEditRequest(group)}>
              Manuelle Bearbeitung
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

const weekdayOptions = [
  { value: 1, label: "Montag" },
  { value: 2, label: "Dienstag" },
  { value: 3, label: "Mittwoch" },
  { value: 4, label: "Donnerstag" },
  { value: 5, label: "Freitag" },
  { value: 6, label: "Samstag" },
  { value: 0, label: "Sonntag" },
];

function safeBuildWindow(build: () => { newStartIso: string; newEndIso: string }) {
  try {
    return build();
  } catch {
    return null;
  }
}
