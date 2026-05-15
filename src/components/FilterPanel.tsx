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
  onChange: (filters: PlannerFilters) => void;
  onLoad: () => void;
}

export function FilterPanel({
  filters,
  projectOptions,
  disabled,
  hasLoadedSchedules,
  isLoading,
  onChange,
  onLoad,
}: FilterPanelProps) {
  const projectPlaceholder = hasLoadedSchedules
    ? "No project data in schedules"
    : "Load tasks first";

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
      <div>
        <p className="eyebrow">Filters</p>
        <h2>Load planned task blockers</h2>
      </div>

      <div className="filter-grid">
        <div className="form-row">
          <label htmlFor="date-from">From</label>
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
          <label htmlFor="date-to">To</label>
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
          <label htmlFor="project-filter">Project</label>
          <select
            id="project-filter"
            value={filters.projectId}
            disabled={disabled || projectOptions.length === 0}
            onChange={(event) =>
              onChange({ ...filters, projectId: event.target.value })
            }
          >
            <option value="">
              {projectOptions.length > 0 ? "All projects" : projectPlaceholder}
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
          This month
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => applyDatePreset("next-4-weeks")}
        >
          Next 4 weeks
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => applyDatePreset("this-quarter")}
        >
          This quarter
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => applyDatePreset("this-year")}
        >
          This year
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
          Hide past blockers
        </label>
        <button
          type="button"
          className="primary-button"
          disabled={disabled || isLoading}
          onClick={onLoad}
        >
          {isLoading ? "Loading..." : "Load planned tasks"}
        </button>
      </div>
    </section>
  );
}
