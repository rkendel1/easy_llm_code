import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";
import { createChangeIntelligence } from "../src/change-intelligence/analyze-impact.js";
import { recordImpactFeedback } from "../src/change-intelligence/feedback.js";
import { createTaskPlanner } from "../src/planning/planner.js";
import type { IntelligentContextBundle } from "../src/context/types.js";
import type { ImpactAssessment } from "../src/change-intelligence/types.js";

const setup = async (id: string) => {
  const memory = createFeltDBProjectMemory({ root: `/tmp/${id}`, namespace: `pr8:${id}`, ephemeral: true });
  await memory.initialize({ id, root: `/tmp/${id}`, name: id, detectedLanguages: ["TypeScript"], packageManagers: [] });
  for (const path of ["src/auth/session.ts", "src/auth/token.ts", "src/api/auth.ts", "test/auth/session.test.ts", "src/unrelated.ts"]) await memory.upsertFile({ id: `file:${path}`, path, language: "TypeScript", size: 10 });
  await memory.addRelationship({ id: "edge:import", from: "file:src/api/auth.ts", to: "file:src/auth/session.ts", relation: "IMPORTS", confidence: 1, source: "ast" });
  await memory.addRelationship({ id: "edge:test", from: "file:test/auth/session.test.ts", to: "file:src/auth/session.ts", relation: "TESTS", confidence: 1, source: "ast" });
  return memory;
};
const ingestPair = async (memory: Awaited<ReturnType<typeof setup>>, index: number, files = ["src/auth/session.ts", "src/auth/token.ts"]) => {
  const commitId = `commit:${index}`;
  await memory.ingestCommit({ id: commitId, sha: `${index}`.padStart(40, "0"), parentShas: [], message: `change ${index}`, timestamp: new Date(Date.UTC(2026, 7, index + 1)).toISOString() }, files.map((path, fileIndex) => ({ id: `change:${index}:${fileIndex}`, commitId, fileId: `file:${path}`, changeType: "modified" as const, additions: 1, deletions: 1 })));
};

