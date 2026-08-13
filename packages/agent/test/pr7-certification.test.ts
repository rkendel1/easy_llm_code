import { describe, expect, it } from "vitest";
import type { ModelDefinition } from "@easy-llm/llm";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";
import { createTaskProfile, type TaskProfile } from "../src/intelligence/task-profile.js";
import { outcomeQuality } from "../src/intelligence/outcome-model.js";
import { selectModel } from "../src/routing/model-selector.js";
import { executeWithModelFallback } from "../src/routing/fallback.js";
import { buildMemoryRecommendations } from "../src/intelligence/recommendations.js";
import { explainTask } from "../src/intelligence/explain.js";
import type { IntelligentContextBundle } from "../src/context/types.js";

const model = (id: string, options: { reasoning?: boolean; tools?: boolean; vision?: boolean; price?: number; status?: "available" | "unavailable" } = {}): ModelDefinition => ({
  id, provider: id.split(":")[0], name: id, capabilities: { reasoning: options.reasoning ?? true, tools: options.tools ?? true, vision: options.vision ?? false, audio: false, structuredOutput: true, embeddings: false },
  context: { input: 128_000 }, pricing: { currency: "USD", inputPerMillion: options.price ?? 1, outputPerMillion: options.price ?? 1 },
  availability: { online: options.status !== "unavailable", status: options.status ?? "available" }, lifecycle: { status: "stable", lastVerifiedAt: "2026-08-13T00:00:00.000Z" }, metadata: {}
});
const profile: TaskProfile = { taskType: "bugfix", languages: ["TypeScript"], frameworks: [], subsystem: "auth", estimatedComplexity: "high", requiresReasoning: true, requiresVision: false, requiresTools: true, expectedFiles: 7, expectedChanges: 4, contextSize: 10_000 };
const memory = async (name: string) => { const value = createFeltDBProjectMemory({ root: `/tmp/${name}`, namespace: name, ephemeral: true }); await value.initialize({ id: name, root: `/tmp/${name}`, name, detectedLanguages: ["TypeScript"], packageManagers: [] }); return value; };

