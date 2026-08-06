import { useState } from "react";
import { motion } from "motion/react";
import type { AworkUser } from "../../types/awork";
import type { DeadlineRisk } from "../../services/capacityModel";
import {
  formatHours,
  formatUserName,
} from "../../services/capacityFormat";
import { ModalShell } from "../ModalShell";

export function DeadlineOverviewPanel({
  user,
  deadlines,
  rangeFrom,
  isBusy = false,
  onSelect,
  onMarkDone,
  actionResult,
  onClose,
}: {
  user: AworkUser;
  deadlines: DeadlineRisk[];
  /** Start of the analyzed range (yyyy-MM-dd); due dates before it have no
   * KW in the analysis, so the link opens the task instead. */
  rangeFrom?: string;
  isBusy?: boolean;
  onSelect: (deadline: DeadlineRisk) => void;
  /** Marks the given tasks as done in awork (project-specific done status). */
  onMarkDone?: (tasks: Array<{ taskId: string; projectId?: string }>) => Promise<void>;
  /** Outcome of the last mark-done action, shown inside the panel. */
  actionResult?: { kind: "success" | "error"; message: string } | null;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  const overdue = deadlines.filter(
    (deadline) => deadline.urgency === "overdue",
  );
  const thisWeek = deadlines.filter(
    (deadline) => deadline.urgency === "this-week",
  );
  const nextWeek = deadlines.filter(
    (deadline) => deadline.urgency === "next-week",
  );

  // No selection = the button targets ALL deadlines.
  const targetDeadlines =
    selectedIds.size > 0
      ? deadlines.filter((deadline) => selectedIds.has(deadline.taskId))
      : deadlines;

  function toggleDeadline(taskId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  // Group header click: selects the whole category; if it is already fully
  // selected, deselects it again.
  function toggleGroup(groupDeadlines: DeadlineRisk[]) {
    setSelectedIds((current) => {
      const next = new Set(current);
      const allSelected = groupDeadlines.every((deadline) =>
        next.has(deadline.taskId),
      );
      for (const deadline of groupDeadlines) {
        if (allSelected) {
          next.delete(deadline.taskId);
        } else {
          next.add(deadline.taskId);
        }
      }
      return next;
    });
  }

  async function confirmMarkDone() {
    if (!onMarkDone || targetDeadlines.length === 0) return;
    setShowConfirm(false);
    await onMarkDone(
      targetDeadlines.map((deadline) => ({
        taskId: deadline.taskId,
        projectId: deadline.projectId,
      })),
    );
    setSelectedIds(new Set());
  }

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
            {overdue.length > 0 ? ` · ${overdue.length} überfällig` : ""}
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
        {onMarkDone
          ? "Termin anklicken zum Auswählen · „KW öffnen\" zeigt die Blocker der Woche."
          : "Termin anklicken zeigt die Blocker der Woche."}
      </p>
      {onMarkDone && deadlines.length > 0 ? (
        <button
          type="button"
          className="deadline-mark-done-cta"
          disabled={isBusy}
          onClick={() => setShowConfirm(true)}
        >
          {isBusy ? (
            "Wird gespeichert..."
          ) : (
            <>
              <span aria-hidden="true">✓</span>
              {selectedIds.size > 0
                ? "Ausgewählte als erledigt markieren"
                : "Alle als erledigt markieren"}
              <span className="deadline-mark-done-count">
                {selectedIds.size > 0 ? selectedIds.size : deadlines.length}
              </span>
            </>
          )}
        </button>
      ) : null}

      {actionResult ? (
        <p
          className={`deadline-action-result deadline-action-result--${actionResult.kind}`}
          role={actionResult.kind === "error" ? "alert" : "status"}
        >
          {actionResult.message}
        </p>
      ) : null}

      {overdue.length > 0 ? (
        <DeadlineGroup
          title="Überfällig"
          deadlines={overdue}
          urgency="overdue"
          rangeFrom={rangeFrom}
          selectedIds={selectedIds}
          selectable={Boolean(onMarkDone)}
          isBusy={isBusy}
          onToggle={toggleDeadline}
          onToggleGroup={toggleGroup}
          onSelect={onSelect}
        />
      ) : null}
      {thisWeek.length > 0 ? (
        <DeadlineGroup
          title="Diese Woche"
          deadlines={thisWeek}
          urgency="this-week"
          rangeFrom={rangeFrom}
          selectedIds={selectedIds}
          selectable={Boolean(onMarkDone)}
          isBusy={isBusy}
          onToggle={toggleDeadline}
          onToggleGroup={toggleGroup}
          onSelect={onSelect}
        />
      ) : null}
      {nextWeek.length > 0 ? (
        <DeadlineGroup
          title="Nächste Woche"
          deadlines={nextWeek}
          urgency="next-week"
          rangeFrom={rangeFrom}
          selectedIds={selectedIds}
          selectable={Boolean(onMarkDone)}
          isBusy={isBusy}
          onToggle={toggleDeadline}
          onToggleGroup={toggleGroup}
          onSelect={onSelect}
        />
      ) : null}

      {showConfirm ? (
        <ModalShell
          labelledBy="mark-done-confirm-title"
          dialogClassName="modal mark-done-confirm-modal"
          onClose={() => setShowConfirm(false)}
        >
          <div className="modal-header">
            <div>
              <p className="eyebrow">Bestätigung</p>
              <h2 id="mark-done-confirm-title">Als erledigt markieren</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Schließen"
              onClick={() => setShowConfirm(false)}
            >
              ×
            </button>
          </div>
          <p className="mark-done-confirm-text">
            {targetDeadlines.length === 1
              ? "1 Aufgabe wird"
              : `${targetDeadlines.length} Aufgaben werden`}{" "}
            in awork auf <strong>„Erledigt"</strong> gesetzt
            {selectedIds.size === 0 ? " (alle fälligen Termine)" : ""}. Der
            Status lässt sich in awork jederzeit wieder ändern.
          </p>
          <div className="modal-actions modal-actions-split">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowConfirm(false)}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void confirmMarkDone()}
            >
              Als erledigt markieren
            </button>
          </div>
        </ModalShell>
      ) : null}
    </motion.aside>
  );
}

