import { randomUUID } from "node:crypto";
import type { ProjectMemory } from "../memory/project-memory.js";
import type { AgentAnalysis } from "../memory/types.js";
import type { AgentRunRequest, AgentRunResult, LlmExecutor } from "./types.js";

interface RunTaskOptions {
  memory: ProjectMemory;
  llm: LlmExecutor;
}

export const runTask = async (
  options: RunTaskOptions,
  request: AgentRunRequest
): Promise<AgentRunResult> => {
  const taskId = randomUUID();
  const context = await options.memory.queryContext({ text: request.request });

  const analysis = await options.llm({
    task: request.request,
    context,
    policy: "auto"
  });

  await options.memory.recordObservation({
    type: "agent_analysis",
    taskId,
    content: analysis,
    timestamp: new Date().toISOString()
  });

  return {
    taskId,
    request: request.request,
    context,
    analysis
  };
};

export const parseAgentAnalysis = (text: string): AgentAnalysis => {
  try {
    const parsed = JSON.parse(text) as AgentAnalysis;
    if (!parsed.summary || !Array.isArray(parsed.relevantFiles) || !Array.isArray(parsed.dependencies) || !Array.isArray(parsed.recommendedNextSteps)) {
      throw new Error("Missing required fields");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse agent analysis response: ${(error as Error).message}`);
  }
};
