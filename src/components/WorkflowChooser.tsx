export type PlannerWorkflow = "manage" | "create";

interface WorkflowChooserProps {
  value: PlannerWorkflow;
  disabled: boolean;
  onChange: (workflow: PlannerWorkflow) => void;
}

export function WorkflowChooser({ value, disabled, onChange }: WorkflowChooserProps) {
  return (
    <section className="panel workflow-panel">
      <div>
        <p className="eyebrow">Workflow</p>
        <h2>What do you want to do?</h2>
      </div>
      <div className="workflow-toggle" role="tablist" aria-label="Planner workflow">
        <button type="button" className={value === "manage" ? "active" : ""} disabled={disabled} onClick={() => onChange("manage")}>
          Manage existing groups
        </button>
        <button type="button" className={value === "create" ? "active" : ""} disabled={disabled} onClick={() => onChange("create")}>
          Create new group
        </button>
      </div>
    </section>
  );
}