function DeadlineGroup({
  title,
  deadlines,
  urgency,
  rangeFrom,
  selectedIds,
  selectable,
  isBusy,
  onToggle,
  onToggleGroup,
  onSelect,
}: {
  title: string;
  deadlines: DeadlineRisk[];
  urgency: DeadlineRisk["urgency"];
  rangeFrom?: string;
  selectedIds: Set<string>;
  selectable: boolean;
  isBusy: boolean;
  onToggle: (taskId: string) => void;
  onToggleGroup?: (deadlines: DeadlineRisk[]) => void;
  onSelect: (deadline: DeadlineRisk) => void;
}) {
  const selectedInGroup = deadlines.filter((deadline) =>
    selectedIds.has(deadline.taskId),
  ).length;
  const allInGroupSelected =
    deadlines.length > 0 && selectedInGroup === deadlines.length;

  const titleContent = (
    <>
      {selectable ? (
        <span
          className={`deadline-select-indicator${allInGroupSelected ? " is-selected" : ""}${selectedInGroup > 0 && !allInGroupSelected ? " is-partial" : ""}`}
          aria-hidden="true"
        >
          {allInGroupSelected ? "✓" : selectedInGroup > 0 ? "–" : ""}
        </span>
      ) : null}
      <strong>{title}</strong>
      <span>
        {selectedInGroup > 0 && !allInGroupSelected
          ? `${selectedInGroup}/${deadlines.length}`
          : deadlines.length}
      </span>
    </>
  );

  return (
    <section className="deadline-overview-group">
      {selectable && onToggleGroup ? (
        <button
          type="button"
          className={`deadline-overview-group-title deadline-overview-group-title--${urgency} deadline-overview-group-title--selectable${allInGroupSelected ? " is-selected" : ""}`}
          aria-pressed={allInGroupSelected}
          title={
            allInGroupSelected
              ? `Auswahl „${title}" aufheben`
              : `Alle Termine „${title}" auswählen`
          }
          disabled={isBusy}
          onClick={() => onToggleGroup(deadlines)}
        >
          {titleContent}
        </button>
      ) : (
        <div className={`deadline-overview-group-title deadline-overview-group-title--${urgency}`}>
          {titleContent}
        </div>
      )}
      <ul className="deadline-overview-list">
        {deadlines.map((deadline) => {
          const isSelected = selectedIds.has(deadline.taskId);
          return (
            <li key={deadline.taskId}>
              <button
                type="button"
                className={`deadline-overview-item deadline-overview-item--${urgency}${isSelected ? " is-selected" : ""}`}
                aria-pressed={isSelected}
                disabled={isBusy}
                onClick={() =>
                  selectable ? onToggle(deadline.taskId) : onSelect(deadline)
                }
              >
                {selectable ? (
                  <span
                    className={`deadline-select-indicator${isSelected ? " is-selected" : ""}`}
                    aria-hidden="true"
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                ) : null}
                <span className="deadline-overview-item-main">
                  <strong>{deadline.taskName ?? deadline.taskId}</strong>
                  <span>{deadline.projectName ?? "Ohne Projekt"}</span>
                  <span>{scheduleStatus(deadline)}</span>
                </span>
                <span className="deadline-overview-date">
                  <strong>{formatDueDate(deadline.dueOn)}</strong>
                  <span
                    className="deadline-overview-open-week"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(deadline);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelect(deadline);
                      }
                    }}
                  >
                    {rangeFrom && deadline.dueOn.slice(0, 10) < rangeFrom
                      ? "Aufgabe öffnen →"
                      : "KW öffnen →"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
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
