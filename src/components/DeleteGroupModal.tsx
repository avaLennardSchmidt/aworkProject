import type { DeleteResult, ScheduleGroup } from "../types/planner";
import { formatMinutesAsHours, formatScheduleDateLabel, getTimeHHmm } from "../services/scheduleTimeCalculator";

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
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="delete-group-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Unplan group</p>
            <h2 id="delete-group-title">Unplan {group.schedules.length} planned blockers?</h2>
            <p>
              {group.taskName} · {group.projectName ?? "Project not resolved"} · {group.weekdayLabel} {group.startTime}-{group.endTime}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" disabled={isDeleting} onClick={onCancel}>
            x
          </button>
        </div>

        <div className="alert alert-warning">
          This removes the selected planner blockers from the selected user's awork calendar. It does not delete the task or project.
        </div>

        <div className="preview-summary">
          <span>Blockers: {group.schedules.length}</span>
          <span>Total planned: {formatMinutesAsHours(group.totalMinutes)}</span>
          <span>Range: {group.firstDate} to {group.lastDate}</span>
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
            {successCount} blockers unplanned. {failureCount} failed.
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
            Close
          </button>
          <button type="button" className="danger-button" disabled={isDeleting || Boolean(deleteResults)} onClick={onDelete}>
            {isDeleting ? "Unplanning..." : "Unplan blockers"}
          </button>
        </div>
      </div>
    </div>
  );
}
