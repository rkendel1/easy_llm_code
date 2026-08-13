export interface RoutingCandidate {
  model: string; provider: string; capabilityMatch: number; historicalSuccess: number; complexityFit: number;
  costScore: number; latencyScore: number; finalScore: number; estimatedCost?: number; historicalEvidence: number;
}
export interface RoutingConfidence { level: "low" | "medium" | "high"; evidenceCount: number; comparableTasks: number; historicalSuccess?: number }
export interface RoutingReason { summary: string[]; confidence: RoutingConfidence; evidenceTaskIds: string[] }
export interface RoutingDecision {
  id: string; taskId: string; selectedModel: string; selectedProvider: string; candidates: RoutingCandidate[];
  reason: RoutingReason; score: number; estimatedCost?: number; profile: import("../intelligence/task-profile.js").TaskProfile; createdAt: string;
}
export interface RoutingFallback { id: string; taskId: string; originalModel: string; fallbackModel: string; reason: "unavailable" | "rate_limit" | "timeout" | "provider_error"; timestamp: string }
