import { randomUUID } from "node:crypto";
import { invokeModel } from "../model/llm-cx.js";
import type { createContextEngine } from "../context/build-context.js";
import type { ContextItem, IntelligentContextBundle } from "../context/types.js";
import { createPlanExecutor } from "../execution/executor.js";
import { discoverFiles } from "../discovery/discover-files.js";
import type { ProjectMemory } from "../memory/project-memory.js";
import { createBuiltinToolRegistry, type ToolRegistry } from "../tools/registry.js";
import type { ToolPolicy } from "../tools/types.js";
import { buildPlannerPrompt } from "./prompts.js";
import type { AgentPlan, Evidence, ModelExecution, PlanningResult } from "./types.js";
import { validatePlan } from "./validate-plan.js";

export type PlannerLlm = (input: { request: string; prompt: string; context: IntelligentContextBundle; model?: string }) => Promise<unknown>;
interface PlannerOptions { root: string; memory: ProjectMemory; contextEngine: ReturnType<typeof createContextEngine>; llm?: PlannerLlm; registry?: ToolRegistry; policy?: ToolPolicy }
export interface PlannerRunOptions { taskId?: string; context?: IntelligentContextBundle; createdAt?: string; executeReadSteps?: boolean; model?: string; historicalMemory?: string; impactAssessment?: import("../change-intelligence/types.js").ImpactAssessment }

const textOutput = (response: unknown): string | undefined => { const value = response as { text?: string; output_text?: string; content?: string; message?: { content?: string } }; return value.text ?? value.output_text ?? value.content ?? value.message?.content; };
const parsePlan = (value: unknown): AgentPlan => {
  if (typeof value === "object" && value !== null && "steps" in value) return value as AgentPlan;
  const text = typeof value === "string" ? value : textOutput(value); if (!text) throw new Error("Planner returned no structured output");
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as AgentPlan;
};
const contextEvidence = (taskId: string, item: ContextItem): Evidence => ({
  id: item.id, taskId, source: item.type === "observation" ? "observation" : item.type === "commit" || item.type === "change" ? "git" : item.type === "test" ? "test" : "file",
  reference: item.reference, excerpt: item.content.slice(0, 2_000), confidence: item.score
});
const defaultPlannerLlm: PlannerLlm = async ({ prompt, model }) => invokeModel(prompt, { model });

export const createTaskPlanner = (options: PlannerOptions) => ({
  async plan(request: string, runOptions: PlannerRunOptions = {}): Promise<PlanningResult> {
    const taskId = runOptions.taskId ?? randomUUID(), createdAt = runOptions.createdAt ?? new Date().toISOString();
    await options.memory.upsertTask({ id: taskId, request, status: "planning", createdAt });
    const context = runOptions.context ?? await options.contextEngine.build({ request });
    const contextObservationId = `context-selection:${taskId}`;
    await options.memory.recordObservation({ id: contextObservationId, type: "decision", taskId, content: { request, selected: context.items.map((item) => ({ id: item.id, score: item.score, reason: item.reason })), excludedCount: context.totalCandidates - context.selectedItems, estimatedTokens: context.estimatedTokens }, timestamp: new Date().toISOString(), relatedFiles: context.files.map((file) => file.id) });
    await options.memory.addRelationship({ id: `edge:task-context:${taskId}`, from: `task:${taskId}`, to: `observation:${contextObservationId}`, relation: "HAS_CONTEXT", confidence: 1, source: "agent" });
    await options.memory.addRelationship({ id: `edge:task-used-context:${taskId}`, from: `task:${taskId}`, to: `observation:${contextObservationId}`, relation: "USED_CONTEXT", confidence: 1, source: "agent" });
    await options.memory.addRelationship({ id: `edge:task-selected-context:${taskId}`, from: `task:${taskId}`, to: `observation:${contextObservationId}`, relation: "SELECTED_CONTEXT", confidence: 1, source: "agent" });
    const evidence = context.items.map((item) => contextEvidence(taskId, item));
    for (const item of evidence) await options.memory.recordEvidence(item, `pending:${taskId}`);
    const started = Date.now(); const llm = options.llm ?? defaultPlannerLlm;
    try {
      const raw = await llm({ request, prompt: buildPlannerPrompt(request, context, runOptions.historicalMemory, runOptions.impactAssessment), context, model: runOptions.model });
      const parsed = parsePlan(raw);
      const expectedFiles = parsed.expectedFiles ?? [];
      const unaccountedImpacts = runOptions.impactAssessment?.decisions.filter((decision) => !expectedFiles.includes(decision.path) && !parsed.impactAssessment?.decisions.some((item) => item.path === decision.path && item.decision === "not_modified" && item.reason.trim().length > 0)) ?? [];
      if (unaccountedImpacts.length) throw new Error(`INVALID_PLAN: IMPACT_UNACCOUNTED: ${unaccountedImpacts.map((item) => item.path).join(", ")}`);
      const impactAssessment = runOptions.impactAssessment ? { ...runOptions.impactAssessment, decisions: runOptions.impactAssessment.decisions.map((decision) => expectedFiles.includes(decision.path)
        ? { path: decision.path, decision: "included" as const, reason: "Included by planner in expectedFiles" }
        : (parsed.impactAssessment?.decisions.find((item) => item.path === decision.path) ?? decision)) } : parsed.impactAssessment;
      const plan: AgentPlan = { ...parsed, id: parsed.id || `plan:${taskId}`, taskId, assumptions: parsed.assumptions ?? [], steps: parsed.steps ?? [], risks: parsed.risks ?? [], expectedFiles, verification: parsed.verification ?? [], impactAssessment };
      const metadata = raw as { model?: string; provider?: string; usage?: { inputTokens?: number; outputTokens?: number; cost?: number } };
      const modelExecution: ModelExecution = { id: `model:${taskId}`, taskId, phase: "planning", model: metadata.model ?? runOptions.model, provider: metadata.provider,
        latencyMs: Date.now() - started, inputTokens: metadata.usage?.inputTokens ?? context.estimatedTokens, outputTokens: metadata.usage?.outputTokens, estimatedCost: metadata.usage?.cost };
      await options.memory.recordModelExecution(modelExecution);
      const projectFiles = await discoverFiles(options.root);
      const validation = validatePlan(plan, { root: options.root, files: projectFiles.map((file) => file.path), evidenceIds: evidence.map((item) => item.id) });
      if (!validation.valid) throw new Error(`INVALID_PLAN: ${validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
      await options.memory.persistPlan(plan);
      await options.memory.upsertTask({ id: taskId, request, status: "planned", createdAt });
      await options.memory.upsertTask({ id: taskId, request, status: "executing", createdAt });
      const executor = createPlanExecutor({ root: options.root, registry: options.registry ?? createBuiltinToolRegistry(), memory: options.memory, policy: options.policy });
      const execution = runOptions.executeReadSteps === false ? { events: [], evidence: [] } : await executor.executePlan(plan);
      if (!runOptions.taskId) await options.memory.upsertTask({ id: taskId, request, status: "completed", createdAt, completedAt: new Date().toISOString() });
      return { taskId, context, plan, evidence: [...evidence, ...execution.evidence], events: execution.events, modelExecution };
    } catch (error) {
      await options.memory.upsertTask({ id: taskId, request, status: "failed", createdAt, completedAt: new Date().toISOString() });
      await options.memory.recordObservation({ type: "warning", taskId, content: { planningError: (error as Error).message }, timestamp: new Date().toISOString() });
      throw error;
    }
  }
});
