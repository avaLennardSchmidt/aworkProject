import { useState } from "react";
import type { AworkProjectTask } from "../types/awork";

interface UnscheduledTasksPanelProps {
  tasks: AworkProjectTask[];
  hasLoaded: boolean;
}

export function UnscheduledTasksPanel({
  tasks,
  hasLoaded,
}: UnscheduledTasksPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  if (!hasLoaded || tasks.length === 0) {
    return null;
  }

  return (
    <section className="groups-section">
      <div className="section-heading">
        <p className="eyebrow">Active tasks</p>
        <h2>{tasks.length} unscheduled tasks in awork</h2>
      </div>

      <div className="panel unscheduled-panel">
        <button
          type="button"
          className="unscheduled-toggle"
          onClick={() => setIsCollapsed((current) => !current)}
          aria-expanded={!isCollapsed}
        >
          <span
            className={`collapse-indicator ${isCollapsed ? "collapsed" : ""}`}
            aria-hidden="true"
          >
            ▼
          </span>
          <span>
            These tasks are assigned and still visible in awork, but they do
            not currently have schedule blocks inside the selected date range.
          </span>
        </button>

        {!isCollapsed ? (
          <div className="groups-table-wrap">
            <table className="groups-table">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.name ?? "Untitled task"}</strong>
                    </td>
                    <td>{task.projectName ?? "Project not resolved"}</td>
                    <td>{task.statusName ?? task.statusType ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
