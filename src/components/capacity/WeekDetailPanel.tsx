import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { AnimatePresence, motion } from "motion/react";
import type { AworkTaskSchedule, AworkUser } from "../../types/awork";
import type {
  DeadlineRisk,
  UserCapacityWeek,
} from "../../services/capacityModel";
import {
  formatDecimal,
  formatHours,
  formatUserName,
} from "../../services/capacityFormat";
import { useDetailModal } from "../../context/DetailModalContext";

/**
 * Drill-down for one user + week in the Kapazität view: lists the week's
 * blockers and offers remediation right here — open task/project details,
 * shift blockers by days, or delete them.
 */
export function WeekDetailPanel({
  user,
  weekRow,
  schedules,
  risks = [],
  isBusy,
  onClose,
  onDelete,
  onShift,
}: {
  user: AworkUser;
  weekRow: UserCapacityWeek;
  schedules: AworkTaskSchedule[];
  /** Unfertige Aufgaben, deren Fälligkeit in diese Woche fällt. */
  risks?: DeadlineRisk[];
  isBusy: boolean;
  onClose: () => void;
  onDelete: (scheduleIds: string[]) => Promise<boolean>;
  onShift: (scheduleIds: string[], dayOffset: number) => Promise<boolean>;
}) {
  const { openTaskDetail, openProjectDetail } = useDetailModal();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shiftDaysInput, setShiftDaysInput] = useState("7");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<{
    id: number;
    variant: "success" | "error";
    message: string;
  }>();

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(undefined), 3200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const sortedSchedules = useMemo(
    () =>
      [...schedules].sort((a, b) => a.start.localeCompare(b.start)),
    [schedules],
  );

  const shiftDays = Number.parseInt(shiftDaysInput, 10);
  const hasSelection = selectedIds.size > 0;
  const canShift = hasSelection && Number.isInteger(shiftDays) && shiftDays !== 0;

  function toggleSchedule(id: string) {
    setConfirmDelete(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setConfirmDelete(false);
    setSelectedIds((current) =>
      current.size === sortedSchedules.length
        ? new Set()
        : new Set(sortedSchedules.map((schedule) => schedule.id)),
    );
  }

  async function handleDelete() {
    if (!hasSelection) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    const selectedCount = selectedIds.size;
    const succeeded = await onDelete(Array.from(selectedIds));
    setFeedback({
      id: Date.now(),
      variant: succeeded ? "success" : "error",
      message: succeeded
        ? `${selectedCount} ${selectedCount === 1 ? "Blocker wurde" : "Blocker wurden"} gelöscht.`
        : "Löschen fehlgeschlagen. Bitte erneut versuchen.",
    });
    setSelectedIds(new Set());
  }

  async function handleShift() {
    if (!canShift) return;
    const selectedCount = selectedIds.size;
    const succeeded = await onShift(Array.from(selectedIds), shiftDays);
    const absoluteDays = Math.abs(shiftDays);
    const direction = shiftDays > 0 ? "später" : "früher";
    setFeedback({
      id: Date.now(),
      variant: succeeded ? "success" : "error",
      message: succeeded
        ? `${selectedCount} ${selectedCount === 1 ? "Blocker wurde" : "Blocker wurden"} ${absoluteDays} ${absoluteDays === 1 ? "Tag" : "Tage"} ${direction} verschoben.`
        : "Verschieben fehlgeschlagen. Bitte erneut versuchen.",
    });
    setSelectedIds(new Set());
  }

  return (
    <motion.aside
      className="week-detail-panel"
      role="dialog"
      aria-label={`Blocker von ${formatUserName(user)} in ${weekRow.week.label}`}
      initial={{ x: 48, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <div className="week-detail-head">
        <div>
          <p className="eyebrow">{weekRow.week.label}</p>
          <h3>{formatUserName(user)}</h3>
          <p className="week-detail-meta">
            {formatHours(weekRow.plannedMinutes / 60)} geplant ·{" "}
            {formatHours(weekRow.effectiveCapacityHours)} verfügbar ·{" "}
            {formatDecimal(weekRow.utilizationPercent)} %
            {weekRow.isOverCapacity ? (
              <span className="overbooked-label overbooked-label--capacity">
                Über Kapazität
              </span>
            ) : weekRow.isOverbooked ? (
              <span className="overbooked-label">Überbucht</span>
            ) : null}
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

      {risks.length > 0 && (
        <div
          className={`week-detail-risks${risks.some((risk) => risk.urgency === "this-week") ? " week-detail-risks--critical" : ""}`}
          role="note"
        >
          <strong>
            ⚠ Fällige Termine {risks[0]?.urgency === "this-week" ? "diese" : "nächste"} Woche
          </strong>
          <ul>
            {risks.map((risk) => (
              <li key={risk.taskId}>
                <button
                  type="button"
                  className="detail-link-value"
                  onClick={() => openTaskDetail(risk.taskId)}
                >
                  {risk.taskName ?? risk.taskId}
                </button>{" "}
                fällig {risk.dueOn.slice(8, 10)}.{risk.dueOn.slice(5, 7)}.
                {risk.plannedSeconds <= 0
                  ? " — kein Zeitbudget hinterlegt"
                  : risk.scheduledMinutesInRange * 60 >= risk.plannedSeconds
                    ? ` — ${formatHours(risk.plannedSeconds / 3600)} vollständig eingeplant`
                    : ` — nur ${formatHours(risk.scheduledMinutesInRange / 60)} von ${formatHours(risk.plannedSeconds / 3600)} eingeplant`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sortedSchedules.length === 0 ? (
        <p className="week-detail-empty">Keine Blocker in dieser Woche.</p>
      ) : (
        <>
          <div className="week-detail-toolbar">
            <label className="checkbox-row week-detail-select-all">
              <input
                type="checkbox"
                checked={
                  selectedIds.size === sortedSchedules.length &&
                  sortedSchedules.length > 0
                }
                onChange={toggleAll}
              />
              <span>Alle auswählen</span>
            </label>
            <span className="week-detail-count">
              {selectedIds.size}/{sortedSchedules.length} ausgewählt
            </span>
          </div>

          <ul className="week-detail-list">
            {sortedSchedules.map((schedule) => {
              const start = parseISO(schedule.start);
              const end = parseISO(schedule.end);
              const minutes = Math.max(
                0,
                Math.round((end.getTime() - start.getTime()) / 60000),
              );
              return (
                <li key={schedule.id} className="week-detail-item">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(schedule.id)}
                    aria-label={`${schedule.taskName ?? "Aufgabe"} auswählen`}
                    onChange={() => toggleSchedule(schedule.id)}
                  />
                  <div className="week-detail-item-body">
                    <button
                      type="button"
                      className="detail-link-value week-detail-task"
                      onClick={() => openTaskDetail(schedule.taskId)}
                      title="Aufgabendetails anzeigen"
                    >
                      {schedule.taskName ?? schedule.taskId}
                    </button>
                    <span className="week-detail-item-meta">
                      {schedule.projectId ? (
                        <button
                          type="button"
                          className="week-detail-project detail-clickable"
                          onClick={() => openProjectDetail(schedule.projectId!)}
                          title="Projektdetails anzeigen"
                        >
                          {schedule.projectName ?? "Projekt"}
                        </button>
                      ) : (
                        <span>{schedule.projectName ?? "Ohne Projekt"}</span>
                      )}
                      {" · "}
                      {format(start, "EEEEEE dd.MM.", { locale: de })}{" "}
                      {format(start, "HH:mm")}–{format(end, "HH:mm")}
                      {" · "}
                      {formatHours(minutes / 60)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="week-detail-actions">
            <div className="week-detail-shift">
              <label htmlFor="week-detail-shift-days">Verschieben um</label>
              <input
                id="week-detail-shift-days"
                type="text"
                inputMode="numeric"
                value={shiftDaysInput}
                onChange={(event) => setShiftDaysInput(event.target.value)}
              />
              <span>Tage</span>
              <button
                type="button"
                className="ghost-button week-detail-action-button"
                disabled={!canShift || isBusy}
                onClick={() => void handleShift()}
              >
                Verschieben
              </button>
            </div>
            <button
              type="button"
              className={`ghost-button ghost-button-danger week-detail-action-button week-detail-delete${confirmDelete ? " is-confirming" : ""}`}
              disabled={!hasSelection || isBusy}
              onClick={() => void handleDelete()}
            >
              {confirmDelete
                ? `Wirklich ${selectedIds.size} Blocker löschen?`
                : "Auswahl löschen"}
            </button>
          </div>
          <AnimatePresence initial={false}>
            {feedback ? (
              <motion.div
                key={feedback.id}
                className={`week-detail-feedback week-detail-feedback--${feedback.variant}`}
                role={feedback.variant === "error" ? "alert" : "status"}
                aria-live={feedback.variant === "error" ? "assertive" : "polite"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <span aria-hidden="true">
                  {feedback.variant === "success" ? "✓" : "×"}
                </span>
                {feedback.message}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <p className="week-detail-hint">
            Verschieben: positive Werte = später, negative = früher (z. B. 7 =
            eine Woche nach hinten).
          </p>
        </>
      )}
    </motion.aside>
  );
}
