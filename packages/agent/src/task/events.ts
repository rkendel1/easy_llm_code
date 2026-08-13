import type { ContextMetrics } from "../context/types.js";
import type { ExecutionDecision, ReviewResult, RiskAssessment } from "../autonomy/types.js";

export type AgentEvent =
  | { type: "task.started"; taskId: string }
  | { type: "context.started" }
  | { type: "context.completed"; metrics: ContextMetrics }
  | { type: "routing.completed"; model: string; provider: string; score: number; confidence: "low" | "medium" | "high" }
  | { type: "impact.completed"; predictionId: string; affectedFiles: number; affectedTests: number; confidence: number }
  | { type: "execution.started"; executionId: string; mode: string }
  | { type: "execution.iteration.started"; iteration: number }
  | { type: "assumption.checked"; assumptionId: string; status: string }
  | { type: "assumption.contradicted"; assumptionId: string; evidence: string[] }
  | { type: "impact.recalculated"; predictionId: string; addedFiles: string[] }
  | { type: "context.refresh.started"; reason: string }
  | { type: "context.refresh.completed"; metrics: ContextMetrics }
  | { type: "routing.reconsidered"; iteration: number }
  | { type: "model.switched"; from: string; to: string; reason: string }
  | { type: "verification.escalated"; from: string; to: string; reason: string }
  | { type: "execution.decision"; decision: ExecutionDecision }
  | { type: "execution.replanned"; planId: string; iteration: number }
  | { type: "review.started"; iteration: number }
  | { type: "review.completed"; review: ReviewResult }
  | { type: "execution.risk"; risk: RiskAssessment }
  | { type: "execution.budget.warning"; dimensions: string[] }
  | { type: "execution.budget.exhausted"; dimensions: string[] }
  | { type: "execution.completed"; executionId: string }
  | { type: "planning.started" }
  | { type: "plan.created"; planId: string }
  | { type: "approval.required" }
  | { type: "mutation.started" }
  | { type: "mutation.completed"; files: string[] }
  | { type: "verification.started"; command: string }
  | { type: "verification.completed"; success: boolean }
  | { type: "repair.started"; attempt: number }
  | { type: "task.paused"; taskId: string }
  | { type: "task.completed"; taskId: string }
  | { type: "task.failed"; taskId: string; reason: string };

export interface PersistedAgentEvent { id: string; taskId: string; sequence: number; timestamp: string; event: AgentEvent }
