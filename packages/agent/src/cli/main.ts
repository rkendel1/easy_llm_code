#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { createCodeAgent } from "../agent/create-agent.js";
import { discoverProject } from "../discovery/discover-project.js";
import { indexProjectIntoMemory } from "../indexing/index-project.js";
import { createFeltDBProjectMemory } from "../memory/feltdb-project-memory.js";
import { ingestRepositoryHistory } from "../history/ingest-history.js";
import { createContextEngine } from "../context/build-context.js";

const args = process.argv.slice(2);
const rootArg = args.find((arg) => arg.startsWith("--root="));
const mockMode = args.includes("--mock");
const invocationCwd = process.env.INIT_CWD ?? process.cwd();
const root = resolve(invocationCwd, rootArg ? rootArg.slice("--root=".length) : process.cwd());

const positional = args.filter((arg) => !arg.startsWith("--"));
const requestArg = positional[0];

const printDoctor = async (memory: ReturnType<typeof createFeltDBProjectMemory>): Promise<void> => {
  const capabilities = await memory.getCapabilities();
  console.log("FeltDB");
  console.log("Package:        @feltdb/core 0.2.0");
  console.log("Runtime:        Node");
  console.log(`Persistence:    ${capabilities.persistent ? "durable" : "ephemeral"}`);
  console.log(`FELTDB_URL:     ${process.env.FELTDB_URL ? "configured" : "not configured"}`);
  console.log(`FELTDB_TOKEN:   ${process.env.FELTDB_TOKEN ? "configured" : "not configured"}`);
  console.log(`Memory survives process restart: ${capabilities.persistent ? "YES" : "NO"}`);
};

const printMemory = async (memory: ReturnType<typeof createFeltDBProjectMemory>): Promise<void> => {
  if (positional[1] === "file" && positional[2]) {
    const history = await memory.getFileHistory(positional[2]);
    const impact = await memory.getChangeImpact([positional[2]]);
    console.log(history.file.path); console.log(`History  ${history.totalCommits} commits`);
    for (const change of history.changes.slice(0, 10)) console.log(`  ${change.commit.sha.slice(0, 8)} ${change.commit.message.split("\n")[0]}`);
    console.log(`Dependents  ${impact.dependents.join(", ") || "none"}`); console.log(`Tests  ${impact.tests.join(", ") || "none"}`);
    return;
  }
  if (positional[1] === "changes") {
    for (const change of await memory.getRecentChanges()) console.log(`${change.commit.sha.slice(0, 8)}  ${change.commit.message.split("\n")[0]}`);
    return;
  }
  if (positional[1] === "task" && positional[2]) { console.log(JSON.stringify(await memory.getTask(positional[2]), null, 2)); return; }
  const summary = await memory.getSummary();
  console.log("Repository Memory\n────────────────────────");
  console.log(`Files             ${summary.files}\nSymbols           ${summary.symbols}\nRelationships     ${summary.relationships}\nCommits           ${summary.commits}\nAgent tasks       ${summary.tasks}\nObservations      ${summary.observations}`);
  console.log("Recent changes"); for (const change of summary.recentChanges) console.log(`  ${change.commit.message.split("\n")[0]}`);
  console.log(`Historical signals\n  ${summary.frequentCoChanges} frequent co-changes\n  ${summary.revertedChanges} reverted changes`);
};

const main = async (): Promise<void> => {
  const feltUrl = process.env.FELTDB_URL;
  const feltToken = process.env.FELTDB_TOKEN;
  const memory = createFeltDBProjectMemory({ root, server: feltUrl && feltToken ? { url: feltUrl, token: feltToken } : undefined });
  if (requestArg === "doctor") { await printDoctor(memory); return; }
  console.log("Indexing repository...");
  const project = await discoverProject(root);
  await memory.initialize(project);

  const indexed = await indexProjectIntoMemory(root, project, memory);
  const history = await ingestRepositoryHistory(root, memory);
  console.log(`✓ ${indexed.files.length} files`);
  console.log(`✓ ${indexed.symbols.length} symbols`);
  console.log(`✓ ${indexed.relationships.length} relationships`);
  console.log(`✓ ${history.indexedCommits} new commits`);

  if (requestArg === "memory") { await printMemory(memory); return; }
  if (requestArg === "context") {
    const request = positional.slice(1).join(" ");
    if (!request) throw new Error("Usage: llm-code context \"your question\"");
    const bundle = await createContextEngine({ memory }).build({ request });
    console.log("Context Intelligence\n─────────────────────");
    console.log(`Candidates: ${bundle.totalCandidates}\nSelected:   ${bundle.selectedItems}\nEstimated:  ${bundle.estimatedTokens.toLocaleString()} tokens`);
    console.log("Selected");
    for (const item of bundle.items) {
      const reasons = Object.entries(item.reason).filter(([, value]) => value > 0).map(([key]) => key).join(" + ");
      console.log(`${item.score.toFixed(2)}  ${item.reference}\n      ${reasons}`);
    }
    console.log(`Excluded: ${bundle.totalCandidates - bundle.selectedItems}`);
    console.log(`Context reduction: ${(bundle.metrics.compressionRatio * 100).toFixed(0)}%`);
    return;
  }

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
