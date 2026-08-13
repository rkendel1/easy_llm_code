import type { AgentAnalysis, ContextBundle } from "../memory/types.js";

export interface AgentRunRequest {
  request: string;
}

export interface AgentRunResult {
  taskId: string;
  request: string;
  context: ContextBundle;
  analysis: AgentAnalysis;
}

export type LlmExecutor = (input: {
  task: string;
  context: ContextBundle;
  policy: "auto";
}) => Promise<AgentAnalysis>;
