import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createCodeAgent } from "../src/agent/create-agent.js";
import { createContextEngine } from "../src/context/build-context.js";
import { discoverProject } from "../src/discovery/discover-project.js";
import { ingestRepositoryHistory } from "../src/history/ingest-history.js";
import { indexProjectIntoMemory } from "../src/indexing/index-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";

const exec = promisify(execFile);
const sampleRoot = resolve(process.cwd(), "../../fixtures/sample-project");

const indexedMemory = async (root: string) => {
  const project = await discoverProject(root);
  const memory = createFeltDBProjectMemory({ root, namespace: `pr3:${Date.now()}:${Math.random()}` });
  await memory.initialize(project);
  await indexProjectIntoMemory(root, project, memory);
  return memory;
};

describe("PR3 context intelligence certification", () => {
  it("ranks direct, dependency, and test context above unrelated files", async () => {
    const memory = await indexedMemory(sampleRoot);
    const bundle = await createContextEngine({ memory }).build({ request: "Explain user creation" });
    const paths = bundle.items.filter((item) => ["file", "test"].includes(item.type)).map((item) => item.reference);
    expect(paths).toContain("src/users.ts");
    expect(paths).toContain("src/repository.ts");
    expect(paths).toContain("test/users.test.ts");
    expect(paths.indexOf("src/users.ts")).toBeLessThan(paths.indexOf("src/repository.ts"));
    if (paths.includes("src/api.ts")) expect(paths.indexOf("src/repository.ts")).toBeLessThan(paths.indexOf("src/api.ts"));

    const auth = await createContextEngine({ memory }).build({ request: "Explain authentication" });
    expect(auth.files.map((file) => file.path)).toEqual(expect.arrayContaining(["src/auth.ts", "test/auth.test.ts"]));
  });

  it("retrieves historical commits and explicitly reverted approaches", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-history-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "context-history" }));
    await writeFile(join(root, "src/auth.ts"), "export const authenticate = (x: string) => x.length > 0;\n");
    await exec("git", ["-C", root, "init"]); await exec("git", ["-C", root, "config", "user.email", "test@example.com"]); await exec("git", ["-C", root, "config", "user.name", "Test"]);
    await exec("git", ["-C", root, "add", "."]); await exec("git", ["-C", root, "commit", "-m", "Refactor authentication architecture"]);
    await writeFile(join(root, "src/auth.ts"), "const cache = new Map(); export const authenticate = (x: string) => cache.has(x);\n");
    await exec("git", ["-C", root, "add", "."]); await exec("git", ["-C", root, "commit", "-m", "Implement authentication caching"]);
    const cacheSha = (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", root, "revert", "--no-edit", cacheSha]);
    const memory = await indexedMemory(root); await ingestRepositoryHistory(root, memory);
    const bundle = await createContextEngine({ memory }).build({ request: "Why is authentication caching implemented this way?" });
    expect(bundle.items.some((item) => item.type === "commit")).toBe(true);
    expect(bundle.items.some((item) => item.metadata?.revertedBy)).toBe(true);
  });

  it("enforces item, character, and token budgets over 100 files", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-budget-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "context-budget" }));
    await mkdir(join(root, "src"));
    for (let index = 0; index < 105; index++) await writeFile(join(root, `src/common-${String(index).padStart(3, "0")}.ts`), `export const common${index} = "${"x".repeat(200)}";\n`);
    const memory = await indexedMemory(root);
    const bundle = await createContextEngine({ memory, budget: { maxItems: 7, maxCharacters: 1_500, maxTokens: 300 } }).build({ request: "Explain common modules" });
    expect(bundle.totalCandidates).toBeGreaterThan(7);
    expect(bundle.selectedItems).toBeLessThanOrEqual(7);
    expect(bundle.metrics.characters).toBeLessThanOrEqual(1_500);
    expect(bundle.estimatedTokens).toBeLessThanOrEqual(300);
    expect(bundle.metrics.compressionRatio).toBeGreaterThan(0);
  });

  it("returns identical ordered IDs for 100 identical queries", async () => {
    const memory = await indexedMemory(sampleRoot);
    const engine = createContextEngine({ memory });
    const expected = (await engine.build({ request: "Explain authentication" })).items.map((item) => item.id);
    for (let run = 0; run < 100; run++) expect((await engine.build({ request: "Explain authentication" })).items.map((item) => item.id)).toEqual(expected);
  });

  it("retrieves prior memory and persists the context decision", async () => {
    const memory = await indexedMemory(sampleRoot);
    await memory.upsertTask({ id: "prior", request: "Study validation", status: "completed", createdAt: new Date().toISOString() });
    await memory.recordObservation({ id: "validation-lesson", taskId: "prior", type: "warning", content: "Validation belongs in createUser", timestamp: new Date().toISOString(), relatedFiles: ["file:src/users.ts"] });
    const recalled = await createContextEngine({ memory }).build({ request: "What validation lesson applies to createUser?" });
    expect(recalled.items.some((item) => item.id === "observation:validation-lesson" && item.reason.memory === 1)).toBe(true);

    const agent = createCodeAgent({ root: sampleRoot, memory, llm: async ({ context }) => ({
      summary: "bounded", relevantFiles: context.files.slice(0, 1).map((file) => ({ path: file.path, reason: file.reason })),
      dependencies: [], recommendedNextSteps: []
    }) });
    const result = await agent.run({ request: "Explain user validation" });
    const task = await memory.getTask(result.taskId);
    expect(task?.observations.some((observation) => observation.type === "decision" && (observation.content as { selected?: unknown[] }).selected?.length)).toBeTruthy();
  });
});
