import type { AgentPlan } from "../planning/types.js";
import type { AssumptionCheck, PlanAssumption } from "./types.js";

export const normalizeAssumptions = (plan: AgentPlan): PlanAssumption[] => plan.assumptions.map((item, index) => typeof item === "string" ? { id: `assumption:${plan.id}:${index}`, statement: item, evidence: [], status: "unverified" } : item);
export const checkPlanAssumptions = (taskId: string, iteration: number, plan: AgentPlan, evidence: string[]): AssumptionCheck[] => normalizeAssumptions(plan).map((assumption) => {
  const contradiction = evidence.find((item) => item.includes(`ASSUMPTION_CONTRADICTED:${assumption.id}`) || (/ASSUMPTION_CONTRADICTED|legacy compatibility|unexpected (?:owner|dependency|consumer)/i.test(item) && item.toLowerCase().includes(assumption.statement.split(/\s+/).filter((word) => word.length > 4)[0]?.toLowerCase() ?? "")));
  const confirmed = evidence.find((item) => item.includes(`ASSUMPTION_CONFIRMED:${assumption.id}`));
  const status = contradiction ? "contradicted" : confirmed ? "confirmed" : assumption.status;
  return { id: `assumption-check:${taskId}:${iteration}:${assumption.id}`, taskId, iteration, assumption: { ...assumption, status }, evidence: contradiction ? [contradiction] : confirmed ? [confirmed] : assumption.evidence, timestamp: new Date().toISOString() };
});
