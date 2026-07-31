import { useMemo, useState, type MouseEvent } from "react";
import type { AworkAbsence } from "../../types/awork";
import {
  buildProjectColorResolver,
  exportCapacityCsv,
  formatAbsentDays,
  formatDecimal,
  formatHours,
  formatUserName,
  getWorkloadColor,
  slugifyName,
} from "../../services/capacityFormat";
import {
  buildUserCapacityDays,
  readPercentNumber,
  readPositiveNumber,
  summarizeWeekProjectTotals,
  summarizeWeekRows,
  type CapacityInputs,
  type UserCapacityRow,
  type UserCapacityWeek,
  type UserExpandMode,
} from "../../services/capacityModel";
import { UserAvatar } from "../UserAvatar";
import { CapacityCombinedBar, CapacityWeekBar } from "./CapacityBars";
import { CheckIcon, CopyIcon, CsvExportIcon } from "./icons";

interface ChartTooltip {
  text: string;
  x: number;
  y: number;
}

export function CapacityChartRow({
  row,
  weekRows,
  expandMode,
  showCollapsedRangeBar,
  userAbsences,
  unresolvedHintsByTaskId,
  onSetExpandMode,
  onInputChange,
  onWeekDetail,
  trackedMinutesByWeek,
}: {
  row: UserCapacityRow;
  weekRows: UserCapacityWeek[];
  expandMode: UserExpandMode | null;
  showCollapsedRangeBar: boolean;
  userAbsences: AworkAbsence[];
  unresolvedHintsByTaskId: Record<string, string>;
  onSetExpandMode: (mode: UserExpandMode) => void;
  onInputChange: (
    userId: string,
    field: keyof CapacityInputs,
    value: number,
  ) => void;
  onWeekDetail?: (weekKey: string) => void;
  /** Erfasste Minuten pro Wochen-Key (Plan vs. Actual overlay). */
  trackedMinutesByWeek?: Record<string, number>;
}) {
  const isExpanded = expandMode !== null;
  const totals = summarizeWeekRows(weekRows);
  const projectTotals = summarizeWeekProjectTotals(weekRows);
  const projectColorFor = useMemo(
    () => buildProjectColorResolver(projectTotals),
    [projectTotals],
  );
  const dayRowsByWeek = useMemo(
    () =>
      expandMode === "days"
        ? new Map(
            weekRows.map((weekRow) => [
              weekRow.week.key,
              buildUserCapacityDays(
                row,
                weekRow.week,
                userAbsences,
                unresolvedHintsByTaskId,
              ),
            ]),
          )
        : null,
    [expandMode, weekRows, row, userAbsences, unresolvedHintsByTaskId],
  );
  const workloadColor = getWorkloadColor(totals.workloadPercent, row.inputs.customerPercent);
  const [tooltip, setTooltip] = useState<ChartTooltip>();
  const [copied, setCopied] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);

  function copyCapacitySummary() {
    const text = `${formatUserName(row.user)} — ${formatDecimal(totals.workloadPercent)}% (${formatHours(totals.plannedHours)} / ${formatHours(totals.effectiveCapacityHours)})`;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function exportUserCapacity() {
    exportCapacityCsv(
      [{ row, weekRows }],
      `kapazitaet-${slugifyName(formatUserName(row.user))}`,
    );
  }

  function showProjectTooltip(text: string, event: MouseEvent<HTMLElement>) {
    const tooltipWidth = 360;
    const x = Math.max(
      12,
      Math.min(event.clientX + 14, window.innerWidth - tooltipWidth - 12),
    );
    const y = Math.max(12, event.clientY + 18);
    setTooltip({ text, x, y });
  }

  const workloadTooltip = [
    `Auslastung: ${formatHours(totals.plannedHours)} geplant / ${formatHours(totals.effectiveCapacityHours)} verfügbar = ${formatDecimal(totals.workloadPercent)} %`,
    `Kundenziel-Erfüllung: ${formatHours(totals.plannedHours)} von ${formatHours(totals.targetHours)} Ziel (${formatDecimal(row.inputs.customerPercent)} % Kunden-Anteil) = ${formatDecimal(totals.kundenzielPercent)} %`,
    `Überbucht, sobald die geplante Zeit das Kunden-Ziel überschreitet.`,
  ].join("\n");

  return (
    <article
      className={`capacity-row ${totals.isOverbooked ? "is-overbooked" : ""}`}
    >
      <div className="capacity-row-config">
        <div className="capacity-user">
          <div className="capacity-user-name">
            <UserAvatar user={row.user} size={30} />
            <strong>{formatUserName(row.user)}</strong>
            {totals.isOverCapacity ? (
              <span className="overbooked-label overbooked-label--capacity">
                Über Kapazität
              </span>
            ) : totals.isOverbooked ? (
              <span className="overbooked-label">Überbucht</span>
            ) : null}
            {totals.absentDays > 0 && (
              <span
                className="capacity-absent-badge"
                title={`${formatHours(totals.absentHours)} Kapazität durch Abwesenheit reduziert`}
              >
                {formatAbsentDays(totals.absentDays)} Urlaub
              </span>
            )}
            <button
              type="button"
              className="capacity-icon-button"
              aria-label="Kapazitätszusammenfassung kopieren"
              title="Kapazitätszusammenfassung in Zwischenablage kopieren"
              onClick={copyCapacitySummary}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button
              type="button"
              className="capacity-icon-button"
              aria-label="Kapazität dieses Nutzers als CSV exportieren"
              title="Kapazität dieses Nutzers als CSV exportieren"
              onClick={exportUserCapacity}
            >
              <CsvExportIcon />
            </button>
          </div>
          <span
            className="capacity-user-workload"
            style={{ color: workloadColor }}
            aria-label={workloadTooltip}
            onMouseEnter={(event) => showProjectTooltip(workloadTooltip, event)}
            onMouseMove={(event) => showProjectTooltip(workloadTooltip, event)}
            onMouseLeave={() => setTooltip(undefined)}
          >
            {formatHours(totals.plannedHours)} geplant –{" "}
            {formatDecimal(totals.workloadPercent)}%
          </span>
          <span className="capacity-user-capacity">
            {formatHours(totals.effectiveCapacityHours)} verfügbar
            {" · "}
            {formatHours(totals.targetHours)} Kunden-Ziel
          </span>
        </div>
        <div className="capacity-expand-actions">
          <button
            type="button"
            className="primary-button capacity-expand-button"
            aria-expanded={expandMode === "weeks"}
            aria-pressed={expandMode === "weeks"}
            onClick={() => onSetExpandMode("weeks")}
          >
            {expandMode === "weeks" ? "Wochen einklappen" : "Wochen einblenden"}
          </button>
          <button
            type="button"
            className="primary-button capacity-expand-button"
            aria-expanded={expandMode === "days"}
            aria-pressed={expandMode === "days"}
            onClick={() => onSetExpandMode("days")}
          >
            {expandMode === "days" ? "Tage einklappen" : "Tage einblenden"}
          </button>
        </div>
        <div className="capacity-inputs">
          <label>
            Wochenstunden
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9.]*"
              min="0"
              value={row.inputs.weeklyHours}
              title="Vertraglich vereinbarte Arbeitsstunden pro Woche. Jeder Wochenbalken nutzt diesen Wert als 100 %-Kapazität, anteilig für Teilwochen."
              onChange={(event) =>
                onInputChange(
                  row.user.id,
                  "weeklyHours",
                  readPositiveNumber(event.target.value),
                )
              }
            />
          </label>
          <label>
            Kunden %
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min="0"
              max="100"
              value={row.inputs.customerPercent}
              title="Zielanteil der Wochenstunden für Kunden-/Projektarbeit. Der gelbe Marker nutzt diesen Prozentsatz der Gesamtkapazität."
              onChange={(event) =>
                onInputChange(
                  row.user.id,
                  "customerPercent",
                  readPercentNumber(event.target.value),
                )
              }
            />
          </label>
        </div>
      </div>
      {isExpanded || showCollapsedRangeBar ? (
        <CapacityCombinedBar
          totals={totals}
          projectTotals={projectTotals}
          projectColorFor={projectColorFor}
          customerPercent={row.inputs.customerPercent}
          onTooltip={showProjectTooltip}
          onTooltipClear={() => setTooltip(undefined)}
        />
      ) : null}
      {isExpanded ? (
        <div className="capacity-row-main">
          <div
            className={`capacity-week-grid${expandMode === "days" ? " capacity-week-grid--days" : ""}`}
            aria-label={`Geplante Projektstunden von ${formatUserName(row.user)} pro Kalenderwoche`}
          >
            {weekRows.map((weekRow) => (
              <CapacityWeekBar
                key={weekRow.week.key}
                weekRow={weekRow}
                dayRows={dayRowsByWeek?.get(weekRow.week.key)}
                projectColorFor={projectColorFor}
                customerPercent={row.inputs.customerPercent}
                onTooltip={showProjectTooltip}
                onTooltipClear={() => setTooltip(undefined)}
                onWeekDetail={
                  onWeekDetail
                    ? () => onWeekDetail(weekRow.week.key)
                    : undefined
                }
                trackedMinutes={trackedMinutesByWeek?.[weekRow.week.key]}
              />
            ))}
          </div>
          <div className="capacity-legend">
            {(showAllProjects ? projectTotals : projectTotals.slice(0, 4)).map(
              (project) => (
                <span
                  key={project.key}
                  title={`${project.name}: ${project.blockerCount} Blocker, ${formatHours(project.minutes / 60)} geplant`}
                >
                  <i style={{ background: projectColorFor(project.key) }} />
                  {project.name}
                </span>
              ),
            )}
            {projectTotals.length > 4 && (
              <button
                type="button"
                className="capacity-legend-more"
                onClick={() => setShowAllProjects((value) => !value)}
              >
                {showAllProjects
                  ? "Weniger anzeigen"
                  : `+${projectTotals.length - 4} weitere`}
              </button>
            )}
            {totals.absentHours > 0 && (
              <span
                title={`${formatHours(totals.absentHours)} durch Abwesenheit nicht verfügbar`}
              >
                <i className="capacity-legend-absent-swatch" />
                Abwesenheit ({formatHours(totals.absentHours)})
              </span>
            )}
          </div>
        </div>
      ) : null}
      {tooltip ? (
        <div
          className="capacity-floating-tooltip"
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </article>
  );
}
