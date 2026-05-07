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
  const projectPlaceholder = hasLoadedSchedules ? "No project data in schedules" : "Load tasks first";

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
            onChange={(event) => onChange({ ...filters, from: event.target.value })}
          />
        </div>
        <div className="form-row">
          <label htmlFor="date-to">To</label>
          <input
            id="date-to"
            type="date"
            value={filters.to}
            disabled={disabled}
            onChange={(event) => onChange({ ...filters, to: event.target.value })}
          />
        </div>
        <div className="form-row">
          <label htmlFor="project-filter">Project</label>
          <select
            id="project-filter"
            value={filters.projectId}
            disabled={disabled || projectOptions.length === 0}
            onChange={(event) => onChange({ ...filters, projectId: event.target.value })}
          >
            <option value="">{projectOptions.length > 0 ? "All projects" : projectPlaceholder}</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <p className="field-hint">
            {projectOptions.length > 0
              ? "Project options come from your loaded planned task blockers."
              : projectPlaceholder}
          </p>
        </div>
      </div>

      <div className="filter-actions">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={filters.hidePast}
            disabled={disabled}
            onChange={(event) => onChange({ ...filters, hidePast: event.target.checked })}
          />
          Hide past blockers
        </label>
        <button type="button" className="primary-button" disabled={disabled || isLoading} onClick={onLoad}>
          {isLoading ? "Loading..." : "Load planned tasks"}
        </button>
      </div>
    </section>
  );
}
