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
          <p>{group.projectName ?? "Kein Projekt im Blocker"}</p>
        </div>
        <div className="time-window">
          {group.weekdayLabel} {group.startTime}-{group.endTime}
        </div>
      </div>

      <dl className="stats-grid">
        <div>
          <dt>Blocker</dt>
          <dd>{group.schedules.length}</dd>
        </div>
        <div>
          <dt>Gesamt</dt>
          <dd>{formatMinutesAsHours(group.totalMinutes)}</dd>
        </div>
        <div>
          <dt>Erster</dt>
          <dd>{group.firstDate}</dd>
        </div>
        <div>
          <dt>Letzter</dt>
          <dd>{group.lastDate}</dd>
        </div>
      </dl>

      <button type="button" className="secondary-button" onClick={() => onChangeTimeWindow(group)}>
        Zeitfenster ändern
      </button>
    </article>
  );
}
