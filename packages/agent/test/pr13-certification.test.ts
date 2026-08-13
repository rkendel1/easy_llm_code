import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { llm } from "@easy-llm/llm";
import { discoverProject } from "../src/discovery/discover-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";
import { DEFAULT_PROJECT_CONFIG, projectConfigPath, readProjectConfig } from "../src/config/project-config.js";
import { onboardProject } from "../src/workspace/onboarding.js";
import { getWorkspaceStatus } from "../src/workspace/status.js";
import { createProgressProjector } from "../src/workspace/progress.js";
import { inferWorkspaceTaskMode, isWorkspaceExitIntent } from "../src/workspace/task-mode.js";
import { createTaskRunner } from "../src/task/runner.js";
import { startRuntimeServer } from "../src/ide/runtime-server.js";
import { RuntimeClient } from "@easy-llm/code-ide";
import { ideCapabilities } from "../src/ide/capabilities.js";

let configurationRoot = ""; const prior: Record<string, string | undefined> = {}, servers: Array<Awaited<ReturnType<typeof startRuntimeServer>>> = [];
const repository = async (name: string) => { const root = await mkdtemp(join(tmpdir(), `${name}-`)); await mkdir(join(root, "src")); await writeFile(join(root, "package.json"), JSON.stringify({ name })); await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n"); return root; };
const memoryFor = async (root: string) => { const project = await discoverProject(root), memory = createFeltDBProjectMemory({ root: project.root, namespace: `pr13:${project.id}`, storagePath: join(configurationRoot, `${project.id}.json`) }); await memory.initialize(project); return { project, memory }; };

beforeEach(async () => { configurationRoot = await mkdtemp(join(tmpdir(), "pr13-config-")); for (const name of ["EASY_LLM_CODE_MEMORY_HOME", "EASY_LLM_CODE_USER_CONFIG", "EASY_LLM_CODE_IDE_CONFIG"]) prior[name] = process.env[name]; process.env.EASY_LLM_CODE_MEMORY_HOME = join(configurationRoot, "projects"); process.env.EASY_LLM_CODE_USER_CONFIG = join(configurationRoot, "user.json"); process.env.EASY_LLM_CODE_IDE_CONFIG = join(configurationRoot, "ide.json"); });
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); for (const [name, value] of Object.entries(prior)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });

