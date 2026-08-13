import type { ProjectMemory } from "../memory/project-memory.js";
import type { AgentPlan, Evidence } from "../planning/types.js";
import { authorizeTool, READ_ONLY_POLICY } from "../tools/permissions.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolInvocation, ToolPolicy } from "../tools/types.js";
import type { ToolEvent } from "./events.js";

interface ExecutorOptions { root: string; registry: ToolRegistry; memory?: ProjectMemory; policy?: ToolPolicy }
const evidenceFrom = (taskId: string, stepId: string, tool: string, output: unknown, index: number): Evidence => {
  const value = output as Record<string, unknown>;
  const reference = String(value.path ?? (Array.isArray(value.matches) && (value.matches[0] as Record<string, unknown>)?.path) ?? tool);
  return { id: `evidence:${taskId}:${stepId}:${index}`, taskId, source: tool === "read_file" ? "file" : tool === "search" ? "search" : tool.startsWith("git_") ? "git" : "file",
    reference, excerpt: JSON.stringify(output).slice(0, 2_000), confidence: 1 };
};

export const createPlanExecutor = (options: ExecutorOptions) => {
  const policy = options.policy ?? READ_ONLY_POLICY;
  const persist = async (taskId: string, planId: string, stepId: string | undefined, event: ToolEvent, index: number): Promise<void> => {
    if (!options.memory) return;
    const timestamp = new Date().toISOString();
    await options.memory.recordToolRun({ id: `tool-run:${taskId}:${index}`, taskId, planId, stepId, event, timestamp });
    await options.memory.recordObservation({ type: "tool_result", taskId, content: event, timestamp });
  };
  const executeInvocation = async (invocation: ToolInvocation, taskId = "adhoc", planId = "adhoc", stepId?: string, index = 0): Promise<ToolEvent[]> => {
    const tool = options.registry.get(invocation.tool);
    if (!tool) { const event: ToolEvent = { type: "tool.denied", tool: invocation.tool, reason: "Tool is unavailable" }; await persist(taskId, planId, stepId, event, index); return [event]; }
    const authorization = authorizeTool(tool, policy);
    if (!authorization.allowed) { const event: ToolEvent = { type: "tool.denied", tool: tool.name, reason: authorization.reason! }; await persist(taskId, planId, stepId, event, index); return [event]; }
    const started: ToolEvent = { type: "tool.started", tool: tool.name, input: invocation.input }; await persist(taskId, planId, stepId, started, index * 2);
    try {
      const output = await tool.execute(invocation.input, { root: options.root, maxOutputCharacters: 60_000 });
      const completed: ToolEvent = { type: "tool.completed", tool: tool.name, output }; await persist(taskId, planId, stepId, completed, index * 2 + 1); return [started, completed];
    } catch (error) {
      const failed: ToolEvent = { type: "tool.failed", tool: tool.name, error: (error as Error).message }; await persist(taskId, planId, stepId, failed, index * 2 + 1); return [started, failed];
    }
  };
  return {
    executeInvocation,
    async executePlan(plan: AgentPlan): Promise<{ events: ToolEvent[]; evidence: Evidence[] }> {
      const events: ToolEvent[] = [], evidence: Evidence[] = []; let callIndex = 0;
      for (const step of [...plan.steps].sort((a, b) => a.order - b.order)) {
        let invocation: ToolInvocation | undefined;
        if (step.action === "inspect" && step.target) invocation = { tool: step.target.endsWith("/") ? "list_files" : "read_file", input: { path: step.target } };
        else if (step.action === "search") invocation = { tool: "search", input: { query: step.description, path: step.target } };
        else if (step.action === "verify") invocation = { tool: "git_diff", input: step.target ? { path: step.target } : {} };
        else if (step.action === "modify") invocation = { tool: "write_file", input: { path: step.target } };
        else if (step.action === "test") invocation = { tool: "run_tests", input: { target: step.target } };
        if (!invocation) continue;
        const stepEvents = await executeInvocation(invocation, plan.taskId, plan.id, step.id, callIndex++); events.push(...stepEvents);
        const completed = stepEvents.find((event): event is Extract<ToolEvent, { type: "tool.completed" }> => event.type === "tool.completed");
        if (completed) { const item = evidenceFrom(plan.taskId, step.id, invocation.tool, completed.output, evidence.length); evidence.push(item); await options.memory?.recordEvidence(item, plan.id, step.id); }
      }
      return { events, evidence };
    }
  };
};
