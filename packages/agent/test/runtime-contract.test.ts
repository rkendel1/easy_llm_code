import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
    expect(manifest.dependencies).toEqual({ "@easy-llm/code-ide": "0.1.0", "@easy-llm/llm": "^0.10.0", "@feltdb/core": "0.2.0" });
  });

  it("reports explicit ephemeral memory as a degraded non-persistent mode", async () => {
    const memory = createFeltDBProjectMemory({ root, namespace: `ephemeral-capability:${Date.now()}`, ephemeral: true });
    expect(await memory.getCapabilities()).toEqual({ persistent: false, crossProcess: false, reactive: true, temporal: true, graph: true, outcomes: true, execution: true, sync: false, storage: "memory" });
  });

  it("persists zero-config FeltDB memory across process restarts in an atomic private journal", async () => {
    const namespace = `local-durable-restart:${Date.now()}`, directory = await mkdtemp(join(tmpdir(), "easy-llm-memory-")), storagePath = join(directory, "project.json");
    const prelude = `import { createFeltDBProjectMemory } from ${JSON.stringify(memoryModule)}; import { discoverProject } from ${JSON.stringify(discoveryModule)}; const root=${JSON.stringify(root)}; const namespace=${JSON.stringify(namespace)}; const storagePath=${JSON.stringify(storagePath)}; const project=await discoverProject(root);`;
    await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude} const memory=createFeltDBProjectMemory({root,namespace,storagePath}); await memory.initialize(project); await memory.upsertTask({id:'restart-task',request:'remember',status:'completed',createdAt:new Date().toISOString()}); await memory.recordObservation({id:'restart-observation',taskId:'restart-task',type:'agent_analysis',content:'remembered',timestamp:new Date().toISOString()}); await memory.persist();`]);
    const result = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude} const memory=createFeltDBProjectMemory({root,namespace,storagePath}); await memory.initialize(project); const recalled=await memory.getTask('restart-task'); console.log(JSON.stringify({capabilities:await memory.getCapabilities(),content:recalled?.observations[0]?.content}));`]);
    expect(JSON.parse(result.stdout)).toMatchObject({ capabilities: { persistent: true, crossProcess: true, storage: "feltdb-local-journal" }, content: "remembered" });
    expect((await stat(storagePath)).mode & 0o777).toBe(0o600);
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
