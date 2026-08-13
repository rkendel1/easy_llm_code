import type { WorkspaceSnapshot } from "../mutation/types.js";
import type { TaskState } from "./state-machine.js";
import type { TaskMode } from "./lifecycle.js";

export interface TaskCheckpoint {
  taskId: string; state: TaskState; planId?: string; proposalId?: string; transactionId?: string;
  attempt: number; contextSelectionId?: string; lastVerificationId?: string; updatedAt: string;
  snapshot?: WorkspaceSnapshot;
  resumeState?: TaskState;
  mode?: TaskMode;
}
