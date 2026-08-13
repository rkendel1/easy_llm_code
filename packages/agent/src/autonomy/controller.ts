import type { ProjectMemory } from "../memory/project-memory.js";
import { emptyBudgetUsage, exhaustedDimensions, nearBudgetLimit, remainingBudget } from "./budget.js";
import { evaluateExecution } from "./evaluate.js";
import { DEFAULT_AUTONOMOUS_BUDGET, requiresApproval } from "./policy.js";
import { assessAutonomousRisk } from "./risk.js";
import type { AutonomousBudget, AutonomousExecution, AutonomyMode, BudgetUsage, EvaluationInput, ExecutionDecision, RiskInput } from "./types.js";

export const createAutonomousController = (options: { memory: ProjectMemory; mode?: AutonomyMode; budget?: Partial<AutonomousBudget> }) => {
  const mode = options.mode ?? "standard", budget: AutonomousBudget = { ...DEFAULT_AUTONOMOUS_BUDGET, ...options.budget };
  return {
    budget,
    mode,
    async start(taskId: string): Promise<AutonomousExecution> { const now = new Date().toISOString(), execution = { id: `execution:${taskId}`, taskId, mode, budget, usage: emptyBudgetUsage(), status: "running" as const, startedAt: now, updatedAt: now }; await options.memory.persistAutonomousExecution(execution); return execution; },
    assessRisk(input: RiskInput) { return assessAutonomousRisk(input); },
    requiresApproval(risk: ReturnType<typeof assessAutonomousRisk>) { return requiresApproval(mode, risk.level, risk.verificationStrength === "strong"); },
    async decide(input: EvaluationInput): Promise<ExecutionDecision> { const prior = await options.memory.getExecutionDecisions(input.taskId), evaluated = evaluateExecution(input), decision = { ...evaluated, id: `${evaluated.id}:${prior.length}` }; await options.memory.persistExecutionDecision(decision); return decision; },
    async requestApproval(taskId: string, iteration: number, risk: ReturnType<typeof assessAutonomousRisk>, usage: BudgetUsage): Promise<ExecutionDecision> { const prior = await options.memory.getExecutionDecisions(taskId), decision: ExecutionDecision = { id: `execution-decision:${taskId}:${iteration}:${prior.length}`, taskId, iteration, action: "request_approval", reason: `${mode} autonomy policy requires approval for ${risk.level} risk`, evidence: risk.reasons, confidence: 1, risk, budgetRemaining: remainingBudget(budget, usage), timestamp: new Date().toISOString() }; await options.memory.persistExecutionDecision(decision); return decision; },
    budgetState(usage: BudgetUsage) { return { exhausted: exhaustedDimensions(budget, usage), warning: nearBudgetLimit(budget, usage) }; },
    async update(execution: AutonomousExecution, usage: BudgetUsage, status: AutonomousExecution["status"] = execution.status, stopReason?: string): Promise<AutonomousExecution> { const updated = { ...execution, usage, status, stopReason, updatedAt: new Date().toISOString() }; await options.memory.persistAutonomousExecution(updated); return updated; }
  };
};
