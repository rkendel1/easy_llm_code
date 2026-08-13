import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodeAgent } from "../src/agent/create-agent.js";
import { createPlanExecutor } from "../src/execution/executor.js";
import { discoverProject } from "../src/discovery/discover-project.js";
import { indexProjectIntoMemory } from "../src/indexing/index-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";
import type { AgentPlan } from "../src/planning/types.js";
import { validatePlan } from "../src/planning/validate-plan.js";
import { createBuiltinToolRegistry } from "../src/tools/registry.js";

const root = resolve(process.cwd(), "../../fixtures/sample-project");
const setup = async () => {
  const project = await discoverProject(root);
  const memory = createFeltDBProjectMemory({ root, namespace: `pr4:${Date.now()}:${Math.random()}` });
  await memory.initialize(project); await indexProjectIntoMemory(root, project, memory);
  return memory;
};

describe("PR4 planner and read-only execution boundary certification", () => {
  it("produces, validates, persists, and executes a structured evidence-backed plan", async () => {
    const memory = await setup();
    const agent = createCodeAgent({ root, memory, plannerLlm: async ({ context }) => ({
      id: "validation-plan", taskId: "replaced", objective: "Plan validation for user creation", assumptions: [],
      steps: [
        { id: "inspect-users", order: 1, action: "inspect", description: "Inspect user creation", target: "src/users.ts", dependencies: [], evidence: ["file:src/users.ts"] },
        { id: "find-validation", order: 2, action: "search", description: "createUser", target: "src", dependencies: ["inspect-users"], evidence: ["file:src/users.ts"] },
        { id: "inspect-tests", order: 3, action: "inspect", description: "Inspect user tests", target: "test/users.test.ts", dependencies: ["find-validation"], evidence: ["file:test/users.test.ts"] }
      ],
      risks: [{ id: "caller-risk", description: "Existing callers may rely on current behavior", severity: "medium", evidence: ["file:src/users.ts"] }],
      expectedFiles: ["src/users.ts", "test/users.test.ts"],
      verification: [{ id: "user-tests", description: "Verify user tests", target: "test/users.test.ts", evidence: ["file:test/users.test.ts"] }]
    }) });
    const result = await agent.plan({ request: "Add validation to user creation" });
    expect(result.plan.steps).toHaveLength(3);
    expect(result.plan.steps.every((step) => step.evidence.length > 0)).toBe(true);
    expect(result.events.filter((event) => event.type === "tool.completed")).toHaveLength(3);
    expect(await memory.getPlan("validation-plan")).toMatchObject({ objective: "Plan validation for user creation" });
    expect((await memory.getTask(result.taskId))?.task.status).toBe("completed");
  });

  it("executes all five bounded read tools", async () => {
    const executor = createPlanExecutor({ root, registry: createBuiltinToolRegistry() });
    const invocations = [
      { tool: "read_file", input: { path: "src/users.ts" } },
      { tool: "list_files", input: { path: "src", pattern: "*.ts" } },
      { tool: "search", input: { query: "createUser", path: "src" } },
      { tool: "git_status", input: {} },
      { tool: "git_diff", input: { path: "src/users.ts" } }
    ];
    for (const invocation of invocations) expect((await executor.executeInvocation(invocation)).at(-1)?.type).toBe("tool.completed");
  });

  it("denies write capability and never mutates the filesystem", async () => {
    const before = await readFile(resolve(root, "src/users.ts"), "utf8");
    const executor = createPlanExecutor({ root, registry: createBuiltinToolRegistry() });
    const plan: AgentPlan = { id: "write-plan", taskId: "write-task", objective: "Attempt write", assumptions: [], risks: [], expectedFiles: ["src/users.ts"], verification: [],
      steps: [{ id: "write", order: 1, action: "modify", description: "Modify users", target: "src/users.ts", dependencies: [], evidence: ["file:src/users.ts"] }] };
    expect((await executor.executePlan(plan)).events).toContainEqual(expect.objectContaining({ type: "tool.denied", tool: "write_file" }));
    expect(await readFile(resolve(root, "src/users.ts"), "utf8")).toBe(before);
  });

  it("rejects traversal and symlink-aware path escapes", async () => {
    const executor = createPlanExecutor({ root, registry: createBuiltinToolRegistry() });
    const events = await executor.executeInvocation({ tool: "read_file", input: { path: "../../etc/passwd" } });
    expect(events.at(-1)).toMatchObject({ type: "tool.failed", error: "PATH_OUTSIDE_REPOSITORY" });
  });

  it("validates invalid plans deterministically", () => {
    const invalid: AgentPlan = { id: "invalid", taskId: "task", objective: "Invalid", assumptions: [], risks: [], expectedFiles: [], verification: [], steps: [
      { id: "same", order: 1, action: "modify", description: "escape", target: "../../etc/passwd", dependencies: ["missing"], evidence: ["missing"] },
      { id: "same", order: 1, action: "analyze", description: "duplicate", dependencies: ["same"], evidence: [] }
    ] };
    const state = { root, files: ["src/users.ts"], evidenceIds: ["file:src/users.ts"] };
    const expected = validatePlan(invalid, state);
    for (let run = 0; run < 100; run++) expect(validatePlan(invalid, state)).toEqual(expected);
    expect(expected.valid).toBe(false);
    expect(expected.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["UNAVAILABLE_CAPABILITY", "PATH_OUTSIDE_REPOSITORY", "INVALID_EVIDENCE"]));
  });
});
