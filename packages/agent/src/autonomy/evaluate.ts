import { exhaustedDimensions, remainingBudget } from "./budget.js";
import type { EvaluationInput, ExecutionDecision } from "./types.js";

export const evaluateExecution = (input: EvaluationInput): ExecutionDecision => {
  const exhausted = exhaustedDimensions(input.budget, input.usage), contradicted = input.assumptionChecks.filter((item) => item.assumption.status === "contradicted");
  let action: ExecutionDecision["action"], reason: string, evidence: string[] = [];
  if (exhausted.length) { action = "stop"; reason = `autonomous budget exhausted: ${exhausted.join(", ")}`; evidence = exhausted; }
  else if (contradicted.length) { action = "replan"; reason = "plan assumptions were contradicted"; evidence = contradicted.flatMap((item) => item.evidence); }
  else if (input.impactExpanded) { action = "replan"; reason = "recalculated impact materially expanded"; evidence = ["new high-confidence affected files discovered"]; }
  else if (input.ambiguous) { action = "escalate"; reason = "requirements remain ambiguous after bounded inspection"; evidence = ["runtime ambiguity signal"]; }
  else if (!input.verificationPassed && input.implementationFailure !== false) { action = "repair"; reason = "implementation failed while plan remains valid"; evidence = ["verification failure"]; }
  else if (!input.verificationPassed) { action = "replan"; reason = "verification invalidated the plan rather than only the implementation"; evidence = ["plan-level verification failure"]; }
  else { action = "continue"; reason = "verification and runtime invariants permit continuation"; evidence = ["verification passed", "no contradicted assumptions", "impact remains bounded"]; }
  return { id: `execution-decision:${input.taskId}:${input.iteration}`, taskId: input.taskId, iteration: input.iteration, action, reason, evidence, confidence: action === "continue" ? .9 : .8, risk: input.risk, budgetRemaining: remainingBudget(input.budget, input.usage), timestamp: new Date().toISOString() };
};
