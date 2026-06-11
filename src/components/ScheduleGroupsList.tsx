import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fuzzyMatches } from "../services/fuzzySearch";
import type { ScheduleGroup } from "../types/planner";
import { formatMinutesAsHours } from "../services/scheduleTimeCalculator";

interface ScheduleGroupsListProps {
  groups: ScheduleGroup[];
  hasLoaded: boolean;
  selectedGroupIds: Set<string>;
  onSelectionChange: (groupIds: Set<string>) => void;
  onChangeTimeWindow: (group: ScheduleGroup) => void;
  onDeleteGroup: (group: ScheduleGroup) => void;
  onMultiEdit: () => void;
  isMultiEditAvailable?: boolean;
}

interface ProjectSection {
  projectKey: string;
  projectName: string;
  groups: ScheduleGroup[];
}

export function ScheduleGroupsList({
  groups,
  hasLoaded,
  selectedGroupIds,
  onSelectionChange,
  onChangeTimeWindow,
  onDeleteGroup,
  onMultiEdit,
  isMultiEditAvailable = true,
}: ScheduleGroupsListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim();
  const filteredGroups = useMemo(
    () => filterGroups(groups, searchQuery),
    [groups, searchQuery],
  );
  const projectSections = useMemo(
    () => buildProjectSections(filteredGroups),
    [filteredGroups],
  );
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set(),
  );

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

  const visibleGroups = useMemo(() => {
    if (normalizedSearchQuery) {
      return filteredGroups;
    }

    return projectSections.flatMap((section) =>
      collapsedProjects.has(section.projectKey) ? [] : section.groups,
    );
  }, [
    collapsedProjects,
    filteredGroups,
    normalizedSearchQuery,
    projectSections,
  ]);

  const selectableGroupIds = useMemo(
    () => new Set(visibleGroups.map((group) => group.groupId)),
    [visibleGroups],
  );

  const visibleSelectedCount = visibleGroups.filter((group) =>
    selectedGroupIds.has(group.groupId),
  ).length;

  function toggleGroupSelection(groupId: string, selected: boolean) {
    const next = new Set(selectedGroupIds);
    if (selected) {
      next.add(groupId);
    } else {
      next.delete(groupId);
    }
    onSelectionChange(next);
  }

  function toggleVisibleSelection(selected: boolean) {
    const next = new Set(selectedGroupIds);
    selectableGroupIds.forEach((groupId) => {
      if (selected) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
    });
    onSelectionChange(next);
  }

  if (!hasLoaded) {
    return null;
  }

  if (groups.length === 0) {
    return (
      <section className="panel empty-state">
        <h2>Keine bearbeitbaren Gruppen gefunden</h2>
        <p>
          Keine geplanten Blocker für die aktuellen Filter und den ausgewählten
          Planner-Nutzer.
        </p>
        <p className="empty-state-hint">
          Tipp: Zeitraum oder Projektfilter oben anpassen — oder zum Workflow
          „Anlegen" wechseln, um neue Blocker zu erstellen.
        </p>
      </section>
    );
  }

  return (
    <section className="groups-section">
      <div className="section-heading">
        <p className="eyebrow">Blocker-Gruppen</p>
        <h2>{filteredGroups.length} bearbeitbare Gruppen</h2>
      </div>

      <div className="groups-search-row">
        <label htmlFor="groups-search">Gruppen suchen</label>
        <input
          id="groups-search"
          type="search"
          value={searchQuery}
          placeholder="Aufgabe, Projekt, Wochentag, Uhrzeit..."
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <div className="groups-bulk-actions">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={
              visibleGroups.length > 0 &&
              visibleSelectedCount === visibleGroups.length
            }
            disabled={visibleGroups.length === 0}
            onChange={(event) => toggleVisibleSelection(event.target.checked)}
          />
          Sichtbare Gruppen auswählen
        </label>
        <span>{selectedGroupIds.size} ausgewählt</span>
        <button
          type="button"
          className="primary-button"
          disabled={selectedGroupIds.size < 1 || !isMultiEditAvailable}
          title={
            !isMultiEditAvailable ? "Gruppenbearbeitung nicht verfügbar" : ""
          }
          onClick={onMultiEdit}
        >
          Gruppen bearbeiten
        </button>
      </div>

      {filteredGroups.length === 0 ? (
        <section className="panel empty-state groups-search-empty">
          <h2>Keine Gruppen gefunden</h2>
          <p>
            Für „{normalizedSearchQuery}" gibt es keine Treffer. Mit Aufgabe,
            Projekt, Wochentag oder Zeitfenster suchen — z.B. „Montag 09:00".
          </p>
        </section>
      ) : null}

      {filteredGroups.length > 0 ? (
        <div className="groups-table-wrap">
          <table className="groups-table">
            <thead>
              <tr>
                <th scope="col">Auswahl</th>
                <th scope="col">Aufgabe</th>
                <th scope="col">Muster</th>
                <th scope="col">Blocker</th>
                <th scope="col">Gesamt</th>
                <th scope="col">Erster</th>
                <th scope="col">Letzter</th>
                <th scope="col">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {projectSections.map((section) => (
                <ProjectRows
                  key={section.projectKey}
                  section={section}
                  collapsed={
                    !normalizedSearchQuery &&
                    collapsedProjects.has(section.projectKey)
                  }
                  selectedGroupIds={selectedGroupIds}
                  onToggle={() => toggleProject(section.projectKey)}
                  onSelectionChange={toggleGroupSelection}
                  onChangeTimeWindow={onChangeTimeWindow}
                  onDeleteGroup={onDeleteGroup}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ProjectRows({
  section,
  collapsed,
  onToggle,
  selectedGroupIds,
  onSelectionChange,
  onChangeTimeWindow,
  onDeleteGroup,
}: {
  section: ProjectSection;
  collapsed: boolean;
  onToggle: () => void;
  selectedGroupIds: Set<string>;
  onSelectionChange: (groupId: string, selected: boolean) => void;
  onChangeTimeWindow: (group: ScheduleGroup) => void;
  onDeleteGroup: (group: ScheduleGroup) => void;
}) {
  const projectTotalMinutes = section.groups.reduce(
    (sum, group) => sum + group.totalMinutes,
    0,
  );
  const blockerCount = section.groups.reduce(
    (sum, group) => sum + group.schedules.length,
    0,
  );

  return (
    <>
      <tr className="project-row" onClick={onToggle}>
        <th scope="rowgroup" colSpan={8}>
          <span
            className={`collapse-indicator ${collapsed ? "collapsed" : ""}`}
          >
            ▼
          </span>
          <span>{section.projectName}</span>
          <small>
            {section.groups.length} Gruppen · {blockerCount} Blocker ·{" "}
            {formatMinutesAsHours(projectTotalMinutes)}
          </small>
        </th>
      </tr>
      <AnimatePresence initial={false}>
        {!collapsed &&
          section.groups.map((group) => (
            <motion.tr
              key={group.groupId}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <td>
                <input
                  type="checkbox"
                  className="group-select-checkbox"
                  checked={selectedGroupIds.has(group.groupId)}
                  aria-label={`${group.taskName} auswählen`}
                  onChange={(event) =>
                    onSelectionChange(group.groupId, event.target.checked)
                  }
                />
              </td>
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
                  <button
                    type="button"
                    className="table-icon-button table-edit-button"
                    title="Zeitfenster ändern"
                    aria-label="Zeitfenster ändern"
                    onClick={() => onChangeTimeWindow(group)}
                  >
                    <span aria-hidden="true">✎</span>
                  </button>
                  <button
                    type="button"
                    className="table-icon-button table-delete-button"
                    title="Gruppe ausplanen"
                    aria-label="Gruppe ausplanen"
                    onClick={() => onDeleteGroup(group)}
                  >
                    <span aria-hidden="true">x</span>
                  </button>
                </div>
              </td>
            </motion.tr>
          ))}
      </AnimatePresence>
    </>
  );
}

function filterGroups(groups: ScheduleGroup[], query: string): ScheduleGroup[] {
  if (!query.trim()) return groups;

  return groups.filter((group) =>
    [
      group.taskName,
      group.projectName,
      group.weekdayLabel,
      group.startTime,
      group.endTime,
      group.startTime + "-" + group.endTime,
      group.weekdayLabel + " " + group.startTime + "-" + group.endTime,
    ]
      .filter(Boolean)
      .some((value) => fuzzyMatches(String(value), query)),
  );
}

function buildProjectSections(groups: ScheduleGroup[]): ProjectSection[] {
  const sections = new Map<string, ProjectSection>();

  groups.forEach((group) => {
    const projectKey = group.projectId ?? "no-project";
    const projectName = group.projectName ?? "Projekt nicht aufgelöst";
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

function compareGroupsWithinProject(
  a: ScheduleGroup,
  b: ScheduleGroup,
): number {
  return (
    a.taskName.localeCompare(b.taskName) ||
    a.weekday - b.weekday ||
    a.startTime.localeCompare(b.startTime) ||
    a.endTime.localeCompare(b.endTime)
  );
}
