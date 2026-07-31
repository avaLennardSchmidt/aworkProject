import type { PlannerWorkflow } from "../components/WorkflowChooser";

/**
 * Central route table. The app uses hash routing (#/manage, #/capacity, …)
 * because GitHub Pages cannot rewrite history-mode URLs on refresh.
 */
export const WORKFLOW_PATHS: Record<PlannerWorkflow, string> = {
  manage: "/manage",
  create: "/create",
  project: "/project",
};

export const CAPACITY_PATH = "/capacity";
export const DEFAULT_PATH = WORKFLOW_PATHS.manage;

/** Maps a router pathname to a workflow; unknown paths fall back to manage. */
export function pathToWorkflow(pathname: string): PlannerWorkflow {
  const entry = (
    Object.entries(WORKFLOW_PATHS) as Array<[PlannerWorkflow, string]>
  ).find(([, path]) => pathname === path || pathname.startsWith(`${path}/`));
  return entry?.[0] ?? "manage";
}

export function isCapacityPath(pathname: string): boolean {
  return pathname === CAPACITY_PATH || pathname.startsWith(`${CAPACITY_PATH}/`);
}
