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
import { DatePickerInput } from "./DatePickerInput";
import { formatSearchPlaceholder, SearchableSelect } from "./SearchableSelect";

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
          <DatePickerInput
            id="date-from"
            value={filters.from}
            disabled={disabled}
            onChange={(value) => onChange({ ...filters, from: value })}
          />
        </div>
        <div className="form-row">
          <label htmlFor="date-to">Bis</label>
          <DatePickerInput
            id="date-to"
            value={filters.to}
            disabled={disabled}
            onChange={(value) => onChange({ ...filters, to: value })}
          />
        </div>
        <div className="form-row project-filter-row">
          <label htmlFor="project-filter">Projekt</label>
          <SearchableSelect
            buttonId="project-filter"
            value={filters.projectId}
            disabled={disabled || projectOptions.length === 0}
            options={[
              {
                value: "",
                label:
                  projectOptions.length > 0
                    ? "Alle Projekte"
                    : projectPlaceholder,
              },
              ...projectOptions.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
            placeholder={
              projectOptions.length > 0 ? "Alle Projekte" : projectPlaceholder
            }
            searchPlaceholder={formatSearchPlaceholder(
              "Projekte filtern",
              projectOptions.length,
            )}
            emptyLabel="Keine Projekte gefunden"
            onChange={(value) => onChange({ ...filters, projectId: value })}
          />
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
          className="primary-button"
          disabled={disabled || isLoading}
          onClick={onLoad}
        >
          {isLoading ? (
            <>
              <span className="button-spinner" aria-hidden="true" />
              Wird geladen...
            </>
          ) : (
            <>
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M15 9a6 6 0 0 1-10.5 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M3 9a6 6 0 0 1 10.5-4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M13.5 5V2.5H16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4.5 13v2.5H2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Blocker laden
            </>
          )}
        </button>
      </div>
    </section>
  );
}
