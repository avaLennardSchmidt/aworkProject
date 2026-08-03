import { format, parseISO } from "date-fns";
import type { AworkTaskSchedule } from "../types/awork";

const MAX_LISTED_OVERLAPS = 6;

/**
 * "Überschneidung mit N Blockern" badge with a hover/focus tooltip that lists
 * WHICH blockers overlap (time, task, project). Used in every preview that
 * warns about overlaps.
 */
export function OverlapBadge({ overlaps }: { overlaps: AworkTaskSchedule[] }) {
  if (overlaps.length === 0) {
    return null;
  }

  const listed = overlaps.slice(0, MAX_LISTED_OVERLAPS);

  return (
    <em className="warning-badge overlap-badge" tabIndex={0}>
      Überschneidung mit {overlaps.length} Blocker
      {overlaps.length === 1 ? "" : "n"}
      <span className="overlap-badge-tooltip" role="tooltip">
        <strong>Überschneidet sich mit:</strong>
        {listed.map((schedule) => (
          <span key={schedule.id} className="overlap-badge-tooltip-row">
            {formatOverlapTime(schedule)} · {schedule.taskName ?? "Blocker"}
            {schedule.projectName ? ` (${schedule.projectName})` : ""}
          </span>
        ))}
        {overlaps.length > listed.length ? (
          <span className="overlap-badge-tooltip-row">
            + {overlaps.length - listed.length} weitere
          </span>
        ) : null}
      </span>
    </em>
  );
}

function formatOverlapTime(schedule: AworkTaskSchedule): string {
  try {
    const start = parseISO(schedule.start);
    const end = parseISO(schedule.end);
    return `${format(start, "dd.MM.")} ${format(start, "HH:mm")}–${format(end, "HH:mm")}`;
  } catch {
    return "";
  }
}
