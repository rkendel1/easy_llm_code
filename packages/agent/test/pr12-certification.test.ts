import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { discoverProject } from "../src/discovery/discover-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";

const exec = promisify(execFile);
const memoryModule = pathToFileURL(resolve(process.cwd(), "src/memory/feltdb-project-memory.ts")).href;
const discoveryModule = pathToFileURL(resolve(process.cwd(), "src/discovery/discover-project.ts")).href;
const repository = async (name: string) => { const root = await mkdtemp(join(tmpdir(), `${name}-`)); await writeFile(join(root, "package.json"), JSON.stringify({ name })); await writeFile(join(root, "value.ts"), "export const value = 1;\n"); return root; };

describe("PR12 persistent project memory certification", () => {
  it("resolves nested and normalized paths to one stable identity while isolating repositories", async () => {
    const firstRoot = await repository("identity-a"), nested = join(firstRoot, "src");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(nested));
    const [rootIdentity, nestedIdentity, trailingIdentity] = await Promise.all([discoverProject(firstRoot), discoverProject(nested), discoverProject(`${firstRoot}/`)]);
    expect(nestedIdentity).toMatchObject({ id: rootIdentity.id, root: rootIdentity.root });
    expect(trailingIdentity.id).toBe(rootIdentity.id);
    expect((await discoverProject(await repository("identity-b"))).id).not.toBe(rootIdentity.id);
  });

  it("maps Git worktrees to the same project memory identity", async () => {
    const root = await repository("worktree"), worktree = `${root}-branch`;
    await exec("git", ["-C", root, "init"]); await exec("git", ["-C", root, "config", "user.email", "test@example.com"]); await exec("git", ["-C", root, "config", "user.name", "Test"]); await exec("git", ["-C", root, "add", "."]); await exec("git", ["-C", root, "commit", "-m", "fixture"]); await exec("git", ["-C", root, "worktree", "add", "-b", "pr12-worktree", worktree]);
    expect((await discoverProject(worktree)).id).toBe((await discoverProject(root)).id);
  });

  it("merges simultaneous process writers without corruption or lost tasks", async () => {
    const root = await repository("concurrent"), project = await discoverProject(root), storagePath = join(root, "outside-repository-memory.json"), namespace = `pr12:${project.id}`;
    const prelude = `import {createFeltDBProjectMemory} from ${JSON.stringify(memoryModule)};import {discoverProject} from ${JSON.stringify(discoveryModule)};const root=${JSON.stringify(root)},storagePath=${JSON.stringify(storagePath)},namespace=${JSON.stringify(namespace)},project=await discoverProject(root);`;
    const writer = (id: string) => exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude}const memory=createFeltDBProjectMemory({root,storagePath,namespace});await memory.initialize(project);await memory.upsertTask({id:${JSON.stringify(id)},request:${JSON.stringify(id)},status:'completed',createdAt:new Date().toISOString()});await memory.persist();`]);
    await Promise.all([writer("task:a"), writer("task:b")]);
    const result = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude}const memory=createFeltDBProjectMemory({root,storagePath,namespace});await memory.initialize(project);console.log(JSON.stringify({tasks:(await memory.listTasks()).map(x=>x.id).sort(),generation:await memory.getGeneration()}));`]);
    expect(JSON.parse(result.stdout)).toMatchObject({ tasks: ["task:a", "task:b"] });
    expect(JSON.parse(result.stdout).generation).toBeGreaterThan(2);
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toMatchObject({ version: 2, namespace });
  });

  it("exports deterministically with provenance while excluding secrets", async () => {
    const root = await repository("export"), project = await discoverProject(root), memory = createFeltDBProjectMemory({ root, namespace: `pr12-export:${project.id}`, storagePath: join(root, "memory.json") }); await memory.initialize(project);
    await memory.upsertTask({ id: "task:portable", request: "use token=super-secret-value", status: "completed", createdAt: "2026-08-13T00:00:00.000Z" });
    const first = await memory.exportMemory(), second = await memory.exportMemory(), serialized = JSON.stringify(first);
    expect(first).toEqual(second);
    expect(serialized).not.toContain("super-secret-value");
    expect(first.operations.some((operation) => operation.collection === "fact_provenance")).toBe(true);
  });

  it("imports a portable snapshot into another local store for the same project", async () => {
    const root = await repository("import"), project = await discoverProject(root), source = createFeltDBProjectMemory({ root, namespace: `pr12-import-source:${project.id}`, storagePath: join(root, "source.json") }); await source.initialize(project); await source.upsertTask({ id: "task:imported", request: "portable", status: "completed", createdAt: new Date().toISOString() });
    const snapshot = await source.exportMemory(), target = createFeltDBProjectMemory({ root, namespace: `pr12-import-target:${project.id}`, storagePath: join(root, "target.json") }); await target.initialize(project); await target.importMemory(snapshot);
    expect((await target.getTask("task:imported"))?.task.request).toBe("portable");
    expect(await target.getFactProvenance("task:imported")).toMatchObject([{ classification: "FACTUAL" }]);
  });

  it("reports provider, schema, generation, integrity, storage, and sync state", async () => {
    const root = await repository("status"), project = await discoverProject(root), memory = createFeltDBProjectMemory({ root, namespace: `pr12-status:${project.id}`, storagePath: join(root, "memory.json") }); await memory.initialize(project);
    expect(await memory.getStatus()).toMatchObject({ projectId: project.id, provider: "local", schemaVersion: 2, integrity: "ok", sync: { status: "local-only", conflicts: 0 }, capabilities: { persistent: true, crossProcess: true, sync: false } });
  });

  it("resets routing evidence without cascading into task memory", async () => {
    const root = await repository("routing-reset"), project = await discoverProject(root), memory = createFeltDBProjectMemory({ root, namespace: `pr12-routing:${project.id}`, storagePath: join(root, "memory.json") }); await memory.initialize(project);
    await memory.upsertTask({ id: "task:routing", request: "retain", status: "completed", createdAt: new Date().toISOString() });
    await memory.persistRoutingDecision({ id: "routing:1", taskId: "task:routing", selectedModel: "provider:model", selectedProvider: "provider", candidates: [], reason: { summary: ["explicit"], confidence: { level: "high", evidenceCount: 1, comparableTasks: 1 }, evidenceTaskIds: [] }, score: 1, profile: { taskType: "bugfix", languages: ["TypeScript"], frameworks: [], estimatedComplexity: "low", requiresReasoning: false, requiresVision: false, requiresTools: true, expectedFiles: 1, expectedChanges: 1, contextSize: 100 }, createdAt: new Date().toISOString() });
    await memory.reset("routing");
    expect(await memory.listRoutingDecisions()).toEqual([]);
    expect((await memory.getTask("task:routing"))?.task.request).toBe("retain");
  });
});
