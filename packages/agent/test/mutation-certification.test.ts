import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createMutationExecutor } from "../src/execution/mutation-executor.js";
import { discoverProject } from "../src/discovery/discover-project.js";
import { indexProjectIntoMemory } from "../src/indexing/index-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";
import { createUnifiedPatch } from "../src/mutation/patch.js";
import { hashContent } from "../src/mutation/validate.js";
import type { MutationProposal } from "../src/mutation/types.js";
import type { AgentPlan } from "../src/planning/types.js";

const exec = promisify(execFile);
const ORIGINAL = "export const value = \"old\";\n";
const GOOD = "export const value = \"good\";\n";
const BAD = "export const value = \"bad\";\n";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "pr5-mutation-")); await mkdir(join(root, "src"));
  await writeFile(join(root, "src/value.ts"), ORIGINAL); await writeFile(join(root, "src/unrelated.ts"), "export const untouched = true;\n");
  await writeFile(join(root, "verify.cjs"), "const fs=require('fs'); process.exit(fs.readFileSync('src/value.ts','utf8').includes('\\\"good\\\"') ? 0 : 1);\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "mutation-fixture", scripts: { test: "node verify.cjs" } }));
  await exec("git", ["-C", root, "init"]); await exec("git", ["-C", root, "config", "user.email", "test@example.com"]); await exec("git", ["-C", root, "config", "user.name", "Test"]);
  await exec("git", ["-C", root, "add", "."]); await exec("git", ["-C", root, "commit", "-m", "fixture"]);
  const project = await discoverProject(root), memory = createFeltDBProjectMemory({ root, namespace: `pr5:${Date.now()}:${Math.random()}`, ephemeral: true });
  await memory.initialize(project); await indexProjectIntoMemory(root, project, memory);
  const plan: AgentPlan = { id: "plan", taskId: "task", objective: "Change value", assumptions: [], risks: [], expectedFiles: ["src/value.ts"], verification: [],
    steps: [{ id: "analyze", order: 1, action: "analyze", description: "Change value", target: "src/value.ts", dependencies: [], evidence: ["file:src/value.ts"] }] };
  return { root, project, memory, plan };
};
const proposal = (after: string, id = "proposal"): MutationProposal => ({ id, taskId: "task", planId: "plan", rationale: "certification", expectedChanges: ["value"],
  files: [{ path: "src/value.ts", operation: "modify", beforeHash: hashContent(ORIGINAL), afterHash: hashContent(after), patch: createUnifiedPatch("src/value.ts", ORIGINAL, after) }],
  verification: [{ id: "tests", command: "npm test", purpose: "Verify value", required: true, timeoutMs: 10_000 }] });

describe("PR5 safe mutation and verification certification", () => {
  it("requires approval under the default policy", async () => {
    const setup = await fixture();
    await expect(createMutationExecutor(setup).execute({ proposal: proposal(GOOD), plan: setup.plan })).rejects.toThrow("APPROVAL_REQUIRED");
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(ORIGINAL);
  });

  it("applies a simple approved mutation and verifies it", async () => {
    const setup = await fixture(); const result = await createMutationExecutor(setup).execute({ proposal: proposal(GOOD), plan: setup.plan, approved: true });
    expect(result.outcome).toMatchObject({ status: "success", attempts: 1, verificationPassed: true });
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(GOOD);
  });

  it("rejects a stale proposal without overwriting the newer file", async () => {
    const setup = await fixture(), proposed = proposal(GOOD); await writeFile(join(setup.root, "src/value.ts"), "export const value = \"newer\";\n");
    await expect(createMutationExecutor(setup).execute({ proposal: proposed, plan: setup.plan, approved: true })).rejects.toThrow("STALE_PATCH");
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toContain("newer");
  });

  it("rejects conflicting user changes present when the proposal was made", async () => {
    const setup = await fixture(), user = "export const value = \"user-work\";\n"; await writeFile(join(setup.root, "src/value.ts"), user);
    const proposed = proposal(GOOD); proposed.files[0].beforeHash = hashContent(user); proposed.files[0].patch = createUnifiedPatch("src/value.ts", user, GOOD);
    await expect(createMutationExecutor(setup).execute({ proposal: proposed, plan: setup.plan, approved: true })).rejects.toThrow("CONFLICTING_USER_CHANGES");
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(user);
  });

  it("rejects path traversal, unplanned files, and deletion", async () => {
    const traversal = await fixture(), outside: MutationProposal = { ...proposal(GOOD), files: [{ path: "../../escape.ts", operation: "create", patch: createUnifiedPatch("../../escape.ts", "", GOOD), afterHash: hashContent(GOOD) }] };
    traversal.plan.expectedFiles.push("../../escape.ts"); await expect(createMutationExecutor(traversal).execute({ proposal: outside, plan: traversal.plan, approved: true })).rejects.toThrow("PATH_OUTSIDE_REPOSITORY");
    const unplanned = await fixture(), extra = proposal(GOOD); extra.files[0].path = "src/unrelated.ts";
    await expect(createMutationExecutor(unplanned).execute({ proposal: extra, plan: unplanned.plan, approved: true })).rejects.toThrow("UNPLANNED_MUTATION");
    const deletion = await fixture(), remove = proposal(""); remove.files[0] = { path: "src/value.ts", operation: "delete", beforeHash: hashContent(ORIGINAL), patch: createUnifiedPatch("src/value.ts", ORIGINAL, "") };
    await expect(createMutationExecutor(deletion).execute({ proposal: remove, plan: deletion.plan, approved: true })).rejects.toThrow("POLICY_DENIED");
  });

  it("rolls back a mutation when verification fails", async () => {
    const setup = await fixture(); const result = await createMutationExecutor({ ...setup, maxRepairAttempts: 0 }).execute({ proposal: proposal(BAD), plan: setup.plan, approved: true });
    expect(result.outcome.status).toBe("failure"); expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(ORIGINAL);
    expect(result.transaction?.status).toBe("rolled_back");
  });

  it("repairs once and succeeds on the second attempt", async () => {
    const setup = await fixture(); const result = await createMutationExecutor({ ...setup, repair: async () => proposal(GOOD, "repair-good") }).execute({ proposal: proposal(BAD), plan: setup.plan, approved: true });
    expect(result.outcome).toMatchObject({ status: "success", attempts: 2 }); expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(GOOD);
  });

  it("stops after three failures and restores the original", async () => {
    const setup = await fixture(); let repair = 0; const result = await createMutationExecutor({ ...setup, repair: async () => proposal(BAD, `repair-${++repair}`) }).execute({ proposal: proposal(BAD), plan: setup.plan, approved: true });
    expect(result.outcome).toMatchObject({ status: "failure", attempts: 3 }); expect(repair).toBe(2); expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(ORIGINAL);
  });

  it("preserves unrelated user changes byte-for-byte", async () => {
    const setup = await fixture(), userWork = "export const untouched = 'precious user work';\n"; await writeFile(join(setup.root, "src/unrelated.ts"), userWork);
    const result = await createMutationExecutor(setup).execute({ proposal: proposal(GOOD), plan: setup.plan, approved: true });
    expect(result.outcome.status).toBe("success"); expect(await readFile(join(setup.root, "src/unrelated.ts"), "utf8")).toBe(userWork);
  });
});
