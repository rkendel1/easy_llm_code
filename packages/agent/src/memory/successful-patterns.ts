import type { TaskOutcome } from "../mutation/types.js";
export interface SuccessfulPattern {
  id: string; repositoryId: string; taskId: string; taskType: string; subsystem?: string; summary: string;
  files: string[]; approach: string; verification: string[]; model: string; outcome: TaskOutcome; timestamp: string;
}
export const rankSuccessfulPatterns = (patterns: SuccessfulPattern[], input: { taskType: string; subsystem?: string }): SuccessfulPattern[] =>
  [...patterns].sort((a, b) => {
    const score = (item: SuccessfulPattern): number => (item.taskType === input.taskType ? 2 : 0) + (input.subsystem && item.subsystem === input.subsystem ? 3 : 0) + (item.outcome.attempts === 1 ? 1 : 0);
    return score(b) - score(a) || b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id);
  });
