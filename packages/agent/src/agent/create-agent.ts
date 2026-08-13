import { llm as defaultLlm } from "@easy-llm/llm";
import type { ProjectMemory } from "../memory/project-memory.js";
import type { AgentAnalysis } from "../memory/types.js";
import { createContextEngine } from "../context/build-context.js";
import type { ContextBudget, ExpansionPolicy, RankingWeights } from "../context/types.js";
import { createTaskPlanner, type PlannerLlm } from "../planning/planner.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolPolicy } from "../tools/types.js";
import { parseAgentAnalysis, runTask } from "./run-task.js";
import type { AgentRunRequest, AgentRunResult, LlmExecutor } from "./types.js";

interface CreateCodeAgentOptions {
  root: string;
  memory: ProjectMemory;
  llm?: LlmExecutor;
  context?: { budget?: Partial<ContextBudget>; ranking?: Partial<RankingWeights>; expansion?: Partial<ExpansionPolicy> };
  plannerLlm?: PlannerLlm;
  tools?: ToolRegistry;
  toolPolicy?: ToolPolicy;
}

const toPrompt = (task: string, context: unknown): string =>
  [
    "You are a read-only code understanding agent.",
    "Analyze the request using the repository context and return strict JSON only.",
    "JSON schema:",
    JSON.stringify(
      {
        summary: "string",
        relevantFiles: [{ path: "string", reason: "string" }],
        dependencies: [{ from: "string", to: "string", reason: "string" }],
        recommendedNextSteps: ["string"]
      },
      null,
      2
    ),
    `Task: ${task}`,
    `Context: ${JSON.stringify(context, null, 2)}`
  ].join("\n\n");

const executeWithDefaultLlm: LlmExecutor = async ({ task, context }): Promise<AgentAnalysis> => {
  const prompt = toPrompt(task, context);
  const response = await (defaultLlm as (input: unknown) => Promise<unknown>)({
    model: "auto",
    messages: [{ role: "user", content: prompt }]
  });

  const result = response as {
    text?: string;
    output_text?: string;
    content?: string;
    message?: { content?: string };
  };

  const text =
    result.text ??
    result.output_text ??
    result.content ??
    result.message?.content;

  if (!text) {
    throw new Error("LLM returned no text output");
  }

  return parseAgentAnalysis(text);
};

export const createCodeAgent = (options: CreateCodeAgentOptions) => {
  const llm = options.llm ?? executeWithDefaultLlm;
  const contextEngine = createContextEngine({ memory: options.memory, ...options.context });
  const planner = createTaskPlanner({ root: options.root, memory: options.memory, contextEngine, llm: options.plannerLlm, registry: options.tools, policy: options.toolPolicy });

  return {
    plan: (request: AgentRunRequest) => planner.plan(request.request),
    run: async (request: AgentRunRequest): Promise<AgentRunResult> =>
      runTask(
        {
          memory: options.memory,
          llm,
          contextEngine
        },
        request
      )
  };
};
