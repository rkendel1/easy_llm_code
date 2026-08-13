import type { AgentAnalysis } from "../memory/types.js";
import type { IntelligentContextBundle } from "../context/types.js";

export interface AgentRunRequest {
  request: string;
}

export interface AgentRunResult {
  taskId: string;
  request: string;
  context: IntelligentContextBundle;
  analysis: AgentAnalysis;
}

export type LlmExecutor = (input: {
  task: string;
  context: IntelligentContextBundle;
  policy: "auto";
}) => Promise<AgentAnalysis>;
