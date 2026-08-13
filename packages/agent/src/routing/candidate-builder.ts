import { createRequire } from "node:module";
import { llm, type ModelDefinition } from "@easy-llm/llm";
import type { OutcomeSignal } from "../intelligence/outcome-model.js";
import { outcomeQuality } from "../intelligence/outcome-model.js";
import type { TaskProfile } from "../intelligence/task-profile.js";
import type { ComparableOutcome } from "../memory/outcome-retrieval.js";
import type { RoutingCandidate } from "./decision.js";

const require = createRequire(typeof __filename === "string" ? __filename : import.meta.url);
const supported = (value: boolean | "partial" | undefined): boolean => value === true || value === "partial";
export const loadRegistryModels = async (): Promise<ModelDefinition[]> => {
  await llm.loadModelRegistryCache().catch(() => undefined);
  const live = llm.queryModels().all();
  if (live.length) return live;
  const snapshot = require("@easy-llm/llm/registry-snapshot") as { models: ModelDefinition[] };
  return snapshot.models;
};
const estimateCost = (model: ModelDefinition, profile: TaskProfile): number | undefined => {
  if (model.pricing?.inputPerMillion === undefined || model.pricing.outputPerMillion === undefined) return undefined;
  const outputTokens = 500 + profile.expectedChanges * 500;
  return (profile.contextSize * model.pricing.inputPerMillion + outputTokens * model.pricing.outputPerMillion) / 1_000_000;
};
const historical = (outcomes: ComparableOutcome[], model: ModelDefinition): { score: number; count: number; latency?: number; taskIds: string[] } => {
  const matching = outcomes.filter((item) => item.model === model.id || (item.model === model.name && item.provider === model.provider));
  if (!matching.length) {
    const provider = outcomes.filter((item) => item.provider === model.provider);
    if (!provider.length) return { score: 0.5, count: 0, taskIds: [] };
    const weight = provider.reduce((sum, item) => sum + item.similarity, 0), quality = provider.reduce((sum, item) => sum + outcomeQuality(item) * item.similarity, 0) / weight;
    return { score: 0.5 + quality * 0.10, count: provider.length, taskIds: provider.map((item) => item.taskId) };
  }
  const weight = matching.reduce((sum, item) => sum + item.similarity, 0);
  const quality = matching.reduce((sum, item) => sum + outcomeQuality(item) * item.similarity, 0) / weight;
  const latencies = matching.map((item) => item.latencyMs).filter((value): value is number => value !== undefined);
  return { score: (quality + 1) / 2, count: matching.length, latency: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : undefined, taskIds: matching.map((item) => item.taskId) };
};

export interface BuiltRoutingCandidate { definition: ModelDefinition; candidate: RoutingCandidate; historicalTaskIds: string[]; averageLatency?: number }
export const buildRoutingCandidates = (models: ModelDefinition[], profile: TaskProfile, outcomes: ComparableOutcome[], budget?: number): BuiltRoutingCandidate[] => {
  const base = models.filter((model) => model.lifecycle.status !== "sunset" && model.lifecycle.status !== "deprecated" && model.availability?.status !== "unavailable" &&
    model.context.input >= profile.contextSize && (!profile.requiresReasoning || supported(model.capabilities.reasoning)) &&
    (!profile.requiresVision || supported(model.capabilities.vision)) && (!profile.requiresTools || supported(model.capabilities.tools))).map((definition) => {
      const history = historical(outcomes, definition), estimatedCost = estimateCost(definition, profile);
      const required = [profile.requiresReasoning ? definition.capabilities.reasoning : true, profile.requiresVision ? definition.capabilities.vision : true, profile.requiresTools ? definition.capabilities.tools : true];
      const capabilityMatch = required.reduce<number>((sum, flag) => sum + (flag === "partial" ? 0.75 : flag ? 1 : 0), 0) / required.length;
      const complexityFit = profile.estimatedComplexity === "high" ? (supported(definition.capabilities.reasoning) ? 1 : 0.4) : profile.estimatedComplexity === "medium" ? (supported(definition.capabilities.reasoning) ? 0.9 : 0.75) : 0.85;
      return { definition, estimatedCost, history, capabilityMatch, complexityFit };
    }).filter((item) => budget === undefined || (item.estimatedCost !== undefined && item.estimatedCost <= budget));
  const costs = base.map((item) => item.estimatedCost).filter((value): value is number => value !== undefined), latencies = base.map((item) => item.history.latency).filter((value): value is number => value !== undefined);
  const normalizeInverse = (value: number | undefined, values: number[]): number => { if (value === undefined || !values.length) return 0.5; const min = Math.min(...values), max = Math.max(...values); return max === min ? 1 : 1 - (value - min) / (max - min); };
  return base.map((item) => ({ definition: item.definition, historicalTaskIds: item.history.taskIds, averageLatency: item.history.latency,
    candidate: { model: item.definition.id, provider: item.definition.provider, capabilityMatch: item.capabilityMatch, historicalSuccess: item.history.score,
      complexityFit: item.complexityFit, costScore: normalizeInverse(item.estimatedCost, costs), latencyScore: normalizeInverse(item.history.latency, latencies),
      finalScore: 0, estimatedCost: item.estimatedCost, historicalEvidence: item.history.count } }));
};
