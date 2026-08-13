import type { ImpactPrediction } from "../change-intelligence/types.js";
import type { TaskProfile } from "../intelligence/task-profile.js";

export type AutonomyMode = "safe" | "standard" | "aggressive";
export type ExecutionAction = "continue" | "replan" | "repair" | "stop" | "request_approval" | "escalate";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export interface AutonomousBudget {
  maxIterations: number; maxMutations: number; maxFilesChanged: number; maxLinesChanged: number; maxReplans: number;
  maxRepairs: number; maxVerificationTimeMs: number; maxModelSpend: number; maxWallClockMs: number;
}
export interface BudgetUsage { iterations: number; mutations: number; filesChanged: number; linesChanged: number; replans: number; repairs: number; verificationTimeMs: number; modelSpend: number; wallClockMs: number }
export interface BudgetRemaining extends BudgetUsage {}
export interface RiskAssessment { level: RiskLevel; score: number; reasons: string[]; verificationStrength: "weak" | "moderate" | "strong"; generatedAt: string }
export interface ExecutionDecision {
  id: string; taskId: string; iteration: number; action: ExecutionAction; reason: string; evidence: string[]; confidence: number;
  risk: RiskAssessment; budgetRemaining: BudgetRemaining; timestamp: string;
}
export interface PlanAssumption { id: string; statement: string; evidence: string[]; status: "unverified" | "confirmed" | "contradicted" }
export interface AssumptionCheck { id: string; taskId: string; iteration: number; assumption: PlanAssumption; evidence: string[]; timestamp: string }
export interface ReviewFinding { severity: RiskLevel; code: string; message: string; evidence: string[] }
export interface ReviewResult { id: string; taskId: string; iteration: number; status: "pass" | "concerns" | "fail"; findings: ReviewFinding[]; evidence: string[]; timestamp: string }
export interface AutonomousExecution { id: string; taskId: string; mode: AutonomyMode; budget: AutonomousBudget; usage: BudgetUsage; status: "running" | "paused" | "completed" | "failed"; startedAt: string; updatedAt: string; stopReason?: string }
export interface ExecutionPattern { id: string; repositoryId: string; taskType: string; subsystem?: string; risk: RiskLevel; strategy: string[]; success: boolean; replans: number; repairs: number; verificationScopes: string[]; taskId: string; timestamp: string }
export interface RiskInput { profile: TaskProfile; impact: ImpactPrediction; files: number; lines: number; historicalFailureRate: number; verificationCommands: number; dependencyCount?: number }
export interface EvaluationInput { taskId: string; iteration: number; risk: RiskAssessment; budget: AutonomousBudget; usage: BudgetUsage; verificationPassed: boolean; assumptionChecks: AssumptionCheck[]; impactExpanded: boolean; implementationFailure?: boolean; ambiguous?: boolean }
