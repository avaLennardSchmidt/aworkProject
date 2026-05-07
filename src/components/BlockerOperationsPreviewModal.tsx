import type { BlockerOperation, BlockerOperationResult } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";

interface BlockerOperationsPreviewModalProps {
  operations: BlockerOperation[];
  isApplying: boolean;
  results?: BlockerOperationResult[];
  onBack: () => void;
  onCancel: () => void;
  onApply: () => void;
}

export function BlockerOperationsPreviewModal({ operations, isApplying, results, onBack, onCancel, onApply }: BlockerOperationsPreviewModalProps) {
  const updateCount = operations.filter((operation) => operation.kind === "update").length;
  const createCount = operations.filter((operation) => operation.kind === "create").length;
  const deleteCount = operations.filter((operation) => operation.kind === "delete").length;
  const beforeMinutes = operations.reduce((sum, operation) => sum + (operation.kind === "create" ? 0 : operation.beforeMinutes), 0);
  const afterMinutes = operations.reduce((sum, operation) => {
    if (operation.kind === "delete") return sum;
    return sum + operation.afterMinutes;
  }, 0);
  const successCount = results?.filter((result) => result.success).length ?? 0;
  const failureCount = results?.filter((result) => !result.success).length ?? 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="operations-preview-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Preview</p>
            <h2 id="operations-preview-title">{operations.length} blocker operation{operations.length === 1 ? "" : "s"}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}>x</button>
        </div>

        <div className="preview-summary">
          <span>{updateCount} update</span>
          <span>{createCount} add</span>
          <span>{deleteCount} unplan</span>
          <span>Before: {formatMinutesAsHours(beforeMinutes)}</span>
          <span>After: {formatMinutesAsHours(afterMinutes)}</span>
        </div>

        <div className="preview-list">
          {operations.map((operation) => (
            <div key={operation.kind === "create" ? operation.tempId : operation.schedule.id} className="preview-row">
              <span>{formatOperationDate(operation)}</span>
              <strong>{formatOperation(operation)}</strong>
            </div>
          ))}
        </div>

        {results ? <div className={failureCount > 0 ? "alert alert-error" : "alert alert-success"}>{successCount} succeeded. {failureCount} failed.</div> : null}
        {results && failureCount > 0 ? (
          <ul className="failure-list">
            {results.filter((result) => !result.success).slice(0, 8).map((result) => <li key={result.operationId}>{result.kind}: {result.error}</li>)}
          </ul>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" disabled={isApplying || Boolean(results)} onClick={onBack}>Back</button>
          <button type="button" className="ghost-button" disabled={isApplying} onClick={onCancel}>Close</button>
          <button type="button" className="primary-button" disabled={isApplying || Boolean(results)} onClick={onApply}>{isApplying ? "Applying..." : "Apply changes"}</button>
        </div>
      </div>
    </div>
  );
}

function formatOperation(operation: BlockerOperation): string {
  if (operation.kind === "delete") return `Unplan ${operation.oldStart}-${operation.oldEnd}`;
  if (operation.kind === "create") return `Add ${operation.newStart}-${operation.newEnd}`;
  return `Update ${operation.oldStart}-${operation.oldEnd} to ${operation.newStart}-${operation.newEnd}`;
}

function formatOperationDate(operation: BlockerOperation): string {
  if (operation.kind !== "update" || !operation.newDateLabel || operation.newDateLabel === operation.dateLabel) {
    return operation.dateLabel;
  }

  return `${operation.dateLabel} to ${operation.newDateLabel}`;
}
