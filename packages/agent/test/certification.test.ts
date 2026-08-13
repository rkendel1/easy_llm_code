import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodeAgent } from "../src/agent/create-agent.js";
import { discoverProject } from "../src/discovery/discover-project.js";
import { indexProjectIntoMemory } from "../src/indexing/index-project.js";
import { createFeltDBProjectMemory } from "../src/memory/feltdb-project-memory.js";

describe("PR1 vertical loop certification", () => {
  it("runs discover -> index -> context -> agent -> observation -> memory recall", async () => {
    const root = resolve(process.cwd(), "../../fixtures/sample-project");
    const project = await discoverProject(root);

    expect(project.name).toBe("sample-project");
    expect(project.packageManagers).toContain("npm");

    const memory = createFeltDBProjectMemory({
      root,
      namespace: `test:${Date.now()}`,
      ephemeral: true
    });

    await memory.initialize(project);
    const indexed = await indexProjectIntoMemory(root, project, memory);

    expect(indexed.files.length).toBeGreaterThan(0);
    expect(indexed.symbols.length).toBeGreaterThan(0);
    expect(indexed.relationships.length).toBeGreaterThan(0);

    const context = await memory.queryContext({ text: "Add validation to user creation" });
    const paths = context.files.map((file) => file.path);

    expect(paths.some((path) => path.endsWith("src/users.ts"))).toBe(true);
    expect(paths.some((path) => path.endsWith("test/users.test.ts"))).toBe(true);

    let capturedContextFiles: string[] = [];

    const agent = createCodeAgent({
      root,
      memory,
      llm: async ({ task, context }) => {
        capturedContextFiles = context.files.map((file) => file.path);
        return {
          summary: `Structured analysis about authentication and user creation for: ${task}`,
          relevantFiles: context.files.slice(0, 4).map((file) => ({
            path: file.path,
            reason: file.reason
          })),
          dependencies: context.relationships.slice(0, 4).map((edge) => ({
            from: edge.from,
            to: edge.to,
            reason: edge.relation
          })),
          recommendedNextSteps: ["Add validation around createUser"]
        };
      }
    });

    const firstRun = await agent.run({ request: "Explain how authentication works." });

    expect(firstRun.analysis.summary).toContain("authentication");
    expect(capturedContextFiles.length).toBeGreaterThan(0);

    const secondContext = await memory.queryContext({ text: "What did you learn about authentication?" });

    expect(secondContext.files.some((file) => file.path.endsWith("src/auth.ts"))).toBe(true);
  });
});
