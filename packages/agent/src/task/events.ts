import type { ContextMetrics } from "../context/types.js";

export type AgentEvent =
  | { type: "task.started"; taskId: string }
  | { type: "context.started" }
  | { type: "context.completed"; metrics: ContextMetrics }
  | { type: "routing.completed"; model: string; provider: string; score: number; confidence: "low" | "medium" | "high" }
  | { type: "impact.completed"; predictionId: string; affectedFiles: number; affectedTests: number; confidence: number }
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
