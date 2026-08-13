import type { ImpactPrediction } from "../change-intelligence/types.js";
import type { MutationProposal } from "../mutation/types.js";
import type { AgentPlan } from "../planning/types.js";
import type { VerificationRun } from "../verification/types.js";
import type { AssumptionCheck, ReviewFinding, ReviewResult, RiskAssessment } from "./types.js";

export const reviewExecution = (input: { taskId: string; iteration: number; request: string; plan: AgentPlan; proposal: MutationProposal; impact: ImpactPrediction; verification: VerificationRun; assumptions: AssumptionCheck[]; risk: RiskAssessment }): ReviewResult => {
  const findings: ReviewFinding[] = [], actual = new Set(input.proposal.files.map((file) => file.path)), allowed = new Set([...input.plan.expectedFiles, ...input.impact.targets, ...input.impact.affectedFiles.map((item) => item.path)]);
  if (!input.verification.passed) findings.push({ severity: "critical", code: "VERIFICATION_FAILED", message: "Required verification did not pass", evidence: [input.verification.id] });
  for (const assumption of input.assumptions.filter((item) => item.assumption.status !== "confirmed")) findings.push({ severity: "high", code: `ASSUMPTION_${assumption.assumption.status.toUpperCase()}`, message: assumption.assumption.statement, evidence: assumption.evidence });
  for (const decision of input.plan.impactAssessment?.decisions ?? []) if (decision.decision === "not_modified" && !decision.reason.trim()) findings.push({ severity: "high", code: "IMPACT_UNACCOUNTED", message: decision.path, evidence: [] });
  for (const file of actual) if (!allowed.has(file)) findings.push({ severity: "high", code: "UNRELATED_CHANGE", message: `${file} was not planned or predicted`, evidence: [file] });
  if (!input.proposal.files.length) findings.push({ severity: "high", code: "OBJECTIVE_NOT_MUTATED", message: "No mutation addressed the requested objective", evidence: [input.request] });
  const status = findings.some((item) => item.severity === "critical" || item.severity === "high") ? "fail" : findings.length ? "concerns" : "pass";
  return { id: `review:${input.taskId}:${input.iteration}`, taskId: input.taskId, iteration: input.iteration, status, findings, evidence: [input.plan.id, input.proposal.id, input.verification.id, input.impact.id], timestamp: new Date().toISOString() };
};
