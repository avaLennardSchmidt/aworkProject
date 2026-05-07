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
            <p className="eyebrow">Manual edit</p>
            <h2 id="manual-confirm-title">Edit {group.schedules.length} blockers individually?</h2>
            <p>{group.taskName} · {group.projectName ?? "Project not resolved"}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}>
            x
          </button>
        </div>

        <div className="preview-summary">
          <span>{group.weekdayLabel} {group.startTime}-{group.endTime}</span>
          <span>{group.schedules.length} blockers</span>
          <span>{formatMinutesAsHours(group.totalMinutes)} before</span>
        </div>

        <div className="alert alert-warning">
          You are switching from bulk editing to manual editing. Every blocker will be listed, but only rows where you change the time will be updated.
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            Back
          </button>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onConfirm}>
            Edit blockers manually
          </button>
        </div>
      </div>
    </div>
  );
}
