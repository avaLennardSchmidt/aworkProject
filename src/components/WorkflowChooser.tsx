export type PlannerWorkflow = "manage" | "create";

interface WorkflowChooserProps {
  value: PlannerWorkflow;
  disabled: boolean;
  onChange: (workflow: PlannerWorkflow) => void;
}

export function WorkflowChooser({ value, disabled, onChange }: WorkflowChooserProps) {
  return (
    <div className={`workflow-toggle workflow-toggle--${value}`} role="tablist" aria-label="Planner workflow">
      <button
        type="button"
        role="tab"
        className={value === "manage" ? "active" : ""}
        disabled={disabled}
        onClick={() => onChange("manage")}
        title="Bestehende Gruppen verwalten"
        aria-label="Bestehende Gruppen verwalten"
        aria-selected={value === "manage"}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
          <path d="M14 13l2 2 3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <button
        type="button"
        role="tab"
        className={value === "create" ? "active" : ""}
        disabled={disabled}
        onClick={() => onChange("create")}
        title="Neue Gruppe anlegen"
        aria-label="Neue Gruppe anlegen"
        aria-selected={value === "create"}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
