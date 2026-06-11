import type { PreviewChange, UpdateResult } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";
import { ModalShell } from "./ModalShell";

interface PreviewChangesModalProps {
  changes: PreviewChange[];
  isUpdating: boolean;
  updateResults?: UpdateResult[];
  onBack: () => void;
  onCancel: () => void;
  onApply: () => void;
}

export function PreviewChangesModal({
  changes,
  isUpdating,
  updateResults,
  onBack,
  onCancel,
  onApply,
}: PreviewChangesModalProps) {
  const totalBefore = changes.reduce((sum, change) => sum + change.beforeMinutes, 0);
  const totalAfter = changes.reduce((sum, change) => sum + change.afterMinutes, 0);
  const successCount = updateResults?.filter((result) => result.success).length ?? 0;
  const failureCount = updateResults?.filter((result) => !result.success).length ?? 0;

  return (
    <ModalShell labelledBy="preview-title" dialogClassName="modal modal-wide" onClose={isUpdating ? undefined : onCancel}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Vorschau</p>
            <h2 id="preview-title">{changes.length} Blocker werden geändert</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Schließen" onClick={onCancel}>
            x
          </button>
        </div>

        <div className="preview-summary">
          <span>Gesamt vorher: {formatMinutesAsHours(totalBefore)}</span>
          <span>Gesamt nachher: {formatMinutesAsHours(totalAfter)}</span>
          <span>Differenz: {formatMinutesAsHours(totalAfter - totalBefore)}</span>
        </div>

        <div className="preview-list">
          {changes.map((change) => (
            <div key={change.schedule.id} className="preview-row">
              <span>{formatPreviewDate(change.dateLabel, change.newDateLabel)}</span>
              <strong>
                {change.oldStart}-{change.oldEnd} auf {change.newStart}-{change.newEnd}
              </strong>
            </div>
          ))}
        </div>

        {updateResults ? (
          <div className={failureCount > 0 ? "alert alert-error" : "alert alert-success"}>
            {successCount} Aktualisierungen erfolgreich. {failureCount} fehlgeschlagen.
          </div>
        ) : null}

        {updateResults && failureCount > 0 ? (
          <ul className="failure-list">
            {updateResults
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
          <button type="button" className="ghost-button" disabled={isUpdating || Boolean(updateResults)} onClick={onBack}>
            Zurück
          </button>
          <button type="button" className="ghost-button" disabled={isUpdating} onClick={onCancel}>
            Schließen
          </button>
          <button type="button" className="primary-button" disabled={isUpdating || Boolean(updateResults)} onClick={onApply}>
            {isUpdating ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                Wird übernommen...
              </>
            ) : (
              "Änderungen übernehmen"
            )}
          </button>
        </div>
    </ModalShell>
  );
}

function formatPreviewDate(oldDateLabel: string, newDateLabel?: string): string {
  if (!newDateLabel || newDateLabel === oldDateLabel) {
    return oldDateLabel;
  }

  return `${oldDateLabel} bis ${newDateLabel}`;
}
