import { motion } from "motion/react";
import type { AworkUser } from "../../types/awork";
import type { DeadlineRisk } from "../../services/capacityModel";
import {
  formatHours,
  formatUserName,
} from "../../services/capacityFormat";

export function DeadlineOverviewPanel({
  user,
  deadlines,
  onSelect,
  onClose,
}: {
  user: AworkUser;
  deadlines: DeadlineRisk[];
  onSelect: (deadline: DeadlineRisk) => void;
  onClose: () => void;
}) {
  const thisWeek = deadlines.filter(
    (deadline) => deadline.urgency === "this-week",
  );
  const nextWeek = deadlines.filter(
    (deadline) => deadline.urgency === "next-week",
  );

  return (
    <motion.aside
      className="week-detail-panel deadline-overview-panel"
      role="dialog"
      aria-label={`Fällige Termine von ${formatUserName(user)}`}
      initial={{ x: 48, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <div className="week-detail-head">
        <div>
          <p className="eyebrow">Fällige Termine</p>
          <h3>{formatUserName(user)}</h3>
          <p className="week-detail-meta">
            {deadlines.length} {deadlines.length === 1 ? "Termin" : "Termine"}
            {thisWeek.length > 0 ? ` · ${thisWeek.length} diese Woche` : ""}
            {nextWeek.length > 0 ? ` · ${nextWeek.length} nächste Woche` : ""}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Schließen"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <p className="deadline-overview-hint">
        Termin auswählen, um die zugehörige Kalenderwoche und ihre Blocker zu
        öffnen.
      </p>

      {thisWeek.length > 0 ? (
        <DeadlineGroup
          title="Diese Woche"
          deadlines={thisWeek}
          urgency="this-week"
          onSelect={onSelect}
        />
      ) : null}
      {nextWeek.length > 0 ? (
        <DeadlineGroup
          title="Nächste Woche"
          deadlines={nextWeek}
          urgency="next-week"
          onSelect={onSelect}
        />
      ) : null}
    </motion.aside>
  );
}

function DeadlineGroup({
  title,
  deadlines,
  urgency,
  onSelect,
}: {
  title: string;
  deadlines: DeadlineRisk[];
  urgency: DeadlineRisk["urgency"];
  onSelect: (deadline: DeadlineRisk) => void;
}) {
  return (
    <section className="deadline-overview-group">
      <div className={`deadline-overview-group-title deadline-overview-group-title--${urgency}`}>
        <strong>{title}</strong>
        <span>{deadlines.length}</span>
      </div>
      <ul className="deadline-overview-list">
        {deadlines.map((deadline) => (
          <li key={deadline.taskId}>
            <button
              type="button"
              className={`deadline-overview-item deadline-overview-item--${urgency}`}
              onClick={() => onSelect(deadline)}
            >
              <span className="deadline-overview-item-main">
                <strong>{deadline.taskName ?? deadline.taskId}</strong>
                <span>{deadline.projectName ?? "Ohne Projekt"}</span>
                <span>{scheduleStatus(deadline)}</span>
              </span>
              <span className="deadline-overview-date">
                <strong>{formatDueDate(deadline.dueOn)}</strong>
                <span>KW öffnen →</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function scheduleStatus(deadline: DeadlineRisk): string {
  if (deadline.plannedSeconds <= 0) {
    return "Kein Zeitbudget hinterlegt";
  }
  const scheduledSeconds = deadline.scheduledMinutesInRange * 60;
  if (scheduledSeconds >= deadline.plannedSeconds) {
    return `${formatHours(deadline.plannedSeconds / 3600)} vollständig eingeplant`;
  }
  return `${formatHours((deadline.plannedSeconds - scheduledSeconds) / 3600)} noch nicht eingeplant`;
}

function formatDueDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}
