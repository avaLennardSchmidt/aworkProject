import { formatDecimal, formatHours } from "../../services/capacityFormat";

export function SummaryCards({
  totalPlannedHours,
  totalCapacityHours,
  totalAbsentHours,
  averageWorkload,
  overloadedUsers,
}: {
  totalPlannedHours: number;
  totalCapacityHours: number;
  totalAbsentHours: number;
  averageWorkload: number;
  overloadedUsers: number;
}) {
  return (
    <section className="panel analysis-summary-panel">
      <div className="analysis-summary-heading">
        <p className="eyebrow">Kapazitätszusammenfassung</p>
        <h2>Zahlen, Daten, Fakten</h2>
      </div>
      <div className="analysis-summary-grid">
        <SummaryCard
          label="Stunden"
          value={`${formatHours(totalPlannedHours)} / ${formatHours(totalCapacityHours)}`}
          title="Geplante Stunden geteilt durch die verfügbare Kapazität (nach Abwesenheiten) aller ausgewählten Nutzer im Zeitraum."
        />
        <SummaryCard
          label="Durchschnittliche Auslastung"
          value={`${formatDecimal(averageWorkload)}%`}
          title="Geplante Stunden geteilt durch Gesamtkapazität der ausgewählten Nutzer."
        />
        <SummaryCard
          label="Urlaub"
          value={formatHours(totalAbsentHours)}
          title="Summe aller Abwesenheitsstunden (Urlaub, Feiertage) aller ausgewählten Nutzer im Zeitraum."
        />
        <SummaryCard
          label="Überbuchte Nutzer"
          value={String(overloadedUsers)}
          title="Nutzer, deren geplante Zeit das Kunden-Ziel übersteigt (z. B. 77 % der verfügbaren Zeit geplant bei 70 % Kunden-Anteil)."
        />
      </div>
    </section>
  );
}

export function SummaryCard({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title: string;
}) {
  return (
    <div className="analysis-summary-card" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
