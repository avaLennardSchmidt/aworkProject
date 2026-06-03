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
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="bulk-edit-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Gruppen-Bearbeitung</p>
            <h2 id="bulk-edit-title">{group.taskName}</h2>
            <p>{group.projectName ?? "Kein Projekt im Blocker"}</p>
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
            <input id="new-start" type="time" value={newStartTime} onChange={(event) => setNewStartTime(event.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="new-end">Neue Endzeit</label>
            <input id="new-end" type="time" value={newEndTime} onChange={(event) => setNewEndTime(event.target.value)} />
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
              Änderungen vorschauen
            </button>
          </div>
        </div>
      </div>
    </div>
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
