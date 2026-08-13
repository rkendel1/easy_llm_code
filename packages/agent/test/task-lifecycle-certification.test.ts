import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { discoverProject } from "../src/discovery/discover-project.js";
import { indexProjectIntoMemory } from "../src/indexing/index-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";
import { createUnifiedPatch } from "../src/mutation/patch.js";
import { createTaskRunner } from "../src/task/runner.js";
import type { AgentEvent } from "../src/task/events.js";
import { transitionTaskState } from "../src/task/state-machine.js";

const exec = promisify(execFile); const ORIGINAL = "export const value = 'old';\n", GOOD = "export const value = 'good';\n", BAD = "export const value = 'bad';\n";
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "pr6-task-")); await mkdir(join(root, "src")); await writeFile(join(root, "src/value.ts"), ORIGINAL);
  await writeFile(join(root, "verify.cjs"), "const fs=require('fs');process.exit(fs.readFileSync('src/value.ts','utf8').includes(\"'good'\")?0:1);\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "task-fixture", scripts: { test: "node verify.cjs" } }));
  await exec("git", ["-C", root, "init"]); await exec("git", ["-C", root, "config", "user.email", "test@example.com"]); await exec("git", ["-C", root, "config", "user.name", "Test"]); await exec("git", ["-C", root, "add", "."]); await exec("git", ["-C", root, "commit", "-m", "fixture"]);
  const project = await discoverProject(root), memory = createFeltDBProjectMemory({ root, namespace: `pr6:${Date.now()}:${Math.random()}`, ephemeral: true }); await memory.initialize(project); await indexProjectIntoMemory(root, project, memory);
  return { root, memory };
};
const plannerLlm = async () => ({ id: "plan", taskId: "assigned", objective: "Fix value", assumptions: [],
  steps: [{ id: "inspect", order: 1, action: "inspect", description: "Inspect value", target: "src/value.ts", dependencies: [], evidence: ["file:src/value.ts"] }],
  risks: [{ id: "risk", description: "Behavior change", severity: "low", evidence: ["file:src/value.ts"] }], expectedFiles: ["src/value.ts"], verification: [{ id: "verify", description: "Run tests", evidence: ["file:src/value.ts"] }] });
const mutation = (after: string, id: string) => async ({ plan }: { plan: { taskId: string; id: string } }) => ({ id, taskId: plan.taskId, planId: plan.id, rationale: "Fix value", expectedChanges: ["value"],
  files: [{ path: "src/value.ts", operation: "modify", patch: createUnifiedPatch("src/value.ts", ORIGINAL, after) }], verification: [{ id: "tests", command: "npm test", purpose: "Verify", required: true, timeoutMs: 10_000 }] });

