import { DEFAULT_ROUTING_POLICY, type AdaptiveRoutingPolicy } from "./routing-policy.js";
import type { RoutingCandidate } from "../routing/decision.js";

export const scoreRoutingCandidate = (candidate: RoutingCandidate, policy: AdaptiveRoutingPolicy = DEFAULT_ROUTING_POLICY): RoutingCandidate => ({ ...candidate,
  finalScore: candidate.capabilityMatch * policy.weights.capability + candidate.historicalSuccess * policy.weights.historicalSuccess +
    candidate.complexityFit * policy.weights.complexityFit + candidate.costScore * policy.weights.cost + candidate.latencyScore * policy.weights.latency });
export const sortRoutingCandidates = (candidates: RoutingCandidate[]): RoutingCandidate[] => [...candidates].map((candidate) => scoreRoutingCandidate(candidate)).sort((a, b) =>
  b.finalScore - a.finalScore || b.historicalSuccess - a.historicalSuccess || (a.estimatedCost ?? Infinity) - (b.estimatedCost ?? Infinity) ||
  b.latencyScore - a.latencyScore || a.model.localeCompare(b.model));
