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
import { gitDiffTool } from "../tools/builtin/git-diff.js";
import { detectVerificationCommands } from "../verification/policy.js";
import { runVerification } from "../verification/runner.js";
import { createTaskRunner } from "../task/runner.js";
import type { TaskMode } from "../task/lifecycle.js";
import { renderAgentEvent } from "../ux/renderer.js";
import { createTerminalApproval } from "../ux/terminal.js";
import { renderPerformanceSummary } from "../ux/summaries.js";

const args = process.argv.slice(2);
const rootArg = args.find((arg) => arg.startsWith("--root="));
const mockMode = args.includes("--mock");
const jsonMode = args.includes("--json");
const configuredMode = args.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) as TaskMode | undefined;
if (configuredMode && !["ask", "plan", "edit", "auto"].includes(configuredMode)) throw new Error(`Invalid task mode: ${configuredMode}`);
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
  if (!jsonMode) console.log("Indexing repository...");
  const project = await discoverProject(root);
  await memory.initialize(project);

  const indexed = await indexProjectIntoMemory(root, project, memory);
  const history = await ingestRepositoryHistory(root, memory);
  if (!jsonMode) {
    console.log(`✓ ${indexed.files.length} files`);
    console.log(`✓ ${indexed.symbols.length} symbols`);
    console.log(`✓ ${indexed.relationships.length} relationships`);
    console.log(`✓ ${history.indexedCommits} new commits`);
  }

  const executeLifecycle = async (request: string | undefined, mode: TaskMode, resumeId?: string): Promise<void> => {
    const terminalApproval = createTerminalApproval();
    const runner = createTaskRunner({
      root, memory,
      askLlm: mockMode ? async ({ request: task }) => ({ summary: `Mock analysis for: ${task}` }) : undefined,
      plannerLlm: mockMode ? async ({ context }) => {
        const selected = context.files.slice(0, 3), fallback = context.items[0]?.id ?? "none";
        return { id: `plan:${Date.now()}`, taskId: "assigned", objective: request ?? "Resume task", assumptions: [],
          steps: selected.map((file, index) => ({ id: `step-${index + 1}`, order: index + 1, action: "inspect", description: `Inspect ${file.path}`, target: file.path, dependencies: index ? [`step-${index}`] : [], evidence: [file.id] })),
          risks: [{ id: "risk", description: "Existing behavior may be relied upon", severity: "medium", evidence: [selected[0]?.id ?? fallback] }], expectedFiles: selected.map((file) => file.path),
          verification: [{ id: "verify", description: "Review relevant tests", evidence: [selected.at(-1)?.id ?? fallback] }] };
      } : undefined,
      approval: async (input) => input.mode === "auto" || args.includes("--yes") ? "approved" : terminalApproval(input)
    });
    runner.subscribe((event) => console.log(jsonMode ? JSON.stringify(event) : renderAgentEvent(event)));
    const onInterrupt = (): void => runner.cancel(); process.once("SIGINT", onInterrupt);
    try {
      const result = resumeId ? await runner.resume(resumeId) : await runner.run({ request: request ?? "", mode });
      if (!jsonMode) {
        if (mode === "ask" && result.answer !== undefined) console.log(typeof result.answer === "string" ? result.answer : JSON.stringify(result.answer, null, 2));
        if (mode === "plan" && result.plan) for (const step of result.plan.steps) console.log(`${step.order}. ${step.description}${step.target ? `\n   ${step.target}` : ""}`);
        const models = await memory.getModelExecutions(result.taskId); if (result.outcome) console.log(renderPerformanceSummary({ model: models.at(-1), outcome: result.outcome, context: result.context?.metrics }));
      }
    } finally { process.removeListener("SIGINT", onInterrupt); }
  };

  if (requestArg === "memory") { await printMemory(memory); return; }
  if (requestArg === "diff") {
    const result = await gitDiffTool.execute({}, { root }); console.log(result.diff || "No working-tree diff."); return;
  }
  if (requestArg === "verify") {
    const commands = await detectVerificationCommands(project);
    const run = await runVerification(project, "manual-verification", "manual", commands);
    if (jsonMode) console.log(JSON.stringify(run, null, 2)); else { console.log("Verification"); for (const result of run.results) console.log(`${result.status === "passed" ? "✓" : "✗"} ${result.command}`); if (!run.results.length) console.log("No trusted verification scripts detected."); }
    if (!run.passed) process.exitCode = 1; return;
  }
  if (requestArg === "task" && positional[1]) {
    const [task, outcome, plan, models, transactions, verifications, events] = await Promise.all([memory.getTask(positional[1]), memory.getTaskOutcome(positional[1]), memory.findPlanForTask(positional[1]), memory.getModelExecutions(positional[1]), memory.getMutationTransactions(positional[1]), memory.getVerificationRuns(positional[1]), memory.getTaskEvents(positional[1])]);
    const value = { task, outcome, plan, models, transactions, verifications, events }; if (jsonMode) console.log(JSON.stringify(value, null, 2));
    else if (!task) console.log(`Task ${positional[1]} not found.`); else { const model = models.at(-1); console.log(`Task: ${task.task.request}\nStatus: ${(outcome?.status ?? task.task.status).toUpperCase()}\nModel\n  ${model?.provider ?? "unknown"}/${model?.model ?? "unknown"}${model?.estimatedCost !== undefined ? `\n  $${model.estimatedCost.toFixed(4)}` : ""}\nPlan\n  ${plan?.steps.length ?? 0} steps\nMutation\n  ${outcome?.filesChanged ?? 0} files\n  ${outcome?.linesChanged ?? 0} changed lines\n  ${transactions.at(-1)?.status ?? "none"}\nVerification\n  ${outcome?.verificationPassed ? "✓ passed" : "not passed"}\n  ${verifications.flatMap((run) => run.results).length} command(s)\nAttempts\n  ${outcome?.attempts ?? 0}\nDuration\n  ${outcome?.durationMs ?? 0}ms`); }
    if (!jsonMode && events.length) { console.log("Timeline:"); for (const event of events) console.log(`  ${event.timestamp.slice(11, 19)} ${event.event.type}`); }
    return;
  }
  if (requestArg === "tasks") {
    const tasks = await memory.listTasks(); if (jsonMode) console.log(JSON.stringify(tasks, null, 2)); else { console.log("Recent tasks"); for (const task of tasks) { const outcome = await memory.getTaskOutcome(task.id); console.log(`${task.id.slice(0, 8)}  ${task.request.slice(0, 28).padEnd(28)}  ${outcome?.status === "success" ? "✓" : outcome?.status === "failure" ? "✗" : "…"}  ${outcome?.durationMs ? `${Math.round(outcome.durationMs / 1000)}s` : ""}`); } } return;
  }
  if (requestArg === "resume" && positional[1]) { await executeLifecycle(undefined, "edit", positional[1]); return; }
  if (["ask", "plan", "edit", "auto"].includes(requestArg ?? "")) { const mode = requestArg as TaskMode, taskRequest = positional.slice(1).join(" "); if (!taskRequest) throw new Error(`Usage: llm-code ${mode} \"your request\"`); await executeLifecycle(taskRequest, mode); return; }
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
  if (requestArg === "plan") {
    const request = positional.slice(1).join(" ");
    if (!request) throw new Error("Usage: llm-code plan [--json] \"your requested change\"");
    const planningAgent = createCodeAgent({
      root, memory,
      plannerLlm: mockMode ? async ({ context }) => {
        const selectedFiles = context.files.slice(0, 3);
        const fallback = context.items[0]?.id ?? "none";
        return {
          id: "mock-plan", taskId: "assigned-by-planner", objective: request, assumptions: [],
          steps: selectedFiles.map((file, index) => ({ id: `step-${index + 1}`, order: index + 1, action: "inspect", description: `Inspect ${file.path}`, target: file.path, dependencies: index ? [`step-${index}`] : [], evidence: [file.id] })),
          risks: [{ id: "risk-1", description: "Existing callers may rely on current behavior", severity: "medium", evidence: [selectedFiles[0]?.id ?? fallback] }],
          expectedFiles: selectedFiles.map((file) => file.path),
          verification: [{ id: "verify-1", description: "Review the resulting diff and relevant tests", evidence: [selectedFiles.at(-1)?.id ?? fallback] }]
        };
      } : undefined
    });
    const result = await planningAgent.plan({ request });
    if (jsonMode) { console.log(JSON.stringify(result, null, 2)); return; }
    console.log(`Planning...\nContext\n  ${result.context.selectedItems} items\n  ${result.context.estimatedTokens.toLocaleString()} estimated tokens`);
    console.log("Plan\n────────────────────────────");
    for (const step of result.plan.steps) console.log(`${step.order}. ${step.description}${step.target ? `\n   ${step.target}` : ""}`);
    console.log("Risks"); for (const risk of result.plan.risks) console.log(`  • ${risk.description}`);
    console.log("Verification"); for (const verification of result.plan.verification) console.log(`  • ${verification.description}`);
    console.log("No files changed."); return;
  }
  if (requestArg === "apply" && positional[1]) {
    const plan = await memory.getPlan(positional[1]);
    if (!plan) throw new Error(`Plan ${positional[1]} not found. Durable FeltDB is required to recover plans across CLI sessions.`);
    const mutationAgent = createCodeAgent({ root, memory, mutationLlm: mockMode ? async () => ({ id: `mock-proposal:${plan.id}`, taskId: plan.taskId, planId: plan.id, files: [], rationale: "Mock no-op proposal", expectedChanges: [], verification: [] }) : undefined });
    let proposal = await memory.findMutationForPlan(plan.id);
    if (!proposal) proposal = await mutationAgent.proposeMutation(plan, await createContextEngine({ memory }).build({ request: plan.objective }));
    if (!jsonMode) { console.log("Changes"); for (const file of proposal.files) console.log(` ${file.operation === "create" ? "A" : file.operation === "delete" ? "D" : "M"} ${file.path}`); console.log(`Why:\n  ${proposal.rationale}`); }
    let approved = args.includes("--yes");
    if (!approved) { const rl = createInterface({ input, output }); const answer = await rl.question(`Apply ${proposal.files.length} proposed file change(s)? [y/N] `); rl.close(); approved = /^y(?:es)?$/i.test(answer.trim()); }
    if (!approved) { console.log("No files changed."); return; }
    const result = await mutationAgent.applyMutation(proposal, plan, true);
    if (jsonMode) console.log(JSON.stringify(result, null, 2)); else console.log(result.outcome.status === "success" ? "Task complete." : `Task failed after ${result.outcome.attempts} attempt(s); changes rolled back.`);
    return;
  }

  let request = requestArg;
  if (!request) {
    const rl = createInterface({ input, output });
    request = await rl.question("What would you like me to understand?\n> ");
    rl.close();
  }

  const mutationIntent = /^(add|change|create|delete|fix|implement|modify|refactor|remove|rename|update)\b/i.test(request ?? "");
  await executeLifecycle(request ?? "", configuredMode ?? (mutationIntent ? "edit" : "ask"));
};

void main();
