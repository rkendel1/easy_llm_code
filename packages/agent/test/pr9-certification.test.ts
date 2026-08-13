import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ModelDefinition } from "@easy-llm/llm";
import { createAutonomousController } from "../src/autonomy/controller.js";
import { checkPlanAssumptions } from "../src/autonomy/assumptions.js";
import { emptyBudgetUsage } from "../src/autonomy/budget.js";
import { evaluateExecution } from "../src/autonomy/evaluate.js";
import { requiresApproval } from "../src/autonomy/policy.js";
import { assessAutonomousRisk } from "../src/autonomy/risk.js";
import { reviewExecution } from "../src/autonomy/review.js";
import { runLayeredVerification } from "../src/autonomy/verification.js";
import type { RiskInput } from "../src/autonomy/types.js";
import { discoverProject } from "../src/discovery/discover-project.js";
import { indexProjectIntoMemory } from "../src/indexing/index-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";
import { createUnifiedPatch } from "../src/mutation/patch.js";
import { selectModel } from "../src/routing/model-selector.js";
import { createTaskRunner } from "../src/task/runner.js";

const exec = promisify(execFile), ORIGINAL = "export const value = 'old';\n", BAD = "export const value = 'bad';\n", GOOD = "export const value = 'good';\n";
const fixture = async (name: string) => {
  const root = await mkdtemp(join(tmpdir(), `pr9-${name}-`)); await mkdir(join(root, "src")); await writeFile(join(root, "src/value.ts"), ORIGINAL);
  await writeFile(join(root, "verify.cjs"), `const fs=require('fs');const v=fs.readFileSync('src/value.ts','utf8');if(v.includes("'bad'")){console.error('ASSUMPTION_CONTRADICTED:A1');process.exit(1)}process.exit(v.includes("'good'")?0:1);\n`);
  await writeFile(join(root, "package.json"), JSON.stringify({ name, scripts: { test: "node verify.cjs", lint: "node -e \"process.exit(1)\"" } }));
  await exec("git", ["-C", root, "init"]); await exec("git", ["-C", root, "config", "user.email", "test@example.com"]); await exec("git", ["-C", root, "config", "user.name", "Test"]); await exec("git", ["-C", root, "add", "."]); await exec("git", ["-C", root, "commit", "-m", "fixture"]);
  const project = await discoverProject(root), memory = createFeltDBProjectMemory({ root, namespace: `pr9:${name}:${Math.random()}`, ephemeral: true }); await memory.initialize(project); await indexProjectIntoMemory(root, project, memory); return { root, project, memory };
};
const plan = (id: string, assumptions: unknown[] = []) => ({ id, taskId: "assigned", objective: "Fix value", assumptions, steps: [{ id: "inspect", order: 1, action: "inspect", description: "Inspect", target: "src/value.ts", dependencies: [], evidence: ["file:src/value.ts"] }], risks: [{ id: "risk", description: "behavior", severity: "low", evidence: ["file:src/value.ts"] }], expectedFiles: ["src/value.ts"], verification: [{ id: "verify", description: "test", evidence: ["file:src/value.ts"] }] });
const proposal = (after: string, id: string) => async ({ plan: current }: { plan: { taskId: string; id: string } }) => ({ id, taskId: current.taskId, planId: current.id, rationale: "fix", expectedChanges: ["value"], files: [{ path: "src/value.ts", operation: "modify", patch: createUnifiedPatch("src/value.ts", ORIGINAL, after) }], verification: [{ id: "tests", command: "npm test", purpose: "targeted test", required: true, timeoutMs: 10_000 }] });
const impact = { id: "impact", repositoryId: "repo", taskId: "task", targets: ["src/value.ts"], affectedFiles: [], affectedSymbols: [], affectedTests: [], relatedSubsystems: [], historicalChanges: [], confidence: .8, evidence: [], assessment: { expectedFiles: ["src/value.ts"], likelyAffectedFiles: [], expectedTests: [], riskAreas: [], evidence: [], decisions: [] }, generatedAt: "2026-08-13T00:00:00.000Z" };
const profile = { taskType: "bugfix" as const, languages: ["TypeScript"], frameworks: [], estimatedComplexity: "medium" as const, requiresReasoning: true, requiresVision: false, requiresTools: true, expectedFiles: 1, expectedChanges: 1, contextSize: 100 };

