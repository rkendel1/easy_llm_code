import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { discoverProject } from "../src/discovery/discover-project.js";
import { ingestRepositoryHistory } from "../src/history/ingest-history.js";
import { indexProjectIntoMemory } from "../src/indexing/index-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";

const exec = promisify(execFile);
const roots: string[] = [];
const git = (root: string, ...args: string[]) => exec("git", ["-C", root, ...args]);

const commit = async (root: string, message: string): Promise<string> => {
  await git(root, "add", "."); await git(root, "commit", "-m", message);
  return (await git(root, "rev-parse", "HEAD")).stdout.trim();
};

describe("PR2 temporal repository memory certification", () => {
  afterAll(async () => { /* OS temp cleanup is intentionally left to the test runner. */ });

  it("indexes only unseen commits and grounds history, impact, tasks, and reverts", async () => {
    const root = await mkdtemp(join(tmpdir(), "felt-pr2-")); roots.push(root);
    await mkdir(join(root, "src")); await mkdir(join(root, "test"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "temporal-fixture" }));
    await writeFile(join(root, "src/repository.ts"), "export const save = (x: string) => x;\n");
    await writeFile(join(root, "src/users.ts"), "import { save } from './repository.js';\nexport const createUser = (x: string) => save(x);\n");
    await writeFile(join(root, "test/users.test.ts"), "import { createUser } from '../src/users.js';\nexport const testUser = () => createUser('a');\n");
    await git(root, "init"); await git(root, "config", "user.email", "test@example.com"); await git(root, "config", "user.name", "Test");
    await commit(root, "Add user creation");
    await writeFile(join(root, "src/users.ts"), "import { save } from './repository.js';\nexport const createUser = (x: string) => { if (!x) throw Error('invalid'); return save(x); };\n");
    await writeFile(join(root, "test/users.test.ts"), "import { createUser } from '../src/users.js';\nexport const testUser = () => createUser('valid');\n");
    await commit(root, "Add user validation");
    await writeFile(join(root, "src/users.ts"), "import { save } from './repository.js';\nconst cache = new Map();\nexport const createUser = (x: string) => cache.get(x) ?? save(x);\n");
    const cacheSha = await commit(root, "Implement caching");
    await git(root, "revert", "--no-edit", cacheSha);

    const project = await discoverProject(root);
    const memory = createFeltDBProjectMemory({ root, namespace: `pr2:${Date.now()}` });
    await memory.initialize(project); await indexProjectIntoMemory(root, project, memory);
    const first = await ingestRepositoryHistory(root, memory);
    expect(first.indexedCommits).toBe(4);
    expect((await ingestRepositoryHistory(root, memory)).indexedCommits).toBe(0);

    const history = await memory.getFileHistory("file:src/users.ts");
    expect(history.totalCommits).toBe(4);
    expect(history.changes.some((change) => change.commit.message.includes("validation"))).toBe(true);
    const context = await memory.queryContext({ text: "How did user creation and caching change?" });
    expect(context.files.some((file) => file.path === "src/users.ts")).toBe(true);
    expect(context.changes?.some((change) => change.revertedBy)).toBe(true);
    const impact = await memory.getChangeImpact(["src/users.ts"]);
    expect(impact.tests).toContain("test/users.test.ts");
    expect(impact.recentlyChangedTogether).toContain("test/users.test.ts");

    await memory.upsertTask({ id: "task-1", request: "Explain authentication", status: "completed", createdAt: new Date().toISOString() });
    await memory.recordObservation({ id: "obs-1", taskId: "task-1", type: "agent_analysis", content: { summary: "Users are validated" }, timestamp: new Date().toISOString(), relatedFiles: ["file:src/users.ts"] });
    expect((await memory.getTask("task-1"))?.observations).toHaveLength(1);

    await writeFile(join(root, "src/users.ts"), "export const createUser = (x: string) => x.trim();\n");
    await commit(root, "Refactor createUser");
    expect((await ingestRepositoryHistory(root, memory)).indexedCommits).toBe(1);
    expect((await memory.getSummary()).commits).toBe(5);
  });
});
