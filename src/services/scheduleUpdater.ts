import type { AworkUser } from "../types/awork";
import type { PreviewChange, UpdateResult } from "../types/planner";
import type { BatchTaskSchedulesResult } from "./backendClient";
import { isOwnSchedule } from "./scheduleMapper";

interface TaskScheduleBatchClient {
  batchTaskSchedules(request: {
    userId?: string;
    update?: Array<{ id: string } & Record<string, unknown>>;
  }): Promise<BatchTaskSchedulesResult>;
}

export async function updateScheduleChanges(
  client: TaskScheduleBatchClient,
  currentUser: AworkUser,
  changes: PreviewChange[],
): Promise<UpdateResult[]> {
  const results: UpdateResult[] = [];
  const updatable: PreviewChange[] = [];

  for (const change of changes) {
    if (!isOwnSchedule(change.schedule, currentUser)) {
      results.push({
        scheduleId: change.schedule.id,
        success: false,
        error: "Ownership could not be verified.",
      });
      continue;
    }
    updatable.push(change);
  }

  if (updatable.length === 0) {
    return results;
  }

  try {
    const response = await client.batchTaskSchedules({
      userId: currentUser.id,
      update: updatable.map((change) => ({
        // Spread first, then pin id: the raw payload contains its own id field
        // and the batch route must key on the schedule id we intend to update.
        ...asRecord(buildUpdatePayload(change)),
        id: change.schedule.id,
      })),
    });

    const failedById = new Map(
      response.failed
        .filter((entry) => entry.id)
        .map((entry) => [entry.id as string, entry.error]),
    );

    for (const change of updatable) {
      const error = failedById.get(change.schedule.id);
      results.push(
        error
          ? { scheduleId: change.schedule.id, success: false, error }
          : { scheduleId: change.schedule.id, success: true },
      );
    }
  } catch (error) {
    // Whole-batch failure (network, 4xx envelope): every item fails alike.
    const message = error instanceof Error ? error.message : "Update failed.";
    for (const change of updatable) {
      results.push({
        scheduleId: change.schedule.id,
        success: false,
        error: message,
      });
    }
  }

  return results;
}

/** The subset of a PreviewChange the payload builder actually needs. */
export interface SchedulePayloadChange {
  schedule: PreviewChange["schedule"];
  newStartIso: string;
  newEndIso: string;
}

export function buildUpdatePayload(change: SchedulePayloadChange): unknown {
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

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
