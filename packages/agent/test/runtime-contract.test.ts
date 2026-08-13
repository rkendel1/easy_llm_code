import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";

const root = resolve(process.cwd(), "../../fixtures/sample-project");
const exec = promisify(execFile);
const memoryModule = pathToFileURL(resolve(process.cwd(), "src/memory/feltdb-project-memory.ts")).href;
const discoveryModule = pathToFileURL(resolve(process.cwd(), "src/discovery/discover-project.ts")).href;

describe("FeltDB runtime and dependency contract", () => {
  it("uses the exact providers and remains private", async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8"));
    expect(manifest.private).toBe(true);
    expect(manifest.dependencies).toEqual({ "@easy-llm/code-ide": "0.1.0", "@easy-llm/llm": "0.1.7", "@feltdb/core": "0.2.0" });
  });

  it("reports zero-config memory as reactive, temporal, graph-backed, and ephemeral", async () => {
    const memory = createFeltDBProjectMemory({ root, namespace: `ephemeral-capability:${Date.now()}` });
    expect(await memory.getCapabilities()).toEqual({ persistent: false, reactive: true, temporal: true, graph: true });
  });

  it("does not retain observations in a new ephemeral process-equivalent instance", async () => {
    const namespace = `ephemeral-restart:${Date.now()}`;
    const prelude = `import { createFeltDBProjectMemory } from ${JSON.stringify(memoryModule)}; import { discoverProject } from ${JSON.stringify(discoveryModule)}; const root=${JSON.stringify(root)}; const namespace=${JSON.stringify(namespace)}; const project=await discoverProject(root);`;
    await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude} const memory=createFeltDBProjectMemory({root,namespace}); await memory.initialize(project); await memory.upsertTask({id:'restart-task',request:'remember',status:'completed',createdAt:new Date().toISOString()}); await memory.recordObservation({id:'restart-observation',taskId:'restart-task',type:'agent_analysis',content:'remembered',timestamp:new Date().toISOString()});`]);
    const result = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude} const memory=createFeltDBProjectMemory({root,namespace}); await memory.initialize(project); console.log(JSON.stringify(await memory.getTask('restart-task')));`]);
    expect(result.stdout.trim()).toBe("undefined");
  });

  it.runIf(Boolean(process.env.FELTDB_URL && process.env.FELTDB_TOKEN))(
    "retains observations across durable process restarts when credentials are available",
    async () => {
      const namespace = `durable-restart:${Date.now()}`;
      const prelude = `import { createFeltDBProjectMemory } from ${JSON.stringify(memoryModule)}; import { discoverProject } from ${JSON.stringify(discoveryModule)}; const root=${JSON.stringify(root)}; const namespace=${JSON.stringify(namespace)}; const project=await discoverProject(root); const server={url:process.env.FELTDB_URL,token:process.env.FELTDB_TOKEN};`;
      await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude} const memory=createFeltDBProjectMemory({root,namespace,server}); await memory.initialize(project); await memory.upsertTask({id:'durable-task',request:'remember',status:'completed',createdAt:new Date().toISOString()}); await memory.recordObservation({id:'durable-observation',taskId:'durable-task',type:'agent_analysis',content:'durable',timestamp:new Date().toISOString()});`]);
      const result = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude} const memory=createFeltDBProjectMemory({root,namespace,server}); await memory.initialize(project); const recalled=await memory.getTask('durable-task'); console.log(JSON.stringify({capabilities:await memory.getCapabilities(),content:recalled?.observations[0]?.content}));`]);
      expect(JSON.parse(result.stdout)).toMatchObject({ capabilities: { persistent: true }, content: "durable" });
    }
  );
});
