import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-contract-"));
  const memory = createFeltDBProjectMemory({ root, namespace: `contract:${root}`, storagePath: join(root, "memory.json") });
  await memory.initialize({ id: `project:${root}`, root, name: "memory-contract", detectedLanguages: ["TypeScript"], packageManagers: ["npm"] });
  return memory;
};

describe("durable project memory invariant", () => {
  it("tracks generation and fact-level provenance", async () => {
    const memory = await fixture();
    await memory.upsertFile({ id: "file:src/value.ts", path: "src/value.ts", language: "TypeScript", size: 42 });
    await memory.addRelationship({ id: "edge:contains", from: "project", to: "file:src/value.ts", relation: "CONTAINS", confidence: 1, source: "filesystem" });

    const generation = await memory.getGeneration();
    expect(generation).toBeGreaterThan(1);
    expect(await memory.getFactProvenance("file:src/value.ts")).toMatchObject([
      { collection: "files", source: "runtime", confidence: 1, classification: "FACTUAL" }
    ]);
    expect(await memory.getGraphStatistics()).toMatchObject({ generation, nodes: { files: 1 }, relationships: { CONTAINS: 1 } });
  });

  it("scopes destructive resets without touching retained knowledge", async () => {
    const memory = await fixture();
    await memory.upsertFile({ id: "file:src/value.ts", path: "src/value.ts", size: 42 });
    await memory.upsertTask({ id: "task:retained", request: "remember this", status: "completed", createdAt: new Date().toISOString() });

    const before = await memory.getGeneration(), reset = await memory.reset("graph");
    expect(reset).toMatchObject({ scope: "graph" }); expect(reset.generation).toBeGreaterThan(before);
    expect(await memory.listProjectFiles()).toEqual([]);
    expect((await memory.getTask("task:retained"))?.task.request).toBe("remember this");
  });

  it("rebuilds factual generations while retaining learned task memory", async () => {
    const memory = await fixture();
    await memory.upsertFile({ id: "file:old.ts", path: "old.ts", size: 1 });
    await memory.upsertTask({ id: "task:learned", request: "retain", status: "completed", createdAt: new Date().toISOString() });

    const before = await memory.getGeneration(), rebuilt = await memory.prepareRebuild();
    expect(rebuilt.generation).toBeGreaterThan(before);
    expect(await memory.listProjectFiles()).toEqual([]);
    expect((await memory.getTask("task:learned"))?.task.request).toBe("retain");
    await memory.upsertFile({ id: "file:new.ts", path: "new.ts", size: 2 });
    expect(await memory.getFactProvenance("file:new.ts")).toMatchObject([{ classification: "FACTUAL" }]);
  });
});
