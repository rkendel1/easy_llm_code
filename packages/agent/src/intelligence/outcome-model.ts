import type { FailureClass } from "../task/lifecycle.js";

export interface OutcomeSignal {
  taskId: string; repositoryId: string; taskType: string; languages: string[]; frameworks: string[]; subsystem?: string;
  complexity: "low" | "medium" | "high"; model: string; provider: string; success: boolean; repaired: boolean;
  attempts: number; verificationPassed: boolean; failureClass?: FailureClass; cost?: number; latencyMs?: number; timestamp: string;
}
export interface ContextOutcome { taskId: string; strategy: "lexical" | "graph" | "history" | "cochange" | "memory"; selectedItems: number; tokenCount: number; outcome: "success" | "failure"; usefulness?: number }

export const outcomeQuality = (signal: OutcomeSignal): number => {
  let score = signal.success ? 1 : -1;
  score -= Math.max(0, signal.attempts - 1) * 0.15;
  if (!signal.verificationPassed) score -= 0.30;
  if (signal.cost !== undefined) score -= Math.min(0.10, signal.cost / 10);
  if (signal.latencyMs !== undefined) score -= Math.min(0.10, signal.latencyMs / 600_000);
  return Math.max(-1, Math.min(1, score));
};
