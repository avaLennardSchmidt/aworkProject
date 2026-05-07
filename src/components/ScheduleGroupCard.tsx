import type { ScheduleGroup } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";

interface ScheduleGroupCardProps {
  group: ScheduleGroup;
  onChangeTimeWindow: (group: ScheduleGroup) => void;
}

export function ScheduleGroupCard({ group, onChangeTimeWindow }: ScheduleGroupCardProps) {
  return (
    <article className="group-card">
      <div className="group-main">
        <div>
          <h3>{group.taskName}</h3>
          <p>{group.projectName ?? "No project in schedule response"}</p>
        </div>
        <div className="time-window">
          {group.weekdayLabel} {group.startTime}-{group.endTime}
        </div>
      </div>

      <dl className="stats-grid">
        <div>
          <dt>Blockers</dt>
          <dd>{group.schedules.length}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{formatMinutesAsHours(group.totalMinutes)}</dd>
        </div>
        <div>
          <dt>First</dt>
          <dd>{group.firstDate}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd>{group.lastDate}</dd>
        </div>
      </dl>

      <button type="button" className="secondary-button" onClick={() => onChangeTimeWindow(group)}>
        Change time window
      </button>
    </article>
  );
}
