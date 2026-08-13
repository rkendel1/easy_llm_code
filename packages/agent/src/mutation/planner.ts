import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { llm as routedLlm } from "@easy-llm/llm";
import type { IntelligentContextBundle } from "../context/types.js";
import type { ProjectMemory } from "../memory/project-memory.js";
import type { AgentPlan } from "../planning/types.js";
import { resolveRepositoryPath } from "../tools/path-security.js";
import type { VerificationRun } from "../verification/types.js";
import { applyUnifiedPatch } from "./patch.js";
import { hashContent } from "./validate.js";
import type { MutationProposal } from "./types.js";

export type MutationLlm = (input: { plan: AgentPlan; context: IntelligentContextBundle; failure?: VerificationRun; prompt: string }) => Promise<unknown>;
interface MutationPlannerOptions { root: string; memory: ProjectMemory; llm?: MutationLlm }
const responseText = (value: unknown): string | undefined => { const item = value as { text?: string; output_text?: string; content?: string; message?: { content?: string } }; return item.text ?? item.output_text ?? item.content ?? item.message?.content; };
const parse = (value: unknown): MutationProposal => { if (value && typeof value === "object" && "files" in value) return value as MutationProposal; const text = typeof value === "string" ? value : responseText(value); if (!text) throw new Error("Mutation model returned no proposal"); return JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); };
const defaultLlm: MutationLlm = async ({ prompt }) => routedLlm({ task: "mutation", capability: "reasoning", messages: [{ role: "user", content: prompt }] } as never);
const promptFor = (plan: AgentPlan, context: IntelligentContextBundle, failure?: VerificationRun): string => [
  "Return one strict JSON MutationProposal. Propose unified diffs only; never request filesystem or shell access.",
  "Schema: {id,taskId,planId,files:[{path,operation,oldPath?,beforeHash?,afterHash?,patch}],rationale,expectedChanges,verification:[{id,command,purpose,required,timeoutMs}]}",
  `Plan: ${JSON.stringify(plan)}`, `Context: ${JSON.stringify(context.items)}`,
  failure ? `Previous verification failure to repair: ${JSON.stringify(failure)}` : ""
].filter(Boolean).join("\n\n");

export const createMutationPlanner = (options: MutationPlannerOptions) => ({
  async propose(plan: AgentPlan, context: IntelligentContextBundle, failure?: VerificationRun): Promise<MutationProposal> {
    const started = Date.now();
    const raw = await (options.llm ?? defaultLlm)({ plan, context, failure, prompt: promptFor(plan, context, failure) });
    const parsed = parse(raw); const proposal: MutationProposal = { ...parsed, id: parsed.id || `proposal:${randomUUID()}`, taskId: plan.taskId, planId: plan.id,
      files: parsed.files ?? [], expectedChanges: parsed.expectedChanges ?? [], verification: parsed.verification ?? [], rationale: parsed.rationale ?? "" };
    for (const file of proposal.files) {
      const before = file.operation === "create" ? "" : await readFile(await resolveRepositoryPath(options.root, file.oldPath ?? file.path), "utf8");
      const after = applyUnifiedPatch(before, file.patch).content;
      if (file.operation !== "create") file.beforeHash = hashContent(before);
      if (file.operation !== "delete") file.afterHash = hashContent(after);
    }
    await options.memory.persistMutationProposal(proposal);
    await options.memory.recordModelExecution({ id: `model:${proposal.id}`, taskId: plan.taskId, phase: failure ? "repair" : "mutation", latencyMs: Date.now() - started, inputTokens: context.estimatedTokens });
    return proposal;
  }
});
