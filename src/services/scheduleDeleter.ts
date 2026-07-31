import type { AworkUser } from "../types/awork";
import type { DeleteResult, ScheduleGroup } from "../types/planner";
import type { BatchTaskSchedulesResult } from "./backendClient";
import { isOwnSchedule } from "./scheduleMapper";

interface TaskScheduleBatchClient {
  batchTaskSchedules(request: {
    userId?: string;
    delete?: string[];
  }): Promise<BatchTaskSchedulesResult>;
}

export async function deleteScheduleGroup(
  client: TaskScheduleBatchClient,
  currentUser: AworkUser,
  group: ScheduleGroup,
): Promise<DeleteResult[]> {
  const results: DeleteResult[] = [];
  const deletable: string[] = [];

  for (const schedule of group.schedules) {
    if (!isOwnSchedule(schedule, currentUser)) {
      results.push({
        scheduleId: schedule.id,
        success: false,
        error: "Ownership could not be verified.",
      });
      continue;
    }
    deletable.push(schedule.id);
  }

  if (deletable.length === 0) {
    return results;
  }

  try {
    const response = await client.batchTaskSchedules({
      userId: currentUser.id,
      delete: deletable,
    });

    const failedById = new Map(
      response.failed
        .filter((entry) => entry.id)
        .map((entry) => [entry.id as string, entry.error]),
    );

    for (const scheduleId of deletable) {
      const error = failedById.get(scheduleId);
      results.push(
        error
          ? { scheduleId, success: false, error }
          : { scheduleId, success: true },
      );
    }
  } catch (error) {
    // Whole-batch failure: every item fails alike.
    const message = error instanceof Error ? error.message : "Unplan failed.";
    for (const scheduleId of deletable) {
      results.push({ scheduleId, success: false, error: message });
    }
  }

  return results;
}
