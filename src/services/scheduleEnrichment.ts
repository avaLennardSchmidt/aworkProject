import type { AworkProjectTask, AworkTaskSchedule } from "../types/awork";

export function enrichSchedulesWithProjectTasks(
  schedules: AworkTaskSchedule[],
  projectTasks: AworkProjectTask[],
): AworkTaskSchedule[] {
  const tasksById = new Map(projectTasks.map((task) => [task.id, task]));

  return schedules.map((schedule) => {
    if (schedule.projectId && schedule.projectName) {
      return schedule;
    }

    const task = tasksById.get(schedule.taskId);
    if (!task) {
      return {
        ...schedule,
        taskName: schedule.taskName ?? "Unknown task",
        projectName: schedule.projectName ?? "Project not resolved",
      };
    }

    return {
      ...schedule,
      taskName: schedule.taskName ?? task.name,
      projectId: schedule.projectId ?? task.projectId,
      projectName: schedule.projectName ?? task.projectName,
    };
  });
}
