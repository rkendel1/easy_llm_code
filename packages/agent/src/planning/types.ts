import type { IntelligentContextBundle } from "../context/types.js";
import type { ToolEvent } from "../execution/events.js";

export type PlanAction = "inspect" | "search" | "analyze" | "modify" | "test" | "verify";
export interface PlanStep {
  id: string; order: number; action: PlanAction; description: string;
  target?: string; dependencies: string[]; evidence: string[];
}
export interface Risk { id: string; description: string; severity: "low" | "medium" | "high"; evidence: string[] }
export interface VerificationStep { id: string; description: string; target?: string; evidence: string[] }
export interface AgentPlan {
  id: string; taskId: string; objective: string; assumptions: (string | import("../autonomy/types.js").PlanAssumption)[]; steps: PlanStep[];
  risks: Risk[]; expectedFiles: string[]; verification: VerificationStep[];
  impactAssessment?: import("../change-intelligence/types.js").ImpactAssessment;
}
export interface Evidence {
  id: string; taskId: string; source: "file" | "search" | "git" | "test" | "observation";
  reference: string; excerpt?: string; confidence: number;
}
export interface ToolRun { id: string; taskId: string; planId: string; stepId?: string; event: ToolEvent; timestamp: string }
export interface ModelExecution {
  id: string; taskId: string; model?: string; provider?: string; inputTokens?: number; outputTokens?: number;
  estimatedCost?: number; latencyMs?: number; phase?: "context" | "planning" | "mutation" | "repair";
}
export interface PlanningResult {
  taskId: string; context: IntelligentContextBundle; plan: AgentPlan;
  evidence: Evidence[]; events: ToolEvent[]; modelExecution: ModelExecution;
}
