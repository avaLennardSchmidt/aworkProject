import type { MouseEvent } from "react";
import { format } from "date-fns";
import { countWorkingDaysInRange } from "../../services/absenceMapper";
import {
  currentIsoWeekKey,
  formatAbsentDays,
  formatDecimal,
  formatHours,
  getWorkloadColor,
  type ProjectColorResolver,
} from "../../services/capacityFormat";
import type {
  ProjectTotal,
  UserCapacityDay,
  UserCapacityWeek,
  summarizeWeekRows,
} from "../../services/capacityModel";
import { useDetailModal } from "../../context/DetailModalContext";
import {
  capacityProjectId,
  CAPACITY_DETAIL_HINT,
} from "../../services/capacityProject";

export function CapacityCombinedBar({
  totals,
  projectTotals,
  projectColorFor,
  customerPercent,
  onTooltip,
  onTooltipClear,
}: {
  totals: ReturnType<typeof summarizeWeekRows>;
  projectTotals: ProjectTotal[];
  projectColorFor: ProjectColorResolver;
  customerPercent: number;
  onTooltip: (text: string, event: MouseEvent<HTMLElement>) => void;
  onTooltipClear: () => void;
}) {
  const { openProjectDetail } = useDetailModal();
  const displayPercent = Math.max(100, totals.workloadPercent);
  const pct = (h: number) =>
    totals.totalCapacityHours > 0
      ? (h / totals.totalCapacityHours) * (10000 / displayPercent)
      : 0;
  const availableZonePercent = pct(totals.effectiveCapacityHours);
  const absentZonePercent = pct(totals.absentHours);
  const stackWidthPercent = pct(totals.plannedHours);
  const customerMarkerPercent = pct(totals.targetHours);
  // When the marker sits near a track edge, a centred flag/marker overflows and
  // gets clipped by the track's overflow. Anchor them to the near edge instead.
  const markerAtLeft = customerMarkerPercent <= 15;
  const markerAtRight = customerMarkerPercent >= 85;
  const flagAlignClass = markerAtLeft
    ? " capacity-marker-flag--left"
    : markerAtRight
      ? " capacity-marker-flag--right"
      : "";
  const markerAlignClass = markerAtLeft
    ? " capacity-marker-target--edge-left"
    : markerAtRight
      ? " capacity-marker-target--edge-right"
      : "";
  const hasAbsent = absentZonePercent > 0;
  const customerTargetTooltip = `Erwartete Projektkapazität | ${formatHours(totals.targetHours)}\nDieser Balken repräsentiert ${customerPercent} % der verfügbaren Kapazität`;
  const absentTooltip = `Abwesenheit\n${formatAbsentDays(totals.absentDays)} · ${formatHours(totals.absentHours)} weniger Kapazität`;

  return (
    <div className="capacity-range-overview">
      <div className="capacity-range-overview-head">
        <strong>Gewählter Zeitraum</strong>
        <span>
          {formatHours(totals.plannedHours)} geplant ·{" "}
          {formatDecimal(totals.workloadPercent)}%
        </span>
      </div>
      <div
        className="capacity-range-track capacity-range-track--labeled-marker"
        aria-label={`Gewählter Zeitraum: ${formatHours(totals.plannedHours)} geplant von ${formatHours(totals.effectiveCapacityHours)} verfügbarer Kapazität.`}
      >
        <div
          className="capacity-range-inner"
          style={{ width: `${displayPercent}%` }}
        >
          <div
            className={`capacity-zone${hasAbsent ? " capacity-zone--partial" : ""}`}
            style={{ width: `${availableZonePercent}%` }}
          />
          {hasAbsent && (
            <div
              className={`capacity-absent-zone${availableZonePercent <= 0 ? " capacity-absent-zone--isolated" : ""}`}
              style={{
                left: `${availableZonePercent}%`,
                width: `${absentZonePercent}%`,
              }}
              aria-label={absentTooltip}
              onMouseEnter={(event) => onTooltip(absentTooltip, event)}
              onMouseMove={(event) => onTooltip(absentTooltip, event)}
              onMouseLeave={onTooltipClear}
            />
          )}
          <div
            className="capacity-stacked-bar"
            style={{ width: `${stackWidthPercent}%` }}
          >
            {projectTotals.length > 0 && totals.plannedHours > 0 ? (
              projectTotals.map((project) => {
                const projectId = capacityProjectId(project.key);
                const baseTooltip = `${project.name}\n${formatHours(project.minutes / 60)} geplant\n${project.blockerCount} Blocker${project.unresolvedHint ? `\nHinweis: ${project.unresolvedHint}` : ""}`;
                const tooltipText = projectId
                  ? `${baseTooltip}\n${CAPACITY_DETAIL_HINT}`
                  : baseTooltip;

                return (
                  <span
                    key={project.key}
                    className={`capacity-segment${projectId ? " capacity-segment-clickable" : ""}`}
                    aria-label={tooltipText}
                    role={projectId ? "button" : undefined}
                    tabIndex={projectId ? 0 : undefined}
                    style={{
                      width: `${(project.minutes / (totals.plannedHours * 60)) * 100}%`,
                      background: projectColorFor(project.key),
                    }}
                    onMouseEnter={(event) => onTooltip(tooltipText, event)}
                    onMouseMove={(event) => onTooltip(tooltipText, event)}
                    onMouseLeave={onTooltipClear}
                    onClick={projectId ? () => openProjectDetail(projectId) : undefined}
                    onKeyDown={
                      projectId
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openProjectDetail(projectId);
                            }
                          }
                        : undefined
                    }
                  />
                );
              })
            ) : (
              <span
                className="capacity-empty-bar"
                aria-label="Keine geplante Projektzeit"
                title="Keine geplante Projektzeit"
              >
                -
              </span>
            )}
          </div>
          <span
            className={`capacity-marker capacity-marker-target capacity-marker-target--labeled${markerAlignClass}`}
            style={{ left: `${customerMarkerPercent}%` }}
            aria-label={customerTargetTooltip}
            onMouseEnter={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseMove={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseLeave={onTooltipClear}
          >
            <span className={`capacity-marker-flag${flagAlignClass}`}>
              Kunden-Ziel · {formatHours(totals.targetHours)} /{" "}
              {formatDecimal(customerPercent)} %
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function CapacityWeekBar({
  weekRow,
  dayRows,
  projectColorFor,
  customerPercent,
  onTooltip,
  onTooltipClear,
}: {
  weekRow: UserCapacityWeek;
  dayRows?: UserCapacityDay[];
  projectColorFor: ProjectColorResolver;
  customerPercent: number;
  onTooltip: (text: string, event: MouseEvent<HTMLElement>) => void;
  onTooltipClear: () => void;
}) {
  const { openProjectDetail } = useDetailModal();
  const displayPercent = Math.max(100, weekRow.utilizationPercent);
  const pct = (h: number) =>
    weekRow.totalCapacityHours > 0
      ? (h / weekRow.totalCapacityHours) * (10000 / displayPercent)
      : 0;
  const availableZonePercent = pct(weekRow.effectiveCapacityHours);
  const absentZonePercent = pct(weekRow.absentHours);
  const stackWidthPercent = pct(weekRow.plannedMinutes / 60);
  const customerMarkerPercent = pct(weekRow.targetHours);
  const hasAbsent = absentZonePercent > 0;
  const weekWorkingDays = countWorkingDaysInRange(
    weekRow.week.from,
    weekRow.week.to,
  );
  const isPartialWeek = weekWorkingDays < 5;
  const isCurrentWeek = weekRow.week.key === currentIsoWeekKey();
  const customerTargetTooltip = `Erwartete Projektkapazität | ${formatHours(weekRow.targetHours)}\nDieser Balken repräsentiert ${customerPercent} % der Wochenstunden`;
  const absentTooltip = `Abwesenheit\n${formatAbsentDays(weekRow.absentDays)} · ${formatHours(weekRow.absentHours)} weniger Kap.`;

  return (
    <div
      className={`capacity-week ${weekRow.isOverbooked ? "is-overbooked" : ""} ${weekRow.isOverCapacity ? "is-over-capacity" : ""} ${isCurrentWeek ? "is-current-week" : ""}`}
    >
      <div
        className="capacity-week-label"
        title={`${weekRow.week.label}: ${format(weekRow.week.from, "dd.MM.yyyy")} - ${format(weekRow.week.to, "dd.MM.yyyy")}`}
      >
        <strong>{weekRow.week.label}</strong>
        <div className="capacity-week-label-right">
          {isPartialWeek && (
            <span
              className="capacity-week-partial-note"
              title={`Nur ${weekWorkingDays} von 5 Arbeitstagen im gewählten Zeitraum`}
            >
              {weekWorkingDays} Tage
            </span>
          )}
          <span>
            {format(weekRow.week.from, "dd.MM")} -{" "}
            {format(weekRow.week.to, "dd.MM")}
          </span>
        </div>
      </div>
      {dayRows ? (
        <div
          className="capacity-day-list"
          aria-label={`${weekRow.week.label}: geplante Projektzeit pro Tag`}
        >
          {dayRows.map((day) => (
            <CapacityDayRow
              key={day.key}
              day={day}
              projectColorFor={projectColorFor}
              onTooltip={onTooltip}
              onTooltipClear={onTooltipClear}
            />
          ))}
        </div>
      ) : (
      <div
        className="capacity-week-track"
        aria-label={`${weekRow.week.label}: ${formatHours(weekRow.plannedMinutes / 60)} geplant von ${formatHours(weekRow.effectiveCapacityHours)} verfügbarer Kap.`}
      >
        <div
          className="capacity-week-inner"
          style={{ width: `${displayPercent}%` }}
        >
          <div
            className={`capacity-zone${hasAbsent ? " capacity-zone--partial" : ""}`}
            style={{ width: `${availableZonePercent}%` }}
          />
          {hasAbsent && (
            <div
              className={`capacity-absent-zone${availableZonePercent <= 0 ? " capacity-absent-zone--isolated" : ""}`}
              style={{
                left: `${availableZonePercent}%`,
                width: `${absentZonePercent}%`,
              }}
              aria-label={absentTooltip}
              onMouseEnter={(event) => onTooltip(absentTooltip, event)}
              onMouseMove={(event) => onTooltip(absentTooltip, event)}
              onMouseLeave={onTooltipClear}
            />
          )}
          <div
            className="capacity-stacked-bar"
            style={{ width: `${stackWidthPercent}%` }}
          >
            {weekRow.projectTotals.length > 0 && weekRow.plannedMinutes > 0 ? (
              weekRow.projectTotals.map((project) => {
                const projectId = capacityProjectId(project.key);
                const baseTooltip = `${project.name}\n${formatHours(project.minutes / 60)} geplant\n${project.blockerCount} Blocker${project.unresolvedHint ? `\nHinweis: ${project.unresolvedHint}` : ""}`;
                const tooltipText = projectId
                  ? `${baseTooltip}\n${CAPACITY_DETAIL_HINT}`
                  : baseTooltip;

                return (
                  <span
                    key={project.key}
                    className={`capacity-segment${projectId ? " capacity-segment-clickable" : ""}`}
                    aria-label={tooltipText}
                    role={projectId ? "button" : undefined}
                    tabIndex={projectId ? 0 : undefined}
                    style={{
                      width: `${(project.minutes / weekRow.plannedMinutes) * 100}%`,
                      background: projectColorFor(project.key),
                    }}
                    onMouseEnter={(event) => onTooltip(tooltipText, event)}
                    onMouseMove={(event) => onTooltip(tooltipText, event)}
                    onMouseLeave={onTooltipClear}
                    onClick={projectId ? () => openProjectDetail(projectId) : undefined}
                    onKeyDown={
                      projectId
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openProjectDetail(projectId);
                            }
                          }
                        : undefined
                    }
                  />
                );
              })
            ) : (
              <span
                className="capacity-empty-bar"
                aria-label="Keine geplante Projektzeit"
                title="Keine geplante Projektzeit"
              >
                -
              </span>
            )}
          </div>
          <span
            className="capacity-marker capacity-marker-target"
            style={{ left: `${customerMarkerPercent}%` }}
            aria-label={customerTargetTooltip}
            onMouseEnter={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseMove={(event) => onTooltip(customerTargetTooltip, event)}
            onMouseLeave={onTooltipClear}
          />
        </div>
      </div>
      )}
      <div className="capacity-week-stats">
        <span>
          {formatHours(weekRow.plannedMinutes / 60)}
          <span className="capacity-week-cap">
            {" "}
            / {formatHours(weekRow.effectiveCapacityHours)}
          </span>
        </span>
        <span
          style={{ color: getWorkloadColor(weekRow.utilizationPercent, customerPercent) }}
        >
          {formatDecimal(weekRow.utilizationPercent)}%
        </span>
      </div>
    </div>
  );
}

export function CapacityDayRow({
  day,
  projectColorFor,
  onTooltip,
  onTooltipClear,
}: {
  day: UserCapacityDay;
  projectColorFor: ProjectColorResolver;
  onTooltip: (text: string, event: MouseEvent<HTMLElement>) => void;
  onTooltipClear: () => void;
}) {
  const displayPercent = Math.max(100, day.utilizationPercent);
  const pct = (h: number) =>
    day.dayCapacityHours > 0
      ? (h / day.dayCapacityHours) * (10000 / displayPercent)
      : 0;
  const availableZonePercent = pct(day.effectiveCapacityHours);
  const absentZonePercent = pct(Math.min(day.dayCapacityHours, day.absentHours));
  const stackWidthPercent =
    day.dayCapacityHours > 0
      ? pct(day.plannedMinutes / 60)
      : day.plannedMinutes > 0
        ? 100
        : 0;
  const hasAbsent = absentZonePercent > 0;
  const isMorningAbsent = hasAbsent && day.absentHalf === "morning";
  const absentLabel =
    day.absentFraction >= 1
      ? "Ganztägig abwesend"
      : day.absentHalf === "morning"
        ? "Vormittags abwesend"
        : day.absentHalf === "afternoon"
          ? "Nachmittags abwesend"
          : "½ Tag abwesend";
  const absentTooltip = `Abwesenheit\n${absentLabel} · ${formatHours(day.absentHours)} weniger Kap.`;

  return (
    <div
      className={`capacity-day-row${day.isWeekend ? " capacity-day-row--weekend" : ""}`}
    >
      <span className="capacity-day-label">{day.label}</span>
      <div
        className="capacity-day-track"
        aria-label={`${day.label}: ${formatHours(day.plannedMinutes / 60)} geplant von ${formatHours(day.effectiveCapacityHours)} verfügbarer Kap.`}
      >
        <div
          className="capacity-day-inner"
          style={{ width: `${displayPercent}%` }}
        >
          {!day.isWeekend && (
            <div
              className={`capacity-zone${hasAbsent ? " capacity-zone--partial" : ""}`}
              style={{
                width: `${availableZonePercent}%`,
                left: isMorningAbsent ? `${absentZonePercent}%` : undefined,
              }}
            />
          )}
          {hasAbsent && (
            <div
              className={`capacity-absent-zone${availableZonePercent <= 0 ? " capacity-absent-zone--isolated" : ""}${isMorningAbsent ? " capacity-absent-zone--leading" : ""}`}
              style={{
                left: isMorningAbsent ? 0 : `${availableZonePercent}%`,
                width: `${absentZonePercent}%`,
              }}
              aria-label={absentTooltip}
              onMouseEnter={(event) => onTooltip(absentTooltip, event)}
              onMouseMove={(event) => onTooltip(absentTooltip, event)}
              onMouseLeave={onTooltipClear}
            />
          )}
          <div
            className="capacity-stacked-bar"
            style={{
              width: `${stackWidthPercent}%`,
              marginLeft: isMorningAbsent ? `${absentZonePercent}%` : undefined,
            }}
          >
            {day.segments.length > 0 && day.plannedMinutes > 0 ? (
              day.segments.map((segment) => {
                const tooltipText = `${segment.projectName}${segment.taskName ? ` · ${segment.taskName}` : ""}\n${segment.startHHmm}–${segment.endHHmm} · ${formatHours(segment.minutes / 60)}${segment.unresolvedHint ? `\nHinweis: ${segment.unresolvedHint}` : ""}`;

                return (
                  <span
                    key={segment.scheduleId}
                    className="capacity-segment"
                    aria-label={tooltipText}
                    style={{
                      width: `${day.plannedMinutes > 0 ? (segment.minutes / day.plannedMinutes) * 100 : 0}%`,
                      background: projectColorFor(segment.projectKey),
                    }}
                    onMouseEnter={(event) => onTooltip(tooltipText, event)}
                    onMouseMove={(event) => onTooltip(tooltipText, event)}
                    onMouseLeave={onTooltipClear}
                  />
                );
              })
            ) : null}
          </div>
        </div>
      </div>
      <span className="capacity-day-stats">
        {formatHours(day.plannedMinutes / 60)}
        <span className="capacity-week-cap">
          {" "}
          / {formatHours(day.effectiveCapacityHours)}
        </span>
      </span>
    </div>
  );
}
