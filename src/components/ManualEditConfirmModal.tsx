import type { ScheduleGroup } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";
import { ModalShell } from "./ModalShell";

interface ManualEditConfirmModalProps {
  group: ScheduleGroup;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ManualEditConfirmModal({ group, onBack, onCancel, onConfirm }: ManualEditConfirmModalProps) {
  return (
    <ModalShell labelledBy="manual-confirm-title" onClose={onCancel}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Manuelle Bearbeitung</p>
            <h2 id="manual-confirm-title">{group.schedules.length} Blocker einzeln bearbeiten?</h2>
            <p>{group.taskName} · {group.projectName ?? "Projekt nicht aufgelöst"}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Schließen" onClick={onCancel}>
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
    </ModalShell>
  );
}
