import {
  addDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "date-fns";
import type { ReactNode } from "react";
import type { PlannerFilters } from "../types/planner";

interface ProjectOption {
  id: string;
  name: string;
}

interface FilterPanelProps {
  filters: PlannerFilters;
  projectOptions: ProjectOption[];
  disabled: boolean;
  hasLoadedSchedules: boolean;
  isLoading: boolean;
  workflowToggle?: ReactNode;
  onChange: (filters: PlannerFilters) => void;
  onLoad: () => void;
}

export function FilterPanel({
  filters,
  projectOptions,
  disabled,
  hasLoadedSchedules,
  isLoading,
  workflowToggle,
  onChange,
  onLoad,
}: FilterPanelProps) {
  const projectPlaceholder = hasLoadedSchedules
    ? "Keine Projektdaten vorhanden"
    : "Erst Aufgaben laden";

  function applyDatePreset(
    preset: "this-month" | "next-4-weeks" | "this-quarter" | "this-year",
  ) {
    const now = new Date();

    switch (preset) {
      case "this-month":
        onChange({
          ...filters,
          from: format(startOfMonth(now), "yyyy-MM-dd"),
          to: format(endOfMonth(now), "yyyy-MM-dd"),
        });
        return;
      case "next-4-weeks":
        onChange({
          ...filters,
          from: format(now, "yyyy-MM-dd"),
          to: format(addDays(now, 27), "yyyy-MM-dd"),
        });
        return;
      case "this-quarter":
        onChange({
          ...filters,
          from: format(startOfQuarter(now), "yyyy-MM-dd"),
          to: format(endOfQuarter(now), "yyyy-MM-dd"),
        });
        return;
      case "this-year":
        onChange({
          ...filters,
          from: format(startOfYear(now), "yyyy-MM-dd"),
          to: format(endOfYear(now), "yyyy-MM-dd"),
        });
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Workflow</p>
          <h2>Blocker</h2>
        </div>
        {workflowToggle}
      </div>

      <div className="filter-grid">
        <div className="form-row">
          <label htmlFor="date-from">Von</label>
          <input
            id="date-from"
            type="date"
            value={filters.from}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...filters, from: event.target.value })
            }
          />
        </div>
        <div className="form-row">
          <label htmlFor="date-to">Bis</label>
          <input
            id="date-to"
            type="date"
            value={filters.to}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...filters, to: event.target.value })
            }
          />
        </div>
        <div className="form-row project-filter-row">
          <label htmlFor="project-filter">Projekt</label>
          <select
            id="project-filter"
            value={filters.projectId}
            disabled={disabled || projectOptions.length === 0}
            onChange={(event) =>
              onChange({ ...filters, projectId: event.target.value })
            }
          >
            <option value="">
              {projectOptions.length > 0 ? "Alle Projekte" : projectPlaceholder}
            </option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="date-presets">
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => applyDatePreset("this-month")}
        >
          Diesen Monat
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => applyDatePreset("next-4-weeks")}
        >
          Nächste 4 Wochen
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => applyDatePreset("this-quarter")}
        >
          Dieses Quartal
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => applyDatePreset("this-year")}
        >
          Dieses Jahr
        </button>
      </div>

      <div className="filter-actions">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={filters.hidePast}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...filters, hidePast: event.target.checked })
            }
          />
          Vergangene Blocker ausblenden
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={filters.onlyAssigned}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...filters, onlyAssigned: event.target.checked })
            }
          />
          Nur mir zugewiesene Aufgaben
        </label>
        <button
          type="button"
          className="primary-button icon-button"
          disabled={disabled || isLoading}
          title={isLoading ? "Lädt..." : "Blocker laden"}
          aria-label={isLoading ? "Lädt..." : "Blocker laden"}
          onClick={onLoad}
        >
          {isLoading ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="spin">
              <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="28 16" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M15 9a6 6 0 0 1-10.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="M3 9a6 6 0 0 1 10.5-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="M13.5 5V2.5H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4.5 13v2.5H2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>
    </section>
  );
}
