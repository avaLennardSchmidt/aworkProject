import type { BlockerOperation, BlockerOperationResult } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";
import { ModalShell } from "./ModalShell";

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
    <ModalShell labelledBy="operations-preview-title" dialogClassName="modal modal-wide" onClose={isApplying ? undefined : onCancel}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Vorschau</p>
            <h2 id="operations-preview-title">{operations.length} Blocker-Operation{operations.length === 1 ? "" : "en"}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Schließen" onClick={onCancel}>x</button>
        </div>

        <div className="preview-summary">
          <span>{updateCount} Aktualisierung{updateCount === 1 ? "" : "en"}</span>
          <span>{createCount} Hinzufügung{createCount === 1 ? "" : "en"}</span>
          <span>{deleteCount} Ausplanung{deleteCount === 1 ? "" : "en"}</span>
          <span>Vorher: {formatMinutesAsHours(beforeMinutes)}</span>
          <span>Nachher: {formatMinutesAsHours(afterMinutes)}</span>
        </div>

        <div className="preview-list">
          {operations.map((operation) => (
            <div key={operation.kind === "create" ? operation.tempId : operation.schedule.id} className="preview-row">
              <span>{formatOperationDate(operation)}</span>
              <strong>{formatOperation(operation)}</strong>
            </div>
          ))}
        </div>

        {results ? <div className={failureCount > 0 ? "alert alert-error" : "alert alert-success"}>{successCount} erfolgreich. {failureCount} fehlgeschlagen.</div> : null}
        {results && failureCount > 0 ? (
          <ul className="failure-list">
            {results.filter((result) => !result.success).slice(0, 8).map((result) => <li key={result.operationId}>{result.kind}: {result.error}</li>)}
          </ul>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" disabled={isApplying || Boolean(results)} onClick={onBack}>Zurück</button>
          <button type="button" className="ghost-button" disabled={isApplying} onClick={onCancel}>Schließen</button>
          <button type="button" className="primary-button" disabled={isApplying || Boolean(results)} onClick={onApply}>
            {isApplying ? (
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

function formatOperation(operation: BlockerOperation): string {
  if (operation.kind === "delete") return `${operation.oldStart}-${operation.oldEnd} ausplanen`;
  if (operation.kind === "create") return `${operation.newStart}-${operation.newEnd} hinzufügen`;
  return `${operation.oldStart}-${operation.oldEnd} auf ${operation.newStart}-${operation.newEnd} ändern`;
}

function formatOperationDate(operation: BlockerOperation): string {
  if (operation.kind !== "update" || !operation.newDateLabel || operation.newDateLabel === operation.dateLabel) {
    return operation.dateLabel;
  }

  return `${operation.dateLabel} bis ${operation.newDateLabel}`;
}