describe("PR8 predictive change graph certification", () => {
  it("surfaces factual imports and tests while storing predictions as derived edges", async () => {
    const memory = await setup("structural"), analysis = await createChangeIntelligence({ memory }).analyzeChangeImpact({ files: ["src/auth/session.ts"], taskId: "impact-1", persist: true });
    expect(analysis.affectedFiles.map((item) => item.path)).toEqual(expect.arrayContaining(["src/api/auth.ts", "test/auth/session.test.ts"]));
    expect(analysis.affectedTests.map((item) => item.path)).toContain("test/auth/session.test.ts");
    expect(analysis.affectedFiles.every((item) => item.confidence < .5)).toBe(true);
    const relationships = await memory.listRelationships();
    expect(relationships.find((edge) => edge.relation === "IMPORTS")?.derivedEvidence).toBeUndefined();
    expect(relationships.find((edge) => edge.relation === "LIKELY_AFFECTS")).toMatchObject({ evidenceCount: 1, evidenceTypes: expect.any(Array), derivedEvidence: expect.any(Array) });
  });

  it("combines historical co-change evidence and updates after new commits", async () => {
    const memory = await setup("temporal"); for (let index = 0; index < 6; index++) await ingestPair(memory, index);
    const first = await createChangeIntelligence({ memory }).analyzeChangeImpact({ files: ["src/auth/session.ts"] });
    const token = first.affectedFiles.find((item) => item.path === "src/auth/token.ts")!;
    expect(token.evidenceTypes).toEqual(expect.arrayContaining(["historical", "cochange"])); expect(token.evidenceCount).toBe(6);
    await ingestPair(memory, 6, ["src/auth/session.ts", "src/auth/token.ts", "test/auth/session.test.ts"]);
    const updated = await createChangeIntelligence({ memory }).analyzeChangeImpact({ files: ["src/auth/session.ts"] });
    expect(updated.affectedFiles.find((item) => item.path === "src/auth/token.ts")!.evidenceCount).toBe(7);
    expect((await memory.getFileHistory("file:src/auth/session.ts")).totalCommits).toBe(7);
  });

  it("is repository scoped and conservative for cold starts and one observation", async () => {
    const rich = await setup("scope-rich"), cold = await setup("scope-cold"); for (let index = 0; index < 5; index++) await ingestPair(rich, index);
    await ingestPair(cold, 0);
    const richResult = await createChangeIntelligence({ memory: rich }).analyzeChangeImpact({ files: ["src/auth/session.ts"] });
    const coldResult = await createChangeIntelligence({ memory: cold }).analyzeChangeImpact({ files: ["src/auth/session.ts"] });
    expect(richResult.affectedFiles.find((item) => item.path === "src/auth/token.ts")!.confidence).toBeGreaterThan(coldResult.affectedFiles.find((item) => item.path === "src/auth/token.ts")!.confidence);
    expect(coldResult.affectedFiles.find((item) => item.path === "src/auth/token.ts")!.confidence).toBeLessThan(.5);
    const isolated = await setup("scope-isolated"), isolatedResult = await createChangeIntelligence({ memory: isolated }).analyzeChangeImpact({ files: ["src/auth/session.ts"] });
    expect(isolatedResult.affectedFiles.some((item) => item.path === "src/auth/token.ts")).toBe(false);
  });

  it("records confirmed, false-positive, false-negative, and uncertain feedback", async () => {
    const memory = await setup("feedback"); for (let index = 0; index < 5; index++) await ingestPair(memory, index);
    const prediction = await createChangeIntelligence({ memory }).analyzeChangeImpact({ files: ["src/auth/session.ts"], taskId: "task-feedback", persist: true });
    const outcomes = await recordImpactFeedback(memory, prediction, ["src/auth/token.ts", "src/unrelated.ts"], true);
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/auth/token.ts", classification: "confirmed" }),
      expect.objectContaining({ file: "src/unrelated.ts", classification: "false_negative" }),
      expect.objectContaining({ classification: "false_positive" })
    ]));
    const uncertainPrediction = { ...prediction, id: "impact:uncertain", taskId: "task-uncertain" }; await memory.persistImpactPrediction(uncertainPrediction);
    expect((await recordImpactFeedback(memory, uncertainPrediction, [], false, false)).every((item) => item.classification === "uncertain")).toBe(true);
  });

  it("produces identical ranked predictions across 100 runs", async () => {
    const memory = await setup("determinism"); for (let index = 0; index < 8; index++) await ingestPair(memory, index);
    const signatures = await Promise.all(Array.from({ length: 100 }, async () => { const value = await createChangeIntelligence({ memory }).analyzeChangeImpact({ files: ["src/auth/session.ts"], taskType: "bugfix" }); return JSON.stringify(value); }));
    expect(new Set(signatures).size).toBe(1);
  });

  it("injects high-confidence impact evidence and persists planner accounting", async () => {
    const root = await mkdtemp(join(tmpdir(), "pr8-plan-")); await writeFile(join(root, "target.ts"), "export const target = 1;\n"); await writeFile(join(root, "affected.ts"), "export const affected = 1;\n");
    const memory = createFeltDBProjectMemory({ root, namespace: `pr8-plan:${Date.now()}`, ephemeral: true }); await memory.initialize({ id: "planner", root, name: "planner", detectedLanguages: ["TypeScript"], packageManagers: [] });
    const reason = { lexical: 1, structural: 0, historical: 0, recency: 0, coChange: 0, memory: 0 };
    const context = { items: [{ id: "file:target.ts", type: "file", reference: "target.ts", score: 1, reason, content: "export const target = 1;" }], totalCandidates: 1, selectedItems: 1, estimatedTokens: 20, budget: { maxItems: 10, maxCharacters: 1000 }, strategy: "ranked", metrics: { candidateCount: 1, selectedCount: 1, characters: 24, estimatedTokens: 20, rawEstimatedTokens: 20, compressionRatio: 0 }, files: [{ id: "file:target.ts", path: "target.ts", size: 24, score: 1, reason: "direct" }], symbols: [], relationships: [] } satisfies IntelligentContextBundle;
    const evidence = { source: "historical" as const, target: "target.ts", candidate: "affected.ts", confidence: .9, observations: ["commit:1", "commit:2"], sampleSize: 12, generatedAt: "2026-08-13T00:00:00.000Z", description: "changed together in 12 commits" };
    const impactAssessment: ImpactAssessment = { expectedFiles: ["target.ts"], likelyAffectedFiles: ["affected.ts"], expectedTests: [], riskAreas: [], evidence: [evidence], decisions: [{ path: "affected.ts", decision: "not_modified", reason: "must account" }] };
    let prompt = ""; const planner = createTaskPlanner({ root, memory, contextEngine: { build: async () => context } as never, llm: async (input) => { prompt = input.prompt; return { id: "plan", taskId: "assigned", objective: "change target", assumptions: [], steps: [{ id: "inspect", order: 1, action: "inspect", description: "inspect", target: "target.ts", dependencies: [], evidence: ["file:target.ts"] }], risks: [{ id: "risk", description: "impact", severity: "high", evidence: ["file:target.ts"] }], expectedFiles: ["target.ts", "affected.ts"], verification: [{ id: "verify", description: "review", evidence: ["file:target.ts"] }] }; } });
    const result = await planner.plan("change target", { context, impactAssessment, executeReadSteps: false });
    expect(prompt).toContain("Predicted change impact"); expect(prompt).toContain("changed together in 12 commits");
    expect(result.plan.impactAssessment?.decisions).toContainEqual({ path: "affected.ts", decision: "included", reason: "Included by planner in expectedFiles" });
    expect((await memory.getPlan(result.plan.id))?.impactAssessment?.evidence[0].observations).toEqual(["commit:1", "commit:2"]);
  });
});
