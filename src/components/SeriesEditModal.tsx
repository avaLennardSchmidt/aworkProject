import { endOfMonth, endOfYear, format, parseISO } from "date-fns";
import { useMemo, useState, type ReactNode } from "react";
import type { AworkUser } from "../types/awork";
import type { BlockerOperation, ScheduleGroup } from "../types/planner";
import {
  WEEKDAY_OPTIONS,
  buildUnplanOperations,
  dateKey,
  describeShift,
  getInitialSeriesDraft,
  hasShift,
  planSeriesEdit,
  type SeriesEditDraft,
  type SeriesGroupPlan,
} from "../services/seriesEdit";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";
import { DatePickerInput } from "./DatePickerInput";
import { ModalShell } from "./ModalShell";
import { SearchableSelect } from "./SearchableSelect";
import { TimePickerInput } from "./TimePickerInput";

interface SeriesEditModalProps {
  groups: ScheduleGroup[];
  currentUser: AworkUser;
  /** Values to restore when the user comes back from the preview. */
  initialDraft?: SeriesEditDraft;
  onClose: () => void;
  onPreview: (operations: BlockerOperation[], draft: SeriesEditDraft) => void;
  /** Opens the per-blocker view; only offered when a single series is edited. */
  onEditIndividually?: (group: ScheduleGroup) => void;
}

const DIRECTION_OPTIONS = [
  { value: "later", label: "Verschieben" },
  { value: "earlier", label: "Vorziehen" },
];

const SHIFT_FIELDS = [
  { key: "weeks", label: "Wochen", unit: "W" },
  { key: "days", label: "Tage", unit: "T" },
  { key: "hours", label: "Stunden", unit: "h" },
  { key: "minutes", label: "Minuten", unit: "min" },
] as const;

/**
 * One dialog for editing one or several blocker series: weekday and time,
 * shifting all blockers by the same offset, and the date the series runs until.
 */
