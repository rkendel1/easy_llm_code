import type { ProjectMemory } from "../memory/project-memory.js";
import type { RoutingDecision } from "../routing/decision.js";
import { rankFailurePatterns } from "../memory/failure-patterns.js";

export const explainRoutingDecision = (decision: RoutingDecision): string => {
  const selected = decision.candidates.find((item) => item.model === decision.selectedModel);
  return [`Routing decision`, `Task: ${decision.profile.taskType} / ${decision.profile.languages.join(", ") || "unknown language"} / ${decision.profile.estimatedComplexity} complexity`,
    `Selected: ${decision.selectedProvider}/${decision.selectedModel}`, `Score: ${decision.score.toFixed(3)}`, `Confidence: ${decision.reason.confidence.level} (${decision.reason.confidence.evidenceCount} comparable outcomes)`,
    `Profile: ${decision.profile.taskType}, ${decision.profile.estimatedComplexity} complexity`,
    selected ? `Components: capability ${selected.capabilityMatch.toFixed(2)}, history ${selected.historicalSuccess.toFixed(2)}, complexity ${selected.complexityFit.toFixed(2)}, cost ${selected.costScore.toFixed(2)}, latency ${selected.latencyScore.toFixed(2)}` : "",
    ...decision.reason.summary.map((reason) => `Why: ✓ ${reason}`),
    `Alternatives: ${decision.candidates.slice(1, 6).map((item) => `${item.model} ${item.finalScore.toFixed(3)}`).join(", ") || "none"}`,
    decision.reason.evidenceTaskIds.length ? `Evidence tasks: ${decision.reason.evidenceTaskIds.join(", ")}` : "Evidence tasks: none (cold start)"].filter(Boolean).join("\n");
};

export const explainTask = async (memory: ProjectMemory, taskId: string): Promise<string> => {
  const [decision, fallbacks, contextOutcomes, outcome, verificationRuns, failures, impact, predictionOutcomes] = await Promise.all([memory.getRoutingDecision(taskId), memory.getRoutingFallbacks(taskId), memory.listContextOutcomes(taskId), memory.getTaskOutcome(taskId), memory.getVerificationRuns(taskId), memory.listFailurePatterns(), memory.getImpactPrediction(taskId), memory.getPredictionOutcomes(taskId)]);
  if (!decision) return `No routing decision recorded for task ${taskId}.`;
  return [explainRoutingDecision(decision), `Outcome: ${outcome?.status ?? "pending"}${outcome ? `, ${outcome.attempts} attempt(s), verification ${outcome.verificationPassed ? "passed" : "failed"}` : ""}`,
    contextOutcomes.length ? `Context: ${contextOutcomes.map((item) => `${item.strategy}=${item.selectedItems}`).join(", ")}` : "Context: no outcome attribution recorded",
    fallbacks.length ? `Fallbacks: ${fallbacks.map((item) => `${item.originalModel} → ${item.fallbackModel} (${item.reason})`).join(", ")}` : "Fallbacks: none",
    verificationRuns.flatMap((run) => run.results).some((item) => item.status === "failed") ? `Repair trigger: ${verificationRuns.flatMap((run) => run.results).filter((item) => item.status === "failed").map((item) => `${item.command}: ${item.stderr.slice(0, 240) || item.classification}`).join("; ")}` : "Repair trigger: none",
    `Historical repair evidence: ${rankFailurePatterns(failures, { taskType: decision.profile.taskType, subsystem: decision.profile.subsystem }).filter((item) => item.taskId !== taskId).slice(0, 3).map((item) => `Task ${item.taskId}: ${item.description}${item.repair ? ` (${item.repair})` : ""}`).join("; ") || "none"}`,
    impact ? `Predicted change impact: ${impact.affectedFiles.map((item) => `${item.path} ${Math.round(item.confidence * 100)}% [${item.evidence.map((entry) => entry.description).join("; ")}]`).join(" | ") || "none"}` : "Predicted change impact: not recorded",
    impact?.assessment.decisions.length ? `Planner impact decisions: ${impact.assessment.decisions.map((item) => `${item.path}: ${item.decision} — ${item.reason}`).join(" | ")}` : "Planner impact decisions: none",
    predictionOutcomes.length ? `Prediction outcomes: ${predictionOutcomes.map((item) => `${item.file}: ${item.classification}`).join(", ")}` : "Prediction outcomes: pending or not applicable"].join("\n");
};
