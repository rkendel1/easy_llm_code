import type { ProjectMemory } from "../memory/project-memory.js";
import type { RoutingCandidate, RoutingDecision, RoutingFallback } from "./decision.js";

const classifyFallback = (error: unknown): RoutingFallback["reason"] => {
  const message = (error as Error)?.message?.toLowerCase() ?? "";
  if (/429|rate.?limit/.test(message)) return "rate_limit";
  if (/timeout|timed out|abort/.test(message)) return "timeout";
  if (/unavailable|not available|503/.test(message)) return "unavailable";
  return "provider_error";
};
const fallbackEligible = (error: unknown): boolean => /429|rate.?limit|timeout|timed out|abort|unavailable|not available|503|provider|network|fetch|model|llm/i.test((error as Error)?.message ?? "");

export const executeWithModelFallback = async <T>(memory: ProjectMemory, decision: RoutingDecision, execute: (candidate: RoutingCandidate) => Promise<T>): Promise<{ value: T; candidate: RoutingCandidate; fallbacks: RoutingFallback[] }> => {
  const fallbacks: RoutingFallback[] = [];
  for (const [index, candidate] of decision.candidates.entries()) {
    try { return { value: await execute(candidate), candidate, fallbacks }; }
    catch (error) {
      if (!fallbackEligible(error)) throw error;
      const next = decision.candidates[index + 1];
      if (!next) throw error;
      const fallback: RoutingFallback = { id: `routing-fallback:${decision.taskId}:${index}`, taskId: decision.taskId, originalModel: candidate.model, fallbackModel: next.model, reason: classifyFallback(error), timestamp: new Date().toISOString() };
      await memory.persistRoutingFallback(fallback); fallbacks.push(fallback);
    }
  }
  throw new Error("NO_ROUTING_CANDIDATES");
};
