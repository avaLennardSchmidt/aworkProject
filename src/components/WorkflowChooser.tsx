import { SegmentedControl } from "./SegmentedControl";

export type PlannerWorkflow = "manage" | "create";

interface WorkflowChooserProps {
  value: PlannerWorkflow;
  disabled: boolean;
  onChange: (workflow: PlannerWorkflow) => void;
}

const workflowOptions = [
  {
    value: "manage" as const,
    label: "Verwalten",
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        <path d="M14 13l2 2 3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    value: "create" as const,
    label: "Anlegen",
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
      </svg>
    ),
  },
];

export function WorkflowChooser({ value, disabled, onChange }: WorkflowChooserProps) {
  return (
    <SegmentedControl
      value={value}
      options={workflowOptions}
      ariaLabel="Planner-Workflow"
      disabled={disabled}
      onChange={onChange}
    />
  );
}
