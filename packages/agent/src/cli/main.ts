#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { createCodeAgent } from "../agent/create-agent.js";
import { discoverProject } from "../discovery/discover-project.js";
import { indexProjectIntoMemory } from "../indexing/index-project.js";
import { createFeltDBProjectMemory } from "../memory/feltdb-project-memory.js";

const args = process.argv.slice(2);
const rootArg = args.find((arg) => arg.startsWith("--root="));
const mockMode = args.includes("--mock");
const invocationCwd = process.env.INIT_CWD ?? process.cwd();
const root = resolve(invocationCwd, rootArg ? rootArg.slice("--root=".length) : process.cwd());

const requestArg = args.find((arg) => !arg.startsWith("--"));

const main = async (): Promise<void> => {
  console.log("Indexing repository...");
  const project = await discoverProject(root);
  const memory = createFeltDBProjectMemory({ root });
  await memory.initialize(project);

  const indexed = await indexProjectIntoMemory(root, project, memory);
  console.log(`✓ ${indexed.files.length} files`);
  console.log(`✓ ${indexed.symbols.length} symbols`);
  console.log(`✓ ${indexed.relationships.length} relationships`);

  let request = requestArg;
  if (!request) {
    const rl = createInterface({ input, output });
    request = await rl.question("What would you like me to understand?\n> ");
    rl.close();
  }

  const agent = createCodeAgent({
    root,
    memory,
    llm: mockMode
      ? async ({ task, context }) => ({
          summary: `Mock analysis for: ${task}`,
          relevantFiles: context.files.slice(0, 4).map((file) => ({
            path: file.path,
            reason: file.reason
          })),
          dependencies: context.relationships.slice(0, 4).map((edge) => ({
            from: edge.from,
            to: edge.to,
            reason: edge.relation
          })),
          recommendedNextSteps: ["Run without --mock to use @easy-llm/llm"]
        })
      : undefined
  });

  console.log("Searching project memory...");
  const result = await agent.run({ request: request ?? "" });

  console.log("Relevant:");
  for (const file of result.analysis.relevantFiles) {
    console.log(`  ${file.path}`);
  }
  console.log("Analyzing...");
  console.log(result.analysis.summary);
};

void main();
