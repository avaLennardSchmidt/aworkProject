import { SegmentedControl } from "./SegmentedControl";

export type PlannerWorkflow = "manage" | "create" | "project";

interface WorkflowChooserProps {
  value: PlannerWorkflow;
  disabled: boolean;
  pulseWorkflow?: PlannerWorkflow;
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
  {
    value: "project" as const,
    label: "Projekt einplanen",
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.7"/>
        <path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
        <path d="M6.5 12l1.5 1.5L11 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

export function WorkflowChooser({
  value,
  disabled,
  pulseWorkflow,
  onChange,
}: WorkflowChooserProps) {
  const options = workflowOptions.map((option) => ({
    ...option,
    className: pulseWorkflow === option.value ? "workflow-option-pulse" : undefined,
    badgeText: pulseWorkflow === option.value ? "NEU" : undefined,
  }));

  return (
    <SegmentedControl
      value={value}
      options={options}
      ariaLabel="Planner-Workflow"
      disabled={disabled}
      onChange={onChange}
    />
  );
}
