import type { FailureClass } from "../task/lifecycle.js";
export interface FailurePattern {
  id: string; repositoryId: string; taskId: string; taskType: string; subsystem?: string; failureClass: FailureClass;
  description: string; attemptedApproach: string; failedFiles: string[]; repair?: string; timestamp: string;
}
export const rankFailurePatterns = (patterns: FailurePattern[], input: { taskType: string; subsystem?: string }): FailurePattern[] =>
  [...patterns].sort((a, b) => Number(b.subsystem === input.subsystem) - Number(a.subsystem === input.subsystem) || Number(b.taskType === input.taskType) - Number(a.taskType === input.taskType) || b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id));