describe("PR7 outcome-aware deterministic intelligence", () => {
  it("profiles task type, complexity, and hard requirements deterministically", async () => {
    const context = { items: [], totalCandidates: 7, selectedItems: 7, estimatedTokens: 4000, budget: { maxItems: 10, maxCharacters: 10000 }, strategy: "ranked", metrics: { candidateCount: 7, selectedCount: 7, characters: 1000, estimatedTokens: 4000, rawEstimatedTokens: 5000, compressionRatio: .2 }, files: Array.from({ length: 7 }, (_, index) => ({ id: `file:${index}`, path: `src/auth/${index}.ts`, size: 1, language: "TypeScript", score: 1, reason: "match" })), symbols: [], relationships: [] } satisfies IntelligentContextBundle;
    const project = { id: "repo", root: process.cwd(), name: "repo", detectedLanguages: ["TypeScript"], packageManagers: ["npm"] };
    const first = await createTaskProfile("Fix race condition in authentication", project, context);
    expect(first).toMatchObject({ taskType: "bugfix", estimatedComplexity: "high", requiresReasoning: true, requiresTools: true, expectedFiles: 7, subsystem: "auth" });
    expect(await createTaskProfile("Fix race condition in authentication", project, context)).toEqual(first);
  });

  it("hard-filters capabilities and availability, honors budget, and lets explicit model override", async () => {
    const store = await memory("filters");
    const models = [model("p:alpha"), model("p:no-tools", { tools: false }), model("p:offline", { status: "unavailable" }), model("p:expensive", { price: 100 })];
    const budgeted = await selectModel(store, { taskId: "budget", profile, budget: .10, models });
    expect(budgeted.candidates.map((item) => item.model)).toEqual(["p:alpha"]);
    const overridden = await selectModel(store, { taskId: "override", profile, model: "p:no-tools", budget: 0, models });
    expect(overridden.selectedModel).toBe("p:no-tools");
  });

  it("uses cold-start neutrality, repository/subsystem/task history, and deterministic tie breaks", async () => {
    const store = await memory("history"); const models = [model("p:alpha"), model("p:beta")];
    const cold = await selectModel(store, { taskId: "cold", profile, models });
    expect(cold.selectedModel).toBe("p:alpha"); expect(cold.reason.confidence.level).toBe("low");
    for (let index = 0; index < 12; index++) await store.persistOutcomeSignal({ taskId: `prior-${index}`, repositoryId: "history", taskType: "bugfix", languages: ["TypeScript"], frameworks: [], subsystem: "auth", complexity: "high", model: "p:beta", provider: "p", success: true, repaired: index === 0, attempts: index === 0 ? 2 : 1, verificationPassed: true, timestamp: new Date(2026, 7, index + 1).toISOString() });
    const selected = await selectModel(store, { taskId: "learned", profile, models });
    expect(selected.selectedModel).toBe("p:beta"); expect(selected.reason.confidence.level).toBe("high"); expect(selected.reason.evidenceTaskIds).toContain("prior-1");
    const signatures = await Promise.all(Array.from({ length: 100 }, async (_, index) => { const decision = await selectModel(store, { taskId: `repeat-${index}`, profile, models }); return `${decision.selectedModel}:${decision.score}:${decision.candidates.map((item) => item.model).join(",")}`; }));
    expect(new Set(signatures).size).toBe(1);
  });

  it("weights clean success above repaired success and final failure", () => {
    const base = { taskId: "x", repositoryId: "r", taskType: "bugfix", languages: ["TypeScript"], frameworks: [], complexity: "high" as const, model: "m", provider: "p", repaired: false, attempts: 1, verificationPassed: true, timestamp: "2026-08-13" };
    const clean = outcomeQuality({ ...base, success: true });
    const repaired = outcomeQuality({ ...base, success: true, repaired: true, attempts: 3 });
    const failed = outcomeQuality({ ...base, success: false, verificationPassed: false });
    expect(clean).toBeGreaterThan(repaired); expect(repaired).toBeGreaterThan(failed);
  });

  it("falls back on unavailable providers and timeouts and persists both transitions", async () => {
    const store = await memory("fallback"); const decision = await selectModel(store, { taskId: "fallback-task", profile, models: [model("p:a"), model("p:b"), model("p:c")] });
    const result = await executeWithModelFallback(store, decision, async (candidate) => { if (candidate.model === "p:a") throw new Error("503 provider unavailable"); if (candidate.model === "p:b") throw new Error("request timeout"); return "ok"; });
    expect(result.value).toBe("ok"); expect(result.candidate.model).toBe("p:c");
    expect((await store.getRoutingFallbacks("fallback-task")).map((item) => item.reason)).toEqual(["unavailable", "timeout"]);
  });

  it("retrieves provenance-rich success/failure memory and explains persisted evidence", async () => {
    const store = await memory("explain");
    await store.persistSuccessfulPattern({ id: "success:1", repositoryId: "explain", taskId: "old-success", taskType: "bugfix", subsystem: "auth", summary: "token fix", files: ["src/auth.ts"], approach: "lock token refresh", verification: ["npm test"], model: "p:a", outcome: { status: "success", attempts: 1, filesChanged: 1, linesChanged: 2, testsPassed: 1, testsFailed: 0, verificationPassed: true, durationMs: 10 }, timestamp: "2026-08-12" });
    await store.persistFailurePattern({ id: "failure:1", repositoryId: "explain", taskId: "old-failure", taskType: "bugfix", subsystem: "auth", failureClass: "verification", description: "race remained", attemptedApproach: "retry without lock", failedFiles: ["src/auth.ts"], timestamp: "2026-08-11" });
    const recommendations = buildMemoryRecommendations(await store.listSuccessfulPatterns(), await store.listFailurePatterns());
    expect(recommendations.prompt).toContain("[Task old-success]"); expect(recommendations.prompt).toContain("[Task old-failure]");
    await selectModel(store, { taskId: "why-task", profile, models: [model("p:a")] });
    const explanation = await explainTask(store, "why-task");
    expect(explanation).toContain("Components:"); expect(explanation).toContain("Evidence tasks:");
  });
});
