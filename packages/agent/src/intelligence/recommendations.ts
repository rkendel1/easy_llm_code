import type { FailurePattern } from "../memory/failure-patterns.js";
import type { SuccessfulPattern } from "../memory/successful-patterns.js";
export interface MemoryRecommendations { successes: SuccessfulPattern[]; failures: FailurePattern[]; prompt: string }
export const buildMemoryRecommendations = (successes: SuccessfulPattern[], failures: FailurePattern[], limit = 5): MemoryRecommendations => {
  const chosenSuccesses = successes.slice(0, limit), chosenFailures = failures.slice(0, limit);
  const prompt = ["Relevant prior successful approaches:", ...chosenSuccesses.map((item) => `- [Task ${item.taskId}] ${item.approach}; verified: ${item.verification.join(", ")}`),
    "Relevant prior failures to avoid:", ...chosenFailures.map((item) => `- [Task ${item.taskId}] ${item.attemptedApproach}; failed: ${item.description}${item.repair ? `; repair: ${item.repair}` : ""}`)].join("\n");
  return { successes: chosenSuccesses, failures: chosenFailures, prompt };
};