export function SeriesEditModal({
  groups,
  currentUser,
  initialDraft,
  onClose,
  onPreview,
  onEditIndividually,
}: SeriesEditModalProps) {
  const isSingle = groups.length === 1;
  const baseline = useMemo(() => getInitialSeriesDraft(groups), [groups]);
  const [draft, setDraft] = useState<SeriesEditDraft>(initialDraft ?? baseline);
  const [error, setError] = useState("");

  const plan = useMemo(
    () => planSeriesEdit(groups, draft, baseline, currentUser),
    [baseline, currentUser, draft, groups],
  );

  const blockerCount = groups.reduce((sum, group) => sum + group.schedules.length, 0);
  const totalMinutes = groups.reduce((sum, group) => sum + group.totalMinutes, 0);
  const changeCount = plan.operations.length;
  const today = new Date();
  const monthEnd = format(endOfMonth(today), "yyyy-MM-dd");
  const yearEnd = format(endOfYear(today), "yyyy-MM-dd");
  const highlightWeekday = draft.weekday !== "" ? Number(draft.weekday) : undefined;

  const appointmentChanged =
    draft.weekday !== baseline.weekday ||
    draft.startTime !== baseline.startTime ||
    draft.endTime !== baseline.endTime;

  function update(patch: Partial<SeriesEditDraft>) {
    setError("");
    setDraft((current) => ({ ...current, ...patch }));
  }

  function resetShift() {
    update({ direction: "later", weeks: "0", days: "0", hours: "0", minutes: "0" });
  }

  function handlePreview() {
    if (plan.error) {
      setError(plan.error);
      return;
    }
    if (changeCount === 0) {
      setError("Mindestens einen Wert ändern.");
      return;
    }
    onPreview(plan.operations, draft);
  }

  function handleUnplan() {
    if (groups.some((group) => group.schedules.length === 0)) {
      setError("Die Auswahl enthält keine Blocker.");
      return;
    }
    onPreview(buildUnplanOperations(groups), draft);
  }

  const single = groups[0];

  return (
    <ModalShell labelledBy="series-edit-title" dialogClassName="modal series-edit-modal" onClose={onClose}>
      <div className="modal-header">
        <div>
          <p className="series-edit-eyebrow">{isSingle ? "Serie bearbeiten" : "Serien bearbeiten"}</p>
          <h2 id="series-edit-title">{isSingle ? single.taskName : `${groups.length} Serien ausgewählt`}</h2>
          <p>
            {isSingle ? `${single.projectName ?? "Kein Projekt im Blocker"} · ` : ""}
            {blockerCount} Blocker · {formatMinutesAsHours(totalMinutes)}
          </p>
        </div>
        <button type="button" className="icon-button" aria-label="Schließen" onClick={onClose}>
          x
        </button>
      </div>

      <section className="series-edit-section">
        <div className="series-edit-section-head">
          <h3>Termin</h3>
          {appointmentChanged ? (
            <button
              type="button"
              className="series-edit-link"
              onClick={() =>
                update({ weekday: baseline.weekday, startTime: baseline.startTime, endTime: baseline.endTime })
              }
            >
              Zurücksetzen
            </button>
          ) : null}
        </div>
        <p className="series-edit-hint">
          {isSingle
            ? "Gilt für jeden Blocker der Serie."
            : "Felder mit „unterschiedlich“ bleiben je Serie, wie sie sind."}
        </p>
        <div className="series-edit-appointment">
          <div className={fieldClass(draft.weekday !== baseline.weekday, draft.weekday === "")}>
            <label htmlFor="series-weekday">Wochentag</label>
            <SearchableSelect
              buttonId="series-weekday"
              value={draft.weekday}
              options={WEEKDAY_OPTIONS.map((day) => ({ value: String(day.value), label: day.label }))}
              placeholder="unterschiedlich"
              searchPlaceholder="Wochentag filtern"
              emptyLabel="Kein Wochentag gefunden."
              menuWidth="compact"
              onChange={(weekday) => update({ weekday })}
            />
          </div>
          <div className={fieldClass(draft.startTime !== baseline.startTime, draft.startTime === "")}>
            <label htmlFor="series-start">Start</label>
            <TimePickerInput
              id="series-start"
              value={draft.startTime}
              placeholder="unterschiedlich"
              onChange={(startTime) => update({ startTime })}
            />
          </div>
          <div className={fieldClass(draft.endTime !== baseline.endTime, draft.endTime === "")}>
            <label htmlFor="series-end">Ende</label>
            <TimePickerInput
              id="series-end"
              value={draft.endTime}
              placeholder="unterschiedlich"
              onChange={(endTime) => update({ endTime })}
            />
          </div>
        </div>
      </section>

      <section className="series-edit-section">
        <h3>Verschieben oder vorziehen</h3>
        <p className="series-edit-hint">
          {isSingle
            ? "Alle Blocker um denselben Abstand. Die Dauer bleibt gleich."
            : "Alle Blocker um denselben Abstand. Jede Serie behält ihre eigene Uhrzeit und Dauer."}
        </p>
        <div className="series-edit-shift">
          <div className={fieldClass(hasShift(draft), false)}>
            <label htmlFor="series-direction">Richtung</label>
            <SearchableSelect
              buttonId="series-direction"
              value={draft.direction}
              options={DIRECTION_OPTIONS}
              placeholder="Richtung"
              searchPlaceholder="Richtung filtern"
              emptyLabel="Keine Richtung gefunden."
              menuWidth="compact"
              onChange={(direction) => update({ direction: direction === "earlier" ? "earlier" : "later" })}
            />
          </div>
          {SHIFT_FIELDS.map((field) => {
            const value = draft[field.key];
            const isSet = Number(value) > 0;
            return (
              <div key={field.key} className={fieldClass(isSet, !isSet)}>
                <label htmlFor={`series-shift-${field.key}`}>{field.label}</label>
                <div className="series-edit-number">
                  <input
                    id={`series-shift-${field.key}`}
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={value}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => update({ [field.key]: event.target.value } as Partial<SeriesEditDraft>)}
                  />
                  <span>{field.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className={hasShift(draft) ? "series-edit-result" : "series-edit-result is-empty"}>
          Ergebnis: {hasShift(draft) ? <strong>{describeShift(draft)}</strong> : "keine Änderung"}
          {hasShift(draft) ? (
            <button type="button" className="series-edit-link" onClick={resetShift}>
              Zurücksetzen
            </button>
          ) : null}
        </div>
      </section>

      <section className="series-edit-section">
        <div className="series-edit-section-head">
          <h3>Laufzeit</h3>
          {draft.until ? (
            <button type="button" className="series-edit-link" onClick={() => update({ until: "" })}>
              Zurücksetzen
            </button>
          ) : null}
        </div>
        <p className="series-edit-hint">
          {isSingle
            ? `Aktuell letzter Blocker: ${single.lastDate}.`
            : "Leer lassen, dann behält jede Serie ihr eigenes Ende."}
        </p>
        <div className="series-edit-runtime">
          <div>
            <div className={fieldClass(draft.until !== "", draft.until === "")}>
              <label htmlFor="series-until">Letzter Blocker bis</label>
              <DatePickerInput
                id="series-until"
                value={draft.until}
                placeholder="unverändert"
                highlightWeekday={highlightWeekday}
                onChange={(until) => update({ until })}
              />
            </div>
            <div className="series-edit-chips">
              <button type="button" className="series-edit-chip" onClick={() => update({ until: monthEnd })}>
                Monatsende <small>{format(parseISO(monthEnd), "dd.MM.")}</small>
              </button>
              <button type="button" className="series-edit-chip" onClick={() => update({ until: yearEnd })}>
                Jahresende <small>{format(parseISO(yearEnd), "dd.MM.")}</small>
              </button>
            </div>
          </div>
          <dl className="series-edit-rules">
            <div>
              <dt>Später</dt>
              <dd>fehlende Wochen werden ergänzt</dd>
            </div>
            <div>
              <dt>Früher</dt>
              <dd>Blocker danach werden ausgeplant</dd>
            </div>
            {isSingle ? (
              <div>
                <dt>Leer</dt>
                <dd>nichts ändert sich</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </section>

      {isSingle ? (
        changeCount > 0 && !plan.error ? <SingleSeriesEffect plan={plan.groups[0]} /> : null
      ) : (
        <section className="series-edit-section">
          <h3>Vorher → nachher</h3>
          <ul className="series-edit-compare">
            {plan.groups.map((groupPlan) => (
              <SeriesCompareRow key={groupPlan.group.groupId} plan={groupPlan} />
            ))}
          </ul>
        </section>
      )}

      {error ? <div className="alert alert-error series-edit-error">{error}</div> : null}

      <div className="series-edit-footer">
        <div className="series-edit-footer-links">
          {isSingle && onEditIndividually ? (
            <button type="button" className="series-edit-link" onClick={() => onEditIndividually(single)}>
              Einzeln bearbeiten
            </button>
          ) : null}
          <button type="button" className="series-edit-link is-danger" onClick={handleUnplan}>
            {isSingle ? "Serie ausplanen" : "Auswahl ausplanen"}
          </button>
        </div>
        <div className="series-edit-footer-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary-button" disabled={changeCount === 0} onClick={handlePreview}>
            {changeCount === 1 ? "1 Änderung prüfen" : `${changeCount} Änderungen prüfen`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function SingleSeriesEffect({ plan }: { plan: SeriesGroupPlan }) {
  const created = plan.createdDates;
  const deleted = plan.deletedDates;
  const untouched = plan.group.schedules.length - plan.updatedCount - deleted.length;
  const cells = [
    ...plan.group.schedules.map((schedule) => ({
      date: dateKey(schedule.start),
      kind: deleted.includes(dateKey(schedule.start)) ? "removed" : "existing",
    })),
    ...created.map((date) => ({ date, kind: "new" })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const firstExistingCount = cells.findIndex((cell) => cell.kind === "new");

  const parts: ReactNode[] = [];
  if (created.length > 0) {
    parts.push(
      <span key="new">
        <strong>{created.length} neue Blocker</strong> von {formatShortDate(created[0])} bis{" "}
        {formatLongDate(created[created.length - 1])}
      </span>,
    );
  }
  if (plan.updatedCount > 0) {
    parts.push(
      <span key="updated">
        <strong>{plan.updatedCount} geändert</strong>
        {plan.patternChanged ? ` auf ${plan.newPattern}` : ""}
      </span>,
    );
  }
  if (deleted.length > 0) {
    parts.push(
      <span key="deleted">
        <strong className="is-danger">{deleted.length} ausgeplant</strong> ab {formatShortDate(deleted[0])}
      </span>,
    );
  }
  if (untouched > 0) {
    parts.push(
      <span key="untouched">
        {untouched} bestehende bleiben unverändert
      </span>,
    );
  }

  const firstDate = cells[0]?.date;
  const lastDate = cells[cells.length - 1]?.date;
  const crossesYear = firstDate && lastDate && firstDate.slice(0, 4) !== lastDate.slice(0, 4);

  return (
    <div className="series-edit-effect">
      <p>{joinWithDots(parts)}</p>
      {cells.length > 0 ? (
        <>
          <div className="series-edit-timeline" aria-hidden="true">
            {cells.map((cell, index) => (
              <span key={`${cell.date}-${index}`} className="series-edit-timeline-item">
                {index === firstExistingCount && index > 0 ? <i className="series-edit-timeline-sep" /> : null}
                <i className={`series-edit-timeline-cell is-${cell.kind}`} />
              </span>
            ))}
          </div>
          <div className="series-edit-timeline-labels">
            <span>{formatMonth(firstDate)}</span>
            {crossesYear ? <span>Jahreswechsel</span> : null}
            <span>{formatMonth(lastDate)}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function SeriesCompareRow({ plan }: { plan: SeriesGroupPlan }) {
  const { group } = plan;
  return (
    <li>
      <div>
        <span>{group.taskName}</span>
        <small>
          {group.projectName ?? "Kein Projekt"} · {group.schedules.length} Blocker bis {group.lastDate}
        </small>
      </div>
      <div className="series-edit-compare-result">
        {plan.patternChanged ? (
          <span>
            <span className="series-edit-compare-old">{plan.oldPattern} → </span>
            <strong>{plan.newPattern}</strong>
          </span>
        ) : (
          <span className="series-edit-compare-old">{plan.oldPattern} · unverändert</span>
        )}
        {plan.createdDates.length > 0 ? (
          <span className="series-edit-compare-new">
            +{plan.createdDates.length} neu bis {formatShortDate(plan.createdDates[plan.createdDates.length - 1])}
          </span>
        ) : null}
        {plan.deletedDates.length > 0 ? (
          <span className="series-edit-compare-removed">
            {plan.deletedDates.length} ausgeplant ab {formatShortDate(plan.deletedDates[0])}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function fieldClass(changed: boolean, empty: boolean): string {
  return ["form-row", "series-edit-field", changed ? "is-changed" : "", empty ? "is-empty" : ""]
    .filter(Boolean)
    .join(" ");
}

function joinWithDots(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [<span key={`dot-${index}`}> · </span>, part]));
}

function formatShortDate(date: string): string {
  return format(parseISO(date), "dd.MM.");
}

function formatLongDate(date: string): string {
  return format(parseISO(date), "dd.MM.yyyy");
}

function formatMonth(date: string | undefined): string {
  if (!date) return "";
  const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const parsed = parseISO(date);
  return `${months[parsed.getMonth()]} ${parsed.getFullYear()}`;
}
