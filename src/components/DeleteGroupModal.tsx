import type { DeleteResult, ScheduleGroup } from "../types/planner";
import { formatMinutesAsHours, formatScheduleDateLabel, getTimeHHmm } from "../services/scheduleTimeCalculator";
import { ModalShell } from "./ModalShell";

interface DeleteGroupModalProps {
  group: ScheduleGroup;
  isDeleting: boolean;
  deleteResults?: DeleteResult[];
  onCancel: () => void;
  onDelete: () => void;
}

export function DeleteGroupModal({ group, isDeleting, deleteResults, onCancel, onDelete }: DeleteGroupModalProps) {
  const successCount = deleteResults?.filter((result) => result.success).length ?? 0;
  const failureCount = deleteResults?.filter((result) => !result.success).length ?? 0;

  return (
    <ModalShell labelledBy="delete-group-title" dialogClassName="modal modal-wide" onClose={isDeleting ? undefined : onCancel}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Gruppe ausplanen</p>
            <h2 id="delete-group-title">Geplante Blocker ausplanen ({group.schedules.length})?</h2>
            <p>
              {group.taskName} · {group.projectName ?? "Projekt nicht aufgelöst"} · {group.weekdayLabel} {group.startTime}-{group.endTime}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Schließen" disabled={isDeleting} onClick={onCancel}>
            x
          </button>
        </div>

        <div className="alert alert-warning">
          Die ausgewählten Planner-Blocker werden aus dem awork-Kalender des Nutzers entfernt. Aufgabe und Projekt bleiben erhalten.
        </div>

        <div className="preview-summary">
          <span>Blocker: {group.schedules.length}</span>
          <span>Gesamt geplant: {formatMinutesAsHours(group.totalMinutes)}</span>
          <span>Zeitraum: {group.firstDate} bis {group.lastDate}</span>
        </div>

        <div className="preview-list">
          {group.schedules.map((schedule) => (
            <div key={schedule.id} className="preview-row">
              <span>{formatScheduleDateLabel(schedule.start)}</span>
              <strong>
                {getTimeHHmm(schedule.start)}-{getTimeHHmm(schedule.end)}
              </strong>
            </div>
          ))}
        </div>

        {deleteResults ? (
          <div className={failureCount > 0 ? "alert alert-error" : "alert alert-success"}>
            {successCount} Blocker ausgeplant. {failureCount} fehlgeschlagen.
          </div>
        ) : null}

        {deleteResults && failureCount > 0 ? (
          <ul className="failure-list">
            {deleteResults
              .filter((result) => !result.success)
              .slice(0, 8)
              .map((result) => (
                <li key={result.scheduleId}>
                  {result.scheduleId}: {result.error}
                </li>
              ))}
          </ul>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" disabled={isDeleting} onClick={onCancel}>
            Schließen
          </button>
          <button type="button" className="danger-button" disabled={isDeleting || Boolean(deleteResults)} onClick={onDelete}>
            {isDeleting ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                Wird ausgeplant...
              </>
            ) : (
              "Blocker ausplanen"
            )}
          </button>
        </div>
    </ModalShell>
  );
}
