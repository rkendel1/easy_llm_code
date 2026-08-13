import type { WorkspaceSnapshot } from "../mutation/types.js";
import type { TaskState } from "./state-machine.js";
import type { TaskMode } from "./lifecycle.js";
import type { AutonomyMode, BudgetUsage, RiskAssessment } from "../autonomy/types.js";

export interface TaskCheckpoint {
  taskId: string; state: TaskState; planId?: string; proposalId?: string; transactionId?: string;
  attempt: number; contextSelectionId?: string; lastVerificationId?: string; updatedAt: string;
  snapshot?: WorkspaceSnapshot;
  resumeState?: TaskState;
  mode?: TaskMode;
  routingDecisionId?: string;
  impactPredictionId?: string;
  executionId?: string;
  iteration?: number;
  autonomyMode?: AutonomyMode;
  budgetUsage?: BudgetUsage;
  riskAssessment?: RiskAssessment;
}
