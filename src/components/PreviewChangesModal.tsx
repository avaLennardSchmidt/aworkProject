import type { PreviewChange, UpdateResult } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";

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
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Preview</p>
            <h2 id="preview-title">{changes.length} blockers will be changed</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}>
            x
          </button>
        </div>

        <div className="preview-summary">
          <span>Total before: {formatMinutesAsHours(totalBefore)}</span>
          <span>Total after: {formatMinutesAsHours(totalAfter)}</span>
          <span>Difference: {formatMinutesAsHours(totalAfter - totalBefore)}</span>
        </div>

        <div className="preview-list">
          {changes.map((change) => (
            <div key={change.schedule.id} className="preview-row">
              <span>{formatPreviewDate(change.dateLabel, change.newDateLabel)}</span>
              <strong>
                {change.oldStart}-{change.oldEnd} to {change.newStart}-{change.newEnd}
              </strong>
            </div>
          ))}
        </div>

        {updateResults ? (
          <div className={failureCount > 0 ? "alert alert-error" : "alert alert-success"}>
            {successCount} updates succeeded. {failureCount} updates failed.
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
            Back
          </button>
          <button type="button" className="ghost-button" disabled={isUpdating} onClick={onCancel}>
            Close
          </button>
          <button type="button" className="primary-button" disabled={isUpdating || Boolean(updateResults)} onClick={onApply}>
            {isUpdating ? "Applying..." : "Apply changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatPreviewDate(oldDateLabel: string, newDateLabel?: string): string {
  if (!newDateLabel || newDateLabel === oldDateLabel) {
    return oldDateLabel;
  }

  return `${oldDateLabel} to ${newDateLabel}`;
}