describe("PR9 bounded autonomous execution certification", () => {
  it("applies deterministic risk-aware autonomy policies", () => {
    const input: RiskInput = { profile, impact, files: 2, lines: 20, historicalFailureRate: 0, verificationCommands: 2 };
    const low = assessAutonomousRisk(input); expect(low.level).toBe("low"); expect(requiresApproval("safe", low.level, true)).toBe(false);
    const high = assessAutonomousRisk({ ...input, files: 14, lines: 350, historicalFailureRate: .5, verificationCommands: 0, profile: { ...profile, subsystem: "database migration", estimatedComplexity: "high" } });
    expect(["high", "critical"]).toContain(high.level); expect(requiresApproval("standard", high.level, false)).toBe(true); expect(requiresApproval("aggressive", "high", false)).toBe(true); expect(requiresApproval("aggressive", "high", true)).toBe(false); expect(requiresApproval("aggressive", "critical", true)).toBe(true);
  });

  it("distinguishes repair, replan, and continue without model authority", () => {
    const risk = assessAutonomousRisk({ profile, impact, files: 1, lines: 2, historicalFailureRate: 0, verificationCommands: 1 }), budget = createAutonomousController({ memory: {} as never }).budget, usage = emptyBudgetUsage();
    const agentPlan = plan("plan", [{ id: "A1", statement: "value owner remains local", evidence: [], status: "unverified" }]) as never;
    const contradicted = checkPlanAssumptions("task", 1, agentPlan, ["ASSUMPTION_CONTRADICTED:A1"]), unchanged = checkPlanAssumptions("task", 1, agentPlan, ["ordinary type error"]);
    expect(evaluateExecution({ taskId: "task", iteration: 1, risk, budget, usage, verificationPassed: false, assumptionChecks: contradicted, impactExpanded: false }).action).toBe("replan");
    expect(evaluateExecution({ taskId: "task", iteration: 1, risk, budget, usage, verificationPassed: false, assumptionChecks: unchanged, impactExpanded: false }).action).toBe("repair");
    expect(evaluateExecution({ taskId: "task", iteration: 1, risk, budget, usage, verificationPassed: true, assumptionChecks: [], impactExpanded: false }).action).toBe("continue");
    expect(evaluateExecution({ taskId: "task", iteration: 1, risk, budget, usage, verificationPassed: true, assumptionChecks: [], impactExpanded: true }).action).toBe("replan");
  });

  it("runs trusted verification from narrow to broad and records escalation", async () => {
    const setup = await fixture("layers");
    const result = await runLayeredVerification(setup.project, "task", "proposal", [{ id: "lint", command: "npm run lint", purpose: "syntax", required: true, timeoutMs: 10_000 }, { id: "tests", command: "npm test", purpose: "targeted tests", required: true, timeoutMs: 10_000 }], { timeoutMs: 20_000, maxOutputBytes: 100_000, allowNetwork: false });
    expect(result.runs.map((run) => run.verificationScope)).toEqual(["syntax", "targeted"]); expect(result.escalations).toEqual([{ from: "syntax", to: "targeted", reason: "earlier verification layer failed" }]); expect(result.final.passed).toBe(false);
  });

  it("replans on contradicted assumptions, then reviews and completes from runtime evidence", async () => {
    const setup = await fixture("replan"); let plannerCalls = 0, mutationCalls = 0; const events: string[] = [];
    const runner = createTaskRunner({ ...setup, plannerLlm: async () => { plannerCalls++; return plannerCalls === 1 ? plan("plan-1", [{ id: "A1", statement: "value owner remains local", evidence: [], status: "unverified" }]) : plan("plan-2"); }, mutationLlm: async (input) => { mutationCalls++; return (mutationCalls === 1 ? proposal(BAD, "bad") : proposal(GOOD, "good"))(input as never); }, approval: async () => "approved" }); runner.subscribe((event) => events.push(event.type));
    const result = await runner.run({ request: "Fix value", mode: "auto" });
    expect(result.state).toBe("completed"); expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(GOOD); expect(plannerCalls).toBe(2); expect(mutationCalls).toBe(2);
    expect(events).toEqual(expect.arrayContaining(["assumption.contradicted", "execution.decision", "execution.replanned", "review.completed", "execution.completed"]));
    expect((await setup.memory.getExecutionDecisions(result.taskId)).map((item) => item.action)).toEqual(expect.arrayContaining(["replan", "continue"]));
    expect(await setup.memory.getAutonomousExecution(result.taskId)).toMatchObject({ status: "completed", usage: { replans: 1, mutations: 2 } });
    expect((await setup.memory.getReviewResults(result.taskId)).at(-1)?.status).toBe("pass"); expect(await setup.memory.listExecutionPatterns()).toHaveLength(1);
  });

  it("checkpoints before exceeding mutation budget and preserves the workspace", async () => {
    const setup = await fixture("budget"); const runner = createTaskRunner({ ...setup, plannerLlm: async () => plan("plan"), mutationLlm: proposal(GOOD, "good"), approval: async () => "approved", autonomy: { budget: { maxMutations: 0 } } });
    const result = await runner.run({ request: "Fix value", mode: "auto" }); expect(result.state).toBe("paused"); expect(result.checkpoint).toMatchObject({ state: "paused", resumeState: "mutating" }); expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(ORIGINAL); expect(await setup.memory.getAutonomousExecution(result.taskId)).toMatchObject({ status: "paused", stopReason: expect.stringContaining("mutations") });
  });

  it("resumes a failed autonomous execution as a new bounded iteration", async () => {
    const setup = await fixture("failed-resume"); let calls = 0;
    const failing = createTaskRunner({ ...setup, plannerLlm: async () => plan("failed-plan"), mutationLlm: async (input) => { calls++; return proposal(BAD, `bad-${calls}`)(input as never); }, approval: async () => "approved" });
    const failed = await failing.run({ request: "Fix value", mode: "auto" }); expect(failed.state).toBe("failed"); expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(ORIGINAL);
    const recovering = createTaskRunner({ ...setup, plannerLlm: async () => plan("recovery-plan"), mutationLlm: proposal(GOOD, "recovery-good"), approval: async () => "approved" });
    const recovered = await recovering.resume(failed.taskId); expect(recovered.state).toBe("completed"); expect(recovered.taskId).toBe(failed.taskId); expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(GOOD);
    expect((await setup.memory.listExecutionPatterns()).map((item) => item.success)).toEqual(expect.arrayContaining([false, true]));
  });

  it("keeps adaptive rerouting deterministic, permits runtime switches, and honors explicit override", async () => {
    const memory = createFeltDBProjectMemory({ root: "/tmp/pr9-routing", namespace: "pr9-routing", ephemeral: true }); await memory.initialize({ id: "route", root: "/tmp/pr9-routing", name: "route", detectedLanguages: ["TypeScript"], packageManagers: [] });
    const model = (id: string, reasoning: boolean, price: number): ModelDefinition => ({ id, provider: "p", name: id, capabilities: { reasoning, tools: true, vision: false, audio: false, structuredOutput: true, embeddings: false }, context: { input: 100_000 }, pricing: { currency: "USD", inputPerMillion: price, outputPerMillion: price }, availability: { online: true, status: "available" }, lifecycle: { status: "stable", lastVerifiedAt: "2026-08-13" }, metadata: {} });
    const models = [model("p:fast", false, .1), model("p:reasoning", true, 5)], low = { ...profile, taskType: "question" as const, estimatedComplexity: "low" as const, requiresReasoning: false, requiresTools: false };
    const first = await selectModel(memory, { taskId: "switch", profile: low, models, iteration: 1 }), second = await selectModel(memory, { taskId: "switch", profile: { ...profile, estimatedComplexity: "high" }, models, iteration: 2 });
    expect(first.selectedModel).toBe("p:fast"); expect(second.selectedModel).toBe("p:reasoning"); expect((await memory.getRoutingDecisions("switch"))).toHaveLength(2);
    expect((await selectModel(memory, { taskId: "override", profile: low, models, model: "p:reasoning", iteration: 1 })).selectedModel).toBe("p:reasoning");
    const signatures = Array.from({ length: 100 }, () => evaluateExecution({ taskId: "same", iteration: 1, risk: assessAutonomousRisk({ profile, impact, files: 1, lines: 1, historicalFailureRate: 0, verificationCommands: 1 }), budget: createAutonomousController({ memory: {} as never }).budget, usage: emptyBudgetUsage(), verificationPassed: false, assumptionChecks: [], impactExpanded: false })).map((item) => `${item.action}:${item.reason}:${JSON.stringify(item.budgetRemaining)}`);
    expect(new Set(signatures).size).toBe(1);
  });

  it("review cannot falsely complete failed, unrelated, or unresolved high-risk work", () => {
    const risk = { level: "high" as const, score: .7, reasons: ["high"], verificationStrength: "strong" as const, generatedAt: "2026-08-13" }, verification = { id: "verify", taskId: "task", proposalId: "proposal", results: [], passed: false, startedAt: "", completedAt: "" };
    const result = reviewExecution({ taskId: "task", iteration: 1, request: "fix", plan: plan("plan") as never, proposal: { id: "proposal", taskId: "task", planId: "plan", rationale: "", expectedChanges: [], files: [{ path: "../outside.ts", operation: "create", patch: "" }], verification: [] }, impact, verification, assumptions: [{ id: "check", taskId: "task", iteration: 1, assumption: { id: "A", statement: "unknown", evidence: [], status: "unverified" }, evidence: [], timestamp: "" }], risk });
    expect(result.status).toBe("fail"); expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["VERIFICATION_FAILED", "UNRELATED_CHANGE", "ASSUMPTION_UNVERIFIED"]));
  });
});
