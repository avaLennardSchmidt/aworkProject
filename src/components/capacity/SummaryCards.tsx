import { formatDecimal, formatHours } from "../../services/capacityFormat";

export function SummaryCards({
  totalPlannedHours,
  totalCapacityHours,
  totalAbsentHours,
  averageWorkload,
  overloadedUsers,
  isFiltered = false,
  overbookedFilterActive = false,
  onToggleOverbookedFilter,
}: {
  totalPlannedHours: number;
  totalCapacityHours: number;
  totalAbsentHours: number;
  averageWorkload: number;
  overloadedUsers: number;
  /** True when search/filters narrow the visible set the cards reflect. */
  isFiltered?: boolean;
  overbookedFilterActive?: boolean;
  onToggleOverbookedFilter?: () => void;
}) {
  return (
    <section className="panel analysis-summary-panel">
      <div className="analysis-summary-heading">
        <p className="eyebrow">Kapazitätszusammenfassung</p>
        <h2>
          Zahlen, Daten, Fakten
          {isFiltered ? (
            <span className="analysis-summary-filter-hint"> (gefiltert)</span>
          ) : null}
        </h2>
      </div>
      <div className="analysis-summary-grid">
        <SummaryCard
          label="Stunden"
          value={`${formatHours(totalPlannedHours)} / ${formatHours(totalCapacityHours)}`}
          title="Geplante Stunden geteilt durch die verfügbare Kapazität (nach Abwesenheiten) der angezeigten Nutzer im Zeitraum."
        />
        <SummaryCard
          label="Durchschnittliche Auslastung"
          value={`${formatDecimal(averageWorkload)}%`}
          title="Geplante Stunden geteilt durch Gesamtkapazität der angezeigten Nutzer."
        />
        <SummaryCard
          label="Urlaub"
          value={formatHours(totalAbsentHours)}
          title="Summe aller Abwesenheitsstunden (Urlaub, Feiertage) der angezeigten Nutzer im Zeitraum."
        />
        <SummaryCard
          label="Überbuchte Nutzer"
          value={String(overloadedUsers)}
          title={
            overbookedFilterActive
              ? "Filter aktiv: nur überbuchte Nutzer werden angezeigt. Klicken zum Zurücksetzen."
              : "Nutzer, deren geplante Zeit das Kunden-Ziel übersteigt (z. B. 77 % der verfügbaren Zeit geplant bei 70 % Kunden-Anteil). Klicken, um nur diese anzuzeigen."
          }
          active={overbookedFilterActive}
          onClick={onToggleOverbookedFilter}
        />
      </div>
    </section>
  );
}

export function SummaryCard({
  label,
  value,
  title,
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        className={`analysis-summary-card analysis-summary-card--clickable${active ? " analysis-summary-card--active" : ""}`}
        title={title}
        onClick={onClick}
      >
        <span>{label}</span>
        <strong>{value}</strong>
      </button>
    );
  }

  return (
    <div className="analysis-summary-card" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
