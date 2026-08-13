import type { createContextEngine } from "../context/build-context.js";
import type { IntelligentContextBundle } from "../context/types.js";

export interface ContextRefreshInput { request: string; reason: string; newlyDiscoveredFiles?: string[]; newlyDiscoveredSymbols?: string[]; failedAssumptions?: string[]; executionEvidence?: string[] }
export const refreshContext = (engine: ReturnType<typeof createContextEngine>, input: ContextRefreshInput): Promise<IntelligentContextBundle> => engine.build({ request: [input.request, `Refresh reason: ${input.reason}`,
  input.newlyDiscoveredFiles?.length ? `New files: ${input.newlyDiscoveredFiles.join(", ")}` : "", input.newlyDiscoveredSymbols?.length ? `New symbols: ${input.newlyDiscoveredSymbols.join(", ")}` : "",
  input.failedAssumptions?.length ? `Failed assumptions: ${input.failedAssumptions.join("; ")}` : "", input.executionEvidence?.length ? `Execution evidence: ${input.executionEvidence.join("\n")}` : ""].filter(Boolean).join("\n") });
