import type { ModelExecution } from "../planning/types.js";
import type { TaskOutcome } from "../mutation/types.js";
import type { ContextMetrics } from "../context/types.js";

export const renderPerformanceSummary = (input: { model?: ModelExecution; outcome?: TaskOutcome; context?: ContextMetrics }): string => [
  "Agent Performance",
  `Model: ${input.model?.provider ?? "unknown"}/${input.model?.model ?? "unknown"}`,
  `Context: ${input.context?.estimatedTokens?.toLocaleString() ?? "unknown"} tokens`,
  `Cost: ${input.model?.estimatedCost === undefined ? "unknown" : `$${input.model.estimatedCost.toFixed(4)}`}`,
  `Latency: ${input.outcome?.durationMs ?? input.model?.latencyMs ?? 0}ms`,
  `Result: ${input.outcome?.status.toUpperCase() ?? "UNKNOWN"}`,
  `Repairs: ${Math.max(0, (input.outcome?.attempts ?? 1) - 1)}`,
  `Verification: ${input.outcome?.verificationPassed ? "PASS" : "NOT PASSED"}`
].join("\n");
