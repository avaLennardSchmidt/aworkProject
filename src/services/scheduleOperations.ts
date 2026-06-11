import type { AworkUser } from "../types/awork";
import type { BlockerOperation, BlockerOperationResult, PreviewChange } from "../types/planner";
import { isOwnSchedule } from "./scheduleMapper";
import { buildUpdatePayload } from "./scheduleUpdater";

interface TaskScheduleOperationsClient {
  createTaskSchedule(payload: unknown): Promise<unknown>;
  deleteTaskSchedule(scheduleId: string, userId?: string): Promise<unknown>;
  updateTaskSchedule(scheduleId: string, payload: unknown, userId?: string): Promise<unknown>;
}

export async function applyBlockerOperations(
  client: TaskScheduleOperationsClient,
  currentUser: AworkUser,
  operations: BlockerOperation[],
): Promise<BlockerOperationResult[]> {
  const results: BlockerOperationResult[] = [];

  for (const operation of operations) {
    try {
      if (operation.kind === "update") {
        if (!isOwnSchedule(operation.schedule, currentUser)) {
          results.push({ operationId: operation.schedule.id, kind: operation.kind, success: false, error: "Ownership could not be verified." });
          continue;
        }

        const change: PreviewChange = operation;
        await client.updateTaskSchedule(operation.schedule.id, buildUpdatePayload(change), currentUser.id);
        results.push({ operationId: operation.schedule.id, kind: operation.kind, success: true });
        continue;
      }

      if (operation.kind === "delete") {
        if (!isOwnSchedule(operation.schedule, currentUser)) {
          results.push({ operationId: operation.schedule.id, kind: operation.kind, success: false, error: "Ownership could not be verified." });
          continue;
        }

        await client.deleteTaskSchedule(operation.schedule.id, currentUser.id);
        results.push({ operationId: operation.schedule.id, kind: operation.kind, success: true });
        continue;
      }

      if (operation.payload.userId !== currentUser.id) {
        results.push({ operationId: operation.tempId, kind: operation.kind, success: false, error: "Create payload does not belong to the selected planner user." });
        continue;
      }

      console.log("[applyBlockerOperations] Creating blocker:", {
        tempId: operation.tempId,
        payload: operation.payload,
      });
      const createResponse = await client.createTaskSchedule(operation.payload);
      console.log("[applyBlockerOperations] Create response:", createResponse);
      results.push({ operationId: operation.tempId, kind: operation.kind, success: true });
    } catch (error) {
      const operationId = operation.kind === "create" ? operation.tempId : operation.schedule.id;
      results.push({
        operationId,
        kind: operation.kind,
        success: false,
        error: error instanceof Error ? error.message : "Operation failed.",
      });
    }
  }

  return results;
}