describe("PR6 autonomous task lifecycle certification", () => {
  it("rejects arbitrary state jumps deterministically", () => {
    for (let run = 0; run < 100; run++) expect(() => transitionTaskState("created", "verifying")).toThrow("INVALID_TASK_TRANSITION");
  });

  it("completes context, plan, approval, mutation, and verification with ordered events", async () => {
    const setup = await fixture(), events: AgentEvent[] = [];
    const runner = createTaskRunner({ ...setup, plannerLlm, mutationLlm: mutation(GOOD, "good"), approval: async () => "approved" }); runner.subscribe((event) => events.push(event));
    const result = await runner.run({ request: "Fix value", mode: "auto" });
    expect(result.state).toBe("completed"); expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(GOOD);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["task.started", "context.completed", "plan.created", "mutation.completed", "verification.completed", "task.completed"]));
    expect((await setup.memory.getTaskCheckpoint(result.taskId))?.state).toBe("completed");
  });

  it("pauses after atomic mutation and resumes verification without a new task", async () => {
    const setup = await fixture(); const first = createTaskRunner({ ...setup, plannerLlm, mutationLlm: mutation(GOOD, "good") });
    first.subscribe((event) => { if (event.type === "mutation.completed") first.cancel(); });
    const paused = await first.run({ request: "Fix value", mode: "auto" }); expect(paused.state).toBe("paused"); expect(paused.checkpoint.resumeState).toBe("verifying");
    const resumed = await createTaskRunner({ ...setup, plannerLlm, mutationLlm: mutation(GOOD, "unused") }).resume(paused.taskId);
    expect(resumed.state).toBe("completed"); expect(resumed.taskId).toBe(paused.taskId); expect(await setup.memory.listTasks()).toHaveLength(1);
  });

  it("cancels at the safe boundary after an in-flight verification", async () => {
    const setup = await fixture(); const runner = createTaskRunner({ ...setup, plannerLlm, mutationLlm: mutation(GOOD, "good") });
    runner.subscribe((event) => { if (event.type === "verification.started") runner.cancel(); });
    const result = await runner.run({ request: "Fix value", mode: "auto" }); expect(result.state).toBe("paused"); expect(result.checkpoint.resumeState).toBe("verifying");
    expect(await setup.memory.getTaskCheckpoint(result.taskId)).toMatchObject({ state: "paused", transactionId: expect.any(String) });
  });

  it("repairs a failed mutation and records two attempts", async () => {
    const setup = await fixture(); let calls = 0;
    const runner = createTaskRunner({ ...setup, plannerLlm, mutationLlm: async (input) => { calls++; return (calls === 1 ? mutation(BAD, "bad") : mutation(GOOD, "good"))(input as never); } });
    const result = await runner.run({ request: "Fix value", mode: "auto" }); expect(result).toMatchObject({ state: "completed", outcome: { attempts: 2 } }); expect(calls).toBe(2);
  });

  it("fails after repair exhaustion with no partial transaction", async () => {
    const setup = await fixture(); let calls = 0;
    const runner = createTaskRunner({ ...setup, plannerLlm, mutationLlm: async (input) => { calls++; return mutation(BAD, `bad-${calls}`)(input as never); } });
    const result = await runner.run({ request: "Fix value", mode: "auto" }); expect(result.state).toBe("failed"); expect(result.outcome?.attempts).toBe(3); expect(calls).toBe(3);
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(ORIGINAL); expect((await setup.memory.getTaskCheckpoint(result.taskId))?.state).toBe("failed");
  });

  it("produces equivalent lifecycle decisions for identical state", async () => {
    const decisions: string[][] = [];
    for (let run = 0; run < 2; run++) { const setup = await fixture(), types: string[] = []; const runner = createTaskRunner({ ...setup, plannerLlm, mutationLlm: mutation(GOOD, "good") }); runner.subscribe((event) => types.push(event.type)); await runner.run({ request: "Fix value", mode: "auto" }); decisions.push(types); }
    expect(decisions[1]).toEqual(decisions[0]);
  });

  it.runIf(Boolean(process.env.FELTDB_URL && process.env.FELTDB_TOKEN))("recovers a paused mutation in a second durable process", async () => {
    const setup = await fixture(), namespace = `pr6-durable:${Date.now()}`;
    const memoryUrl = pathToFileURL(join(process.cwd(), "src/memory/feltdb-project-memory.ts")).href;
    const discoveryUrl = pathToFileURL(join(process.cwd(), "src/discovery/discover-project.ts")).href;
    const indexingUrl = pathToFileURL(join(process.cwd(), "src/indexing/index-project.ts")).href;
    const runnerUrl = pathToFileURL(join(process.cwd(), "src/task/runner.ts")).href;
    const patchUrl = pathToFileURL(join(process.cwd(), "src/mutation/patch.ts")).href;
    const prelude = `import {createFeltDBProjectMemory} from ${JSON.stringify(memoryUrl)};import {discoverProject} from ${JSON.stringify(discoveryUrl)};import {indexProjectIntoMemory} from ${JSON.stringify(indexingUrl)};import {createTaskRunner} from ${JSON.stringify(runnerUrl)};import {createUnifiedPatch} from ${JSON.stringify(patchUrl)};const root=${JSON.stringify(setup.root)},namespace=${JSON.stringify(namespace)},server={url:process.env.FELTDB_URL,token:process.env.FELTDB_TOKEN};const project=await discoverProject(root);const memory=createFeltDBProjectMemory({root,namespace,server});await memory.initialize(project);`;
    const mocks = `const plannerLlm=async()=>({id:'durable-plan',taskId:'assigned',objective:'Fix value',assumptions:[],steps:[{id:'inspect',order:1,action:'inspect',description:'Inspect',target:'src/value.ts',dependencies:[],evidence:['file:src/value.ts']}],risks:[{id:'risk',description:'change',severity:'low',evidence:['file:src/value.ts']}],expectedFiles:['src/value.ts'],verification:[{id:'verify',description:'tests',evidence:['file:src/value.ts']}]});const mutationLlm=async({plan})=>({id:'durable-proposal',taskId:plan.taskId,planId:plan.id,rationale:'fix',expectedChanges:['value'],files:[{path:'src/value.ts',operation:'modify',patch:createUnifiedPatch('src/value.ts',${JSON.stringify(ORIGINAL)},${JSON.stringify(GOOD)})}],verification:[{id:'tests',command:'npm test',purpose:'verify',required:true,timeoutMs:10000}]});`;
    const first = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude}await indexProjectIntoMemory(root,project,memory);${mocks}const runner=createTaskRunner({root,memory,plannerLlm,mutationLlm});runner.subscribe(e=>{if(e.type==='mutation.completed')runner.cancel()});const result=await runner.run({request:'Fix value',mode:'auto'});console.log(JSON.stringify({taskId:result.taskId,state:result.state}));`]);
    const paused = JSON.parse(first.stdout.trim()) as { taskId: string; state: string }; expect(paused.state).toBe("paused");
    const second = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `${prelude}${mocks}const result=await createTaskRunner({root,memory,plannerLlm,mutationLlm}).resume(${JSON.stringify(paused.taskId)});console.log(JSON.stringify({taskId:result.taskId,state:result.state}));`]);
    expect(JSON.parse(second.stdout)).toEqual({ taskId: paused.taskId, state: "completed" });
  });
});