describe("PR13 coding workspace and onboarding certification", () => {
  it("uses the published 0.10 model CX contract", () => {
    expect(typeof llm).toBe("function");
    expect(typeof llm.explain).toBe("function");
    expect(typeof llm.unlock).toBe("function");
  });

  it("persists smart, secret-free defaults for a fresh project and becomes ready", async () => {
    const { project, memory } = await memoryFor(await repository("onboarding")), result = await onboardProject({ project, memory, selectIDE: async () => undefined }), config = await readProjectConfig(project.id);
    expect(result).toMatchObject({ firstRun: true, project: "onboarding", config: { initialized: true, memory: { provider: "local", sync: false }, model: { mode: "automatic" }, execution: { sandbox: true, networkPolicy: "none", riskPolicy: "standard" }, verification: { enabled: true, repairAttempts: 2 }, telemetry: "local-project-memory-only" } });
    expect(result.steps.every((step) => step.status === "ready" || step.id === "routing")).toBe(true);
    expect(await readFile(projectConfigPath(project.id), "utf8")).not.toMatch(/api.?key|token|password|secret/i);
    expect(config.initializedAt).toBeTruthy();
  });

  it("recognizes an existing graph, preserves configuration, and avoids reindexing unchanged files", async () => {
    const setup = await memoryFor(await repository("returning")), first = await onboardProject(setup), generation = await setup.memory.getGeneration(), second = await onboardProject(setup);
    expect(first.firstRun).toBe(true); expect(second.firstRun).toBe(false);
    expect(second.steps.find((step) => step.id === "index")?.detail).toContain("already current");
    expect(await setup.memory.getGeneration()).toBeGreaterThanOrEqual(generation);
  });

  it("infers one primary Run action as question or autonomous change", () => {
    expect(inferWorkspaceTaskMode("Why does user creation return null?")).toBe("ask");
    expect(inferWorkspaceTaskMode("whats the status of the code")).toBe("ask");
    expect(inferWorkspaceTaskMode("Fix the failing authentication tests")).toBe("auto");
    expect(inferWorkspaceTaskMode("Add pagination to users")).toBe("auto");
  });

  it("treats conversational no-op answers as workspace exit intents", () => {
    expect(isWorkspaceExitIntent("nothing")).toBe(true);
    expect(isWorkspaceExitIntent("No thanks.")).toBe(true);
    expect(isWorkspaceExitIntent("do nothing to the auth module")).toBe(false);
  });

  it("projects detailed runtime events into a compact human progress model", () => {
    const projector = createProgressProjector(); projector.update({ type: "task.started", taskId: "task:1" }); projector.update({ type: "context.started" }); projector.update({ type: "context.completed", metrics: { candidateCount: 10, selectedCount: 4, characters: 100, estimatedTokens: 25, rawEstimatedTokens: 50, compressionRatio: .5 } }); projector.update({ type: "routing.completed", model: "model", provider: "provider", score: .9, confidence: "high" }); projector.update({ type: "verification.started", command: "npm test" });
    const progress = projector.current(); expect(progress).toMatchObject({ taskId: "task:1", context: { items: 4 }, model: { id: "model", provider: "provider" } }); expect(progress.stages.find((stage) => stage.id === "verify")?.status).toBe("active"); expect(progress.stages.slice(0, 4).every((stage) => stage.status === "complete")).toBe(true);
  });

  it("runs a first conversational task and exposes it after reopening the workspace", async () => {
    const setup = await memoryFor(await repository("journey")); await onboardProject(setup); const runner = createTaskRunner({ root: setup.project.root, memory: setup.memory, askLlm: async () => ({ text: "The value is explained." }) }); const result = await runner.run({ request: "Why is this value exported?", mode: "ask" });
    expect(result).toMatchObject({ state: "completed", answer: { text: "The value is explained." } });
    expect(await setup.memory.getModelExecutions(result.taskId)).toMatchObject([{ taskId: result.taskId, phase: "context" }]);
    const reopened = createFeltDBProjectMemory({ root: setup.project.root, namespace: `pr13:${setup.project.id}`, storagePath: join(configurationRoot, `${setup.project.id}.json`) }); await reopened.initialize(setup.project); const status = await getWorkspaceStatus(setup.project, await readProjectConfig(setup.project.id), reopened);
    expect(status).toMatchObject({ state: "ready", project: { indexed: true }, recentTasks: [{ id: result.taskId, request: "Why is this value exported?", status: "completed" }] });
  });

  it("keeps recommended defaults as explicit configuration values", () => { expect(DEFAULT_PROJECT_CONFIG).toMatchObject({ memory: { provider: "local" }, model: { mode: "automatic" }, routing: { mode: "automatic" }, execution: { sandbox: true, networkPolicy: "none", riskPolicy: "standard" }, verification: { enabled: true, repairAttempts: 2 }, context: { automatic: true, gitHistory: true } }); });

  it("exposes the same workspace status, intelligence, and durable tasks to IDE clients", async () => {
    const setup = await memoryFor(await repository("ide-workspace")); await onboardProject(setup); await setup.memory.upsertTask({ id: "task:durable", request: "Persisted in another interface", status: "completed", createdAt: new Date().toISOString() }); const runtime = await startRuntimeServer({ root: setup.project.root, memory: setup.memory }); servers.push(runtime); const client = new RuntimeClient({ baseUrl: runtime.url, token: runtime.token }); await client.connect({ identity: { id: "test", name: "Test", adapterVersion: "1" }, capabilities: ideCapabilities() });
    expect(await client.getWorkspaceStatus()).toMatchObject({ state: "ready", project: { id: setup.project.id }, memory: { capabilities: { persistent: true } } });
    expect(await client.getProjectIntelligence()).toMatchObject({ tasks: 1 }); expect((await client.getProjectIntelligence()).files).toBeGreaterThan(0);
    expect(await client.listTasks()).toMatchObject([{ id: "task:durable", request: "Persisted in another interface" }]); await client.disconnect();
  });
});
