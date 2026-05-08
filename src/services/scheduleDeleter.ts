import type { AworkUser } from "../types/awork";
import type { DeleteResult, ScheduleGroup } from "../types/planner";
import { isOwnSchedule } from "./scheduleMapper";

interface TaskScheduleDeleter {
  deleteTaskSchedule(scheduleId: string, userId?: string): Promise<unknown>;
}

export async function deleteScheduleGroup(
  client: TaskScheduleDeleter,
  currentUser: AworkUser,
  group: ScheduleGroup,
): Promise<DeleteResult[]> {
  const results: DeleteResult[] = [];

  for (const schedule of group.schedules) {
    if (!isOwnSchedule(schedule, currentUser)) {
      results.push({
        scheduleId: schedule.id,
        success: false,
        error: "Ownership could not be verified.",
      });
      continue;
    }

    try {
      await client.deleteTaskSchedule(schedule.id, currentUser.id);
      results.push({ scheduleId: schedule.id, success: true });
    } catch (error) {
      results.push({
        scheduleId: schedule.id,
        success: false,
        error: error instanceof Error ? error.message : "Unplan failed.",
      });
    }
  }

  return results;
}
