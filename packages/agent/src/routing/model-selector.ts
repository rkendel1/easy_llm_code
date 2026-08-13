import type { ModelDefinition } from "@easy-llm/llm";
import type { ProjectMemory } from "../memory/project-memory.js";
import { retrieveComparableOutcomes } from "../memory/outcome-retrieval.js";
import { DEFAULT_ROUTING_POLICY } from "../intelligence/routing-policy.js";
import { sortRoutingCandidates } from "../intelligence/routing-score.js";
import type { TaskProfile } from "../intelligence/task-profile.js";
import { buildRoutingCandidates, loadRegistryModels } from "./candidate-builder.js";
import type { RoutingDecision } from "./decision.js";

export interface ModelSelectionInput { taskId: string; profile: TaskProfile; budget?: number; model?: string; models?: ModelDefinition[]; iteration?: number }
export const selectModel = async (memory: ProjectMemory, input: ModelSelectionInput): Promise<RoutingDecision> => {
  const models = input.models ?? await loadRegistryModels(), outcomes = await retrieveComparableOutcomes(memory, input.profile);
  let built = buildRoutingCandidates(models, input.profile, outcomes, input.budget);
  const preference = input.model ?? "auto";
  if (!["auto", "cheap", "fast", "reasoning"].includes(preference)) {
    const explicit = models.find((item) => item.id === preference || item.name === preference || item.aliases?.includes(preference));
    if (!explicit) throw new Error(`MODEL_NOT_FOUND: ${preference}`);
    built = buildRoutingCandidates([explicit], input.profile, outcomes, undefined);
    if (!built.length) {
      built = [{ definition: explicit, historicalTaskIds: [], candidate: { model: explicit.id, provider: explicit.provider, capabilityMatch: 0,
        historicalSuccess: 0.5, complexityFit: 0.5, costScore: 0.5, latencyScore: 0.5, finalScore: 0, historicalEvidence: 0 }, averageLatency: undefined }];
    }
  }
  if (preference === "reasoning") built = built.filter((item) => item.definition.capabilities.reasoning === true || item.definition.capabilities.reasoning === "partial");
  if (!built.length) throw new Error("NO_ROUTING_CANDIDATES");
  let candidates = sortRoutingCandidates(built.map((item) => item.candidate));
  if (preference === "cheap") candidates = [...candidates].sort((a, b) => (a.estimatedCost ?? Infinity) - (b.estimatedCost ?? Infinity) || b.finalScore - a.finalScore || a.model.localeCompare(b.model));
  if (preference === "fast") candidates = [...candidates].sort((a, b) => b.latencyScore - a.latencyScore || b.finalScore - a.finalScore || a.model.localeCompare(b.model));
  const selected = candidates[0], evidenceCount = selected.historicalEvidence, selectedBuilt = built.find((item) => item.candidate.model === selected.model)!;
  const confidence = { level: evidenceCount >= DEFAULT_ROUTING_POLICY.highConfidenceEvidence ? "high" : evidenceCount >= DEFAULT_ROUTING_POLICY.lowConfidenceEvidence ? "medium" : "low", evidenceCount, comparableTasks: evidenceCount, historicalSuccess: evidenceCount ? selected.historicalSuccess : undefined } as const;
  const decision: RoutingDecision = { id: `routing:${input.taskId}${input.iteration === undefined ? "" : `:${input.iteration}`}`, taskId: input.taskId, selectedModel: selected.model, selectedProvider: selected.provider,
    candidates, score: selected.finalScore, estimatedCost: selected.estimatedCost, profile: input.profile, createdAt: new Date().toISOString(),
    reason: { summary: [preference !== "auto" ? `model preference: ${preference}` : "adaptive deterministic routing", "required capabilities satisfied",
      evidenceCount ? `${evidenceCount} comparable model outcomes` : "cold start: neutral history", "cost and latency included"], confidence, evidenceTaskIds: selectedBuilt.historicalTaskIds } };
  await memory.persistRoutingDecision(decision); return decision;
};
