import type { ProjectMemory } from "../memory/project-memory.js";
import { explainModelRoute } from "../model/llm-cx.js";
import type { TaskProfile } from "../intelligence/task-profile.js";
import type { RoutingCandidate, RoutingDecision } from "./decision.js";
import { selectModel, type ModelSelectionInput } from "./model-selector.js";

const asCandidate = (value: Awaited<ReturnType<typeof explainModelRoute>>["candidates"][number]): RoutingCandidate => ({ model: value.modelId, provider: value.provider, capabilityMatch: value.scoreBreakdown.capability, historicalSuccess: value.health.successRate ?? .5, complexityFit: value.scoreBreakdown.evidence, costScore: value.scoreBreakdown.cost, latencyScore: value.scoreBreakdown.health, finalScore: value.score, historicalEvidence: value.health.sampleCount });

export const selectRuntimeModel = async (memory: ProjectMemory, input: ModelSelectionInput & { request: string; profile: TaskProfile }): Promise<RoutingDecision> => {
  if (input.models) return selectModel(memory, input);
  try {
    const explanation = await explainModelRoute({ messages: [{ role: "user", content: input.request }], model: input.model ?? "auto", strictCapabilities: true }), selected = asCandidate(explanation.selected), alternatives = explanation.candidates.filter((item) => item.compatibility !== "incompatible").map(asCandidate), candidates = [selected, ...alternatives.filter((item) => item.model !== selected.model)];
    const decision: RoutingDecision = { id: `routing:${input.taskId}${input.iteration === undefined ? "" : `:${input.iteration}`}`, taskId: input.taskId, selectedModel: selected.model, selectedProvider: selected.provider, candidates, score: selected.finalScore, profile: input.profile, createdAt: new Date().toISOString(), reason: { summary: explanation.reasons, confidence: { level: explanation.selected.confidence >= .8 ? "high" : explanation.selected.confidence >= .5 ? "medium" : "low", evidenceCount: explanation.selected.health.sampleCount, comparableTasks: explanation.selected.health.sampleCount, historicalSuccess: explanation.selected.health.successRate }, evidenceTaskIds: [] } };
    await memory.persistRoutingDecision(decision); return decision;
  } catch { return selectModel(memory, input); }
};
