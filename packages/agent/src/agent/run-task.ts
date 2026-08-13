import { randomUUID } from "node:crypto";
import type { ProjectMemory } from "../memory/project-memory.js";
import type { AgentAnalysis } from "../memory/types.js";
import type { createContextEngine } from "../context/build-context.js";
import type { AgentRunRequest, AgentRunResult, LlmExecutor } from "./types.js";

interface RunTaskOptions {
  memory: ProjectMemory;
  llm: LlmExecutor;
  contextEngine: ReturnType<typeof createContextEngine>;
}

export const runTask = async (
  options: RunTaskOptions,
  request: AgentRunRequest
): Promise<AgentRunResult> => {
  const taskId = randomUUID();
  const createdAt = new Date().toISOString();
  await options.memory.upsertTask({ id: taskId, request: request.request, status: "analyzing", createdAt });
  const context = await options.contextEngine.build({ request: request.request });
  await options.memory.recordObservation({
    type: "decision",
    taskId,
    content: {
      taskId,
      request: request.request,
      selected: context.items.map((item) => ({ id: item.id, score: item.score, reason: item.reason })),
      excludedCount: context.totalCandidates - context.selectedItems,
      estimatedTokens: context.estimatedTokens,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString(),
    relatedFiles: context.files.map((file) => file.id)
  });

  const analysis = await options.llm({
    task: request.request,
    context,
    policy: "auto"
  });

  await options.memory.recordObservation({
    type: "agent_analysis",
    taskId,
    content: analysis,
    timestamp: new Date().toISOString(),
    relatedFiles: analysis.relevantFiles.map((file) => `file:${file.path}`)
  });
  await options.memory.upsertTask({ id: taskId, request: request.request, status: "completed", createdAt, completedAt: new Date().toISOString() });

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
