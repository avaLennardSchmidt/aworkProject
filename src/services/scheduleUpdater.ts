import type { AworkUser } from "../types/awork";
import type { PreviewChange, UpdateResult } from "../types/planner";
import { isOwnSchedule } from "./scheduleMapper";

interface TaskScheduleUpdater {
  updateTaskSchedule(scheduleId: string, payload: unknown, userId?: string): Promise<unknown>;
}

export async function updateScheduleChanges(
  client: TaskScheduleUpdater,
  currentUser: AworkUser,
  changes: PreviewChange[],
): Promise<UpdateResult[]> {
  const results: UpdateResult[] = [];

  for (const change of changes) {
    if (!isOwnSchedule(change.schedule, currentUser)) {
      results.push({
        scheduleId: change.schedule.id,
        success: false,
        error: "Ownership could not be verified.",
      });
      continue;
    }

    try {
      const payload = buildUpdatePayload(change);
      await client.updateTaskSchedule(change.schedule.id, payload, currentUser.id);
      results.push({ scheduleId: change.schedule.id, success: true });
    } catch (error) {
      results.push({
        scheduleId: change.schedule.id,
        success: false,
        error: error instanceof Error ? error.message : "Update failed.",
      });
    }
  }

  return results;
}

export function buildUpdatePayload(change: PreviewChange): unknown {
  if (!isRecord(change.schedule.raw)) {
    return {
      start: change.newStartIso,
      end: change.newEndIso,
    };
  }

  // awork may require startDate/endDateTime/from/to instead of start/end. Keep this
  // payload merge isolated so real API testing only needs field adjustments here.
  const payload: Record<string, unknown> = {
    ...change.schedule.raw,
    start: change.newStartIso,
    end: change.newEndIso,
  };

  for (const key of ["startDate", "startDateTime", "from"]) {
    if (key in payload) {
      payload[key] = change.newStartIso;
    }
  }

  for (const key of ["endDate", "endDateTime", "to"]) {
    if (key in payload) {
      payload[key] = change.newEndIso;
    }
  }

  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
