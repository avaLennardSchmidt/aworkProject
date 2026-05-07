import { useMemo, useState } from "react";
import type { ScheduleGroup } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";

interface ScheduleGroupsListProps {
  groups: ScheduleGroup[];
  hasLoaded: boolean;
  onChangeTimeWindow: (group: ScheduleGroup) => void;
  onDeleteGroup: (group: ScheduleGroup) => void;
}

interface ProjectSection {
  projectKey: string;
  projectName: string;
  groups: ScheduleGroup[];
}

export function ScheduleGroupsList({ groups, hasLoaded, onChangeTimeWindow, onDeleteGroup }: ScheduleGroupsListProps) {
  const projectSections = useMemo(() => buildProjectSections(groups), [groups]);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  const toggleProject = (projectKey: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectKey)) {
        next.delete(projectKey);
      } else {
        next.add(projectKey);
      }
      return next;
    });
  };

  if (!hasLoaded) {
    return null;
  }

  if (groups.length === 0) {
    return (
      <section className="panel empty-state">
        <h2>No editable schedule groups found</h2>
        <p>No own planned task blockers matched the current filters.</p>
      </section>
    );
  }

  return (
    <section className="groups-section">
      <div className="section-heading">
        <p className="eyebrow">Schedule groups</p>
        <h2>{groups.length} editable groups</h2>
      </div>

      <div className="groups-table-wrap">
        <table className="groups-table">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Pattern</th>
              <th scope="col">Blockers</th>
              <th scope="col">Total</th>
              <th scope="col">First</th>
              <th scope="col">Last</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {projectSections.map((section) => (
              <ProjectRows
                key={section.projectKey}
                section={section}
                collapsed={collapsedProjects.has(section.projectKey)}
                onToggle={() => toggleProject(section.projectKey)}
                onChangeTimeWindow={onChangeTimeWindow}
                onDeleteGroup={onDeleteGroup}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProjectRows({
  section,
  collapsed,
  onToggle,
  onChangeTimeWindow,
  onDeleteGroup,
}: {
  section: ProjectSection;
  collapsed: boolean;
  onToggle: () => void;
  onChangeTimeWindow: (group: ScheduleGroup) => void;
  onDeleteGroup: (group: ScheduleGroup) => void;
}) {
  const projectTotalMinutes = section.groups.reduce((sum, group) => sum + group.totalMinutes, 0);
  const blockerCount = section.groups.reduce((sum, group) => sum + group.schedules.length, 0);

  return (
    <>
      <tr className="project-row" onClick={onToggle}>
        <th scope="rowgroup" colSpan={7}>
          <span className={`collapse-indicator ${collapsed ? "collapsed" : ""}`}>▼</span>
          <span>{section.projectName}</span>
          <small>
            {section.groups.length} groups · {blockerCount} blockers · {formatMinutesAsHours(projectTotalMinutes)}
          </small>
        </th>
      </tr>
      {!collapsed && section.groups.map((group) => (
        <tr key={group.groupId}>
          <td>
            <div className="task-cell">
              <strong>{group.taskName}</strong>
              <span>{group.taskId}</span>
            </div>
          </td>
          <td>
            <span className="time-window table-time-window">
              {group.weekdayLabel} {group.startTime}-{group.endTime}
            </span>
          </td>
          <td>{group.schedules.length}</td>
          <td>{formatMinutesAsHours(group.totalMinutes)}</td>
          <td>{group.firstDate}</td>
          <td>{group.lastDate}</td>
          <td>
            <div className="table-actions">
              <button type="button" className="secondary-button table-action-button" onClick={() => onChangeTimeWindow(group)}>
                Change time window
              </button>
              <button type="button" className="delete-x-button" title="Delete group" onClick={() => onDeleteGroup(group)}>
                ×
              </button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function buildProjectSections(groups: ScheduleGroup[]): ProjectSection[] {
  const sections = new Map<string, ProjectSection>();

  groups.forEach((group) => {
    const projectKey = group.projectId ?? "no-project";
    const projectName = group.projectName ?? "Project not resolved";
    const section = sections.get(projectKey) ?? {
      projectKey,
      projectName,
      groups: [],
    };

    section.groups.push(group);
    sections.set(projectKey, section);
  });

  return Array.from(sections.values())
    .map((section) => ({
      ...section,
      groups: section.groups.sort(compareGroupsWithinProject),
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

function compareGroupsWithinProject(a: ScheduleGroup, b: ScheduleGroup): number {
  return (
    a.taskName.localeCompare(b.taskName) ||
    a.weekday - b.weekday ||
    a.startTime.localeCompare(b.startTime) ||
    a.endTime.localeCompare(b.endTime)
  );
}
