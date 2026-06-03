import type { ScheduleGroup } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";

interface ManualEditConfirmModalProps {
  group: ScheduleGroup;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ManualEditConfirmModal({ group, onBack, onCancel, onConfirm }: ManualEditConfirmModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="manual-confirm-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Manuelle Bearbeitung</p>
            <h2 id="manual-confirm-title">{group.schedules.length} Blocker einzeln bearbeiten?</h2>
            <p>{group.taskName} · {group.projectName ?? "Projekt nicht aufgelöst"}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}>
            x
          </button>
        </div>

        <div className="preview-summary">
          <span>{group.weekdayLabel} {group.startTime}-{group.endTime}</span>
          <span>{group.schedules.length} Blocker</span>
          <span>{formatMinutesAsHours(group.totalMinutes)} vorher</span>
        </div>

        <div className="alert alert-warning">
          Du wechselst von der Gruppenbearbeitung zur manuellen Bearbeitung. Alle Blocker werden angezeigt, aber nur geänderte Zeilen werden aktualisiert.
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            Zurück
          </button>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="button" className="primary-button" onClick={onConfirm}>
            Blocker manuell bearbeiten
          </button>
        </div>
      </div>
    </div>
  );
}
