#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve, sep } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { createCodeAgent } from "../agent/create-agent.js";
import { discoverProject } from "../discovery/discover-project.js";
import { indexProjectIntoMemory } from "../indexing/index-project.js";
import { createFeltDBProjectMemory } from "../memory/feltdb-project-memory.js";
import { createProjectMemory } from "../memory/create-project-memory.js";
import { writeMemoryConfig, type MemoryStorageMode } from "../memory/core/memory-config.js";
import { reconcileProjectMemory } from "../memory/lifecycle/reconcile.js";
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
import { createTaskProfile } from "../intelligence/task-profile.js";
import { selectModel } from "../routing/model-selector.js";
import { explainRoutingDecision, explainTask } from "../intelligence/explain.js";
import { createChangeIntelligence } from "../change-intelligence/analyze-impact.js";
import { mineChangePatterns } from "../change-intelligence/patterns.js";
import { SandboxManager } from "../sandbox/core/sandbox-manager.js";
import { LocalProcessSandboxProvider } from "../sandbox/providers/local/local-process-provider.js";
import { createIDERegistry } from "../ide/registry.js";
import { readIDEConfiguration, resolveIDESelection, writeIDEConfiguration } from "../ide/config.js";
import { startRuntimeServer } from "../ide/runtime-server.js";

const args = process.argv.slice(2);
const rootArg = args.find((arg) => arg.startsWith("--root="));
const mockMode = args.includes("--mock");
const jsonMode = args.includes("--json");
const configuredMode = args.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) as TaskMode | undefined;
const optionValue = (name: string): string | undefined => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const modelOption = optionValue("model");
const budgetValue = optionValue("budget"), budgetOption = budgetValue === undefined ? undefined : Number(budgetValue);
if (budgetOption !== undefined && (!Number.isFinite(budgetOption) || budgetOption < 0)) throw new Error(`Invalid budget: ${budgetValue}`);
const autonomyMode = args.includes("--safe") ? "safe" : args.includes("--aggressive") ? "aggressive" : "standard";
if (configuredMode && !["ask", "plan", "edit", "auto"].includes(configuredMode)) throw new Error(`Invalid task mode: ${configuredMode}`);
const invocationCwd = process.env.INIT_CWD ?? process.cwd();
let root = resolve(invocationCwd, rootArg ? rootArg.slice("--root=".length) : process.cwd());

const optionsWithValues = new Set(["--model", "--budget", "--type", "--task", "--ide", "--port", "--confirm"]);
const positional = args.filter((arg, index) => !arg.startsWith("--") && !optionsWithValues.has(args[index - 1] ?? ""));
const requestArg = positional[0];

const printDoctor = async (memory: ReturnType<typeof createFeltDBProjectMemory>): Promise<void> => {
  const capabilities = await memory.getCapabilities(), project = await memory.getProject(), summary = await memory.getSummary(), graph = await memory.getGraphStatistics(), status = await memory.getStatus();
  console.log("Project Memory\n────────────────────────────");
  console.log(`Project:        ${project.name}`);
  console.log(`Project ID:     ${project.id}`);
  console.log("Package:        @feltdb/core 0.2.0");
  console.log(`Provider:       FeltDB ${status.provider}\nStorage:        ${capabilities.storage} (${status.storageBytes} bytes)\nPersistence:    ${capabilities.persistent ? "✓" : "✗ EPHEMERAL"}\nCross-process:  ${capabilities.crossProcess ? "✓" : "✗"}\nGraph:          ${capabilities.graph ? "✓" : "✗"}\nGit history:    ${capabilities.temporal ? "✓" : "✗"}\nTask memory:    ${capabilities.outcomes ? "✓" : "✗"}\nOutcome:        ${capabilities.outcomes ? "✓" : "✗"}\nExecution:      ${capabilities.execution ? "✓" : "✗"}\nSchema:         v${status.schemaVersion}\nLast sync:      ${status.sync.lastSyncAt ?? "never"}\nIntegrity:      ${status.integrity === "ok" ? "✓" : "✗"}\nSecrets:        ✓ credentials are not persisted`);
  console.log(`Memory:\n  ${summary.tasks} tasks\n  ${summary.commits} commits\n  ${summary.files} files\n  ${graph.nodes.patterns ?? 0} learned patterns`);
  if (!capabilities.persistent) console.log("⚠ Project memory will be lost when this process exits.");
};

const printMemory = async (memory: ReturnType<typeof createFeltDBProjectMemory>): Promise<void> => {
  if (positional[1] === "graph") { const stats = await memory.getGraphStatistics(); console.log(`Persistent Project Graph\nGeneration ${stats.generation}\nNodes\n${Object.entries(stats.nodes).map(([name, count]) => `  ${name.padEnd(18)} ${count}`).join("\n")}\nRelationships\n${Object.entries(stats.relationships).sort((a, b) => b[1] - a[1]).map(([name, count]) => `  ${name.padEnd(22)} ${count}`).join("\n")}`); return; }
  if (positional[1] === "why" && positional[2]) { const facts = await memory.getFactProvenance(positional[2]); if (!facts.length) console.log(`No provenance found for ${positional[2]}.`); else for (const fact of facts) console.log(`${fact.collection}:${fact.factId}\nSource: ${fact.source}\nObserved: ${fact.observedAt}\nConfidence: ${fact.confidence.toFixed(2)}\nGeneration: ${fact.generation}\nEvidence: ${fact.evidence.join(", ") || "direct observation"}`); return; }
  if (positional[1] === "impact") { const [predictions, outcomes] = await Promise.all([memory.listImpactPredictions(), memory.listPredictionOutcomes()]); console.log(`Impact memory\nPredictions: ${predictions.length}\nOutcomes: ${outcomes.length}`); for (const item of predictions.slice(0, 20)) console.log(`${item.targets.join(", ")} → ${item.affectedFiles.length} files / ${item.affectedTests.length} tests  ${Math.round(item.confidence * 100)}%`); return; }
  if (positional[1] === "patterns") { const project = await memory.getProject(), generatedAt = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString(); for (const pattern of mineChangePatterns(project.id, await memory.getRecentChanges({ limit: 10_000 }), generatedAt)) await memory.persistChangePattern(pattern); const [patterns, changes, executions] = await Promise.all([memory.listSuccessfulPatterns(), memory.listChangePatterns(), memory.listExecutionPatterns()]); console.log("Successful patterns"); patterns.forEach((item, index) => console.log(`${index + 1}. ${item.summary}\n   ${item.taskType}${item.subsystem ? ` / ${item.subsystem}` : ""} · Task ${item.taskId}\n   ${item.approach}`)); console.log("Change patterns"); changes.slice(0, 30).forEach((item) => console.log(`${item.target} → ${item.usuallyChanges.slice(0, 5).map((related) => `${related.path} (${Math.round(related.confidence * 100)}%)`).join(", ")}`)); console.log("Execution patterns"); executions.slice(0, 30).forEach((item) => console.log(`${item.taskType}${item.subsystem ? `/${item.subsystem}` : ""} ${item.risk} → ${item.strategy.join(" → ")} (${item.success ? "success" : "failure"})`)); if (!patterns.length && !changes.length && !executions.length) console.log("No patterns recorded yet."); return; }
  if (positional[1] === "failures") { const patterns = await memory.listFailurePatterns(); console.log("Failure patterns"); patterns.forEach((item, index) => console.log(`${index + 1}. ${item.description}\n   ${item.failureClass}${item.subsystem ? ` / ${item.subsystem}` : ""} · Task ${item.taskId}\n   Avoid: ${item.attemptedApproach}`)); if (!patterns.length) console.log("No failure patterns recorded yet."); return; }
  if (positional[1] === "file" && positional[2]) {
    const history = await memory.getFileHistory(positional[2]);
    const impact = await memory.getChangeImpact([positional[2]]);
    console.log(history.file.path); console.log(`History  ${history.totalCommits} commits`);
    for (const change of history.changes.slice(0, 10)) console.log(`  ${change.commit.sha.slice(0, 8)} ${change.commit.message.split("\n")[0]}`);
    console.log(`Dependents  ${impact.dependents.join(", ") || "none"}`); console.log(`Tests  ${impact.tests.join(", ") || "none"}`);
    const learned = await createChangeIntelligence({ memory }).analyzeChangeImpact({ files: [positional[2]] });
    console.log(`Likely impact  ${learned.affectedFiles.map((item) => `${item.path} (${Math.round(item.confidence * 100)}%)`).join(", ") || "none"}`);
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
  if (requestArg === "ide") {
    const registry = createIDERegistry(), detected = await registry.detect(), available = registry.list(), action = positional[1] ?? (input.isTTY && output.isTTY ? "select" : "status");
    if (action === "detect") { const value = detected.map(({ adapter, detection }) => ({ id: adapter.id, name: adapter.name, ...detection })); if (jsonMode) console.log(JSON.stringify(value, null, 2)); else { console.log("Detected IDEs"); for (const item of value) console.log(`${item.detected ? "✓" : "○"} ${item.name}${item.path ? `\n  ${item.path}` : ""}`); } return; }
    if (action === "use") { const id = positional[2]; if (!id) throw new Error("Usage: llm-code ide use <ide>"); registry.get(id); const configuration = await readIDEConfiguration(); await writeIDEConfiguration({ ...configuration, selectedIDE: id }); console.log(jsonMode ? JSON.stringify({ selectedIDE: id }) : `Selected IDE: ${registry.get(id).name}`); return; }
    if (action === "select") { const choices = available.map((adapter, index) => `${index + 1}. ${adapter.name}`).join("\n"), terminal = createInterface({ input, output }); try { const answer = await terminal.question(`🧩 IDE Integration\n${choices}\nSelect IDE: `), selected = available[Number(answer) - 1] ?? available.find((adapter) => adapter.id === answer.trim()); if (!selected) throw new Error(`Unknown IDE selection: ${answer}`); const configuration = await readIDEConfiguration(); await writeIDEConfiguration({ ...configuration, selectedIDE: selected.id }); console.log(`Selected IDE: ${selected.name}`); } finally { terminal.close(); } return; }
    const selection = await resolveIDESelection({ projectRoot: root, detected: detected.filter((item) => item.detection.detected).map((item) => item.adapter.id) }), selected = selection.id ? registry.get(selection.id) : undefined;
    if (action === "capabilities") { const value = selected ? { id: selected.id, capabilities: selected.capabilities } : { id: undefined, capabilities: {} }; console.log(jsonMode ? JSON.stringify(value, null, 2) : selected ? `${selected.name}\n${Object.entries(selected.capabilities).map(([key, value]) => `  ${value ? "✓" : "○"} ${key}${value === "limited" ? " (limited)" : ""}`).join("\n")}` : "No IDE selected or detected."); return; }
    if (action === "config") { const value = await readIDEConfiguration(); console.log(JSON.stringify(value, null, 2)); return; }
    if (action !== "status") throw new Error(`Unknown IDE action: ${action}`);
    const value = { current: selected ? { id: selected.id, name: selected.name, source: selection.source, capabilities: selected.capabilities } : undefined, detected: detected.filter((item) => item.detection.detected).map((item) => ({ id: item.adapter.id, name: item.adapter.name, path: item.detection.path })), available: available.map((item) => ({ id: item.id, name: item.name })) }; if (jsonMode) console.log(JSON.stringify(value, null, 2)); else console.log(`🧩 IDE Integration\nCurrent: ${selected ? `${selected.name} (${selection.source})` : "none"}\nDetected\n${value.detected.map((item) => `  ✓ ${item.name}`).join("\n") || "  none"}\nAvailable integrations\n${value.available.map((item) => `  • ${item.name}`).join("\n")}`); return;
  }
  const project = await discoverProject(root);
  root = project.root;
  if (requestArg === "memory" && positional[1] === "configure") {
    const mode = positional[2] as MemoryStorageMode | undefined; if (!mode || !["local", "hosted", "hybrid"].includes(mode)) throw new Error("Usage: llm-code memory configure <local|hosted|hybrid>"); await writeMemoryConfig({ mode }); console.log(`Project memory mode configured: ${mode}.`); return;
  }
  const memory = await createProjectMemory(project);

  if (requestArg === "doctor") { await printDoctor(memory); return; }
  if (requestArg === "memory" && positional[1] === "status") { const status = await memory.getStatus(); if (jsonMode) console.log(JSON.stringify(status, null, 2)); else console.log(`Project Memory\n──────────────────────────────\nProject\n  ${project.name} (${status.projectId})\nStorage\n  ${status.provider}\nPersistence\n  ${status.capabilities.persistent ? "✓" : "✗"} persistent\n  ${status.capabilities.crossProcess ? "✓" : "✗"} cross-process\nGraph\n${Object.entries(status.statistics.nodes).map(([name, count]) => `  ${name.padEnd(14)} ${count}`).join("\n")}\nLast indexed\n  ${status.lastIndexedAt ?? "never"}\nLast task\n  ${status.lastTaskId ?? "none"}\nSync\n  ${status.sync.status}`); return; }
  if (requestArg === "memory" && positional[1] === "sync") { const state = await memory.sync(); console.log(jsonMode ? JSON.stringify(state) : `Memory sync: ${state.status} (${state.pendingChanges} pending, ${state.conflicts} conflicts)`); return; }
  if (requestArg === "memory" && positional[1] === "export") { console.log(JSON.stringify(await memory.exportMemory(), null, 2)); return; }
  if (requestArg === "memory" && positional[1] === "import") { const path = positional[2]; if (!path) throw new Error("Usage: llm-code memory import <project-memory.json>"); await memory.importMemory(JSON.parse(await readFile(resolve(invocationCwd, path), "utf8"))); console.log("Project memory imported."); return; }
  if (requestArg === "memory" && positional[1] === "reset") {
    const requestedScopes = (["graph", "history", "tasks", "outcomes", "execution", "routing"] as const).filter((scope) => args.includes(`--${scope}`)); if (requestedScopes.length > 1) throw new Error("Choose only one memory reset scope"); const scope = requestedScopes[0] ?? "all", confirmation = optionValue("confirm"); let accepted = args.includes("--yes") || confirmation === project.name;
    if (!accepted && input.isTTY && output.isTTY) { const terminal = createInterface({ input, output }); try { const answer = await terminal.question(`⚠ Reset ${scope} memory for ${project.name}?\nRepository files will NOT be modified.\nType ${project.name} to continue: `); accepted = answer === project.name; } finally { terminal.close(); } }
    if (!accepted) throw new Error(`MEMORY_RESET_CONFIRMATION_REQUIRED: pass --confirm=${project.name}`); const result = await memory.reset(scope); console.log(jsonMode ? JSON.stringify(result) : `Reset ${scope} memory. Removed ${Object.values(result.removed).reduce((sum, count) => sum + count, 0)} facts. Generation ${result.generation}.`); return;
  }
  const rebuilding = requestArg === "memory" && positional[1] === "rebuild"; if (rebuilding) await memory.prepareRebuild();
  const reconciliation = rebuilding ? { changed: true, indexed: await indexProjectIntoMemory(project.root, project, memory) } : await reconcileProjectMemory(project.root, project, memory);
  if (!jsonMode && reconciliation.changed) console.log(rebuilding ? "Rebuilding repository memory..." : "Reconciling repository memory...");

  const indexed = reconciliation.indexed ?? { files: [], symbols: [], relationships: [] };
  const history = await ingestRepositoryHistory(project.root, memory);
  await memory.persist();
  if (!jsonMode && (reconciliation.changed || history.indexedCommits)) {
    console.log(`✓ ${indexed.files.length} files`);
    console.log(`✓ ${indexed.symbols.length} symbols`);
    console.log(`✓ ${indexed.relationships.length} relationships`);
    console.log(`✓ ${history.indexedCommits} new commits`);
  }
  if (rebuilding) { const stats = await memory.getGraphStatistics(); console.log(jsonMode ? JSON.stringify({ rebuilt: true, ...stats }) : `✓ Rebuilt factual memory as generation ${stats.generation}`); return; }

  if (requestArg === "serve") {
    const portValue = optionValue("port"), port = portValue === undefined ? 0 : Number(portValue); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${portValue}`);
    const runtime = await startRuntimeServer({ root, memory, port }); const connection = { url: runtime.url, token: runtime.token, sessionId: runtime.sessionId, expiresAt: runtime.expiresAt, workspace: runtime.workspace };
    console.log(jsonMode ? JSON.stringify(connection) : `easy-llm-code runtime ready\nURL: ${runtime.url}\nSession: ${runtime.sessionId}\nExpires: ${runtime.expiresAt}\nToken: ${runtime.token}`);
    await new Promise<void>((resolve) => { runtime.server.once("close", resolve); const stop = () => runtime.server.close(); process.once("SIGINT", stop); process.once("SIGTERM", stop); }); return;
  }

  if (requestArg === "open") {
    const registry = createIDERegistry(), detected = await registry.detect(), explicitIDE = optionValue("ide"), selection = await resolveIDESelection({ ...(explicitIDE ? { explicit: explicitIDE } : {}), projectRoot: root, detected: detected.filter((item) => item.detection.detected).map((item) => item.adapter.id) }); if (!selection.id) throw new Error("No IDE selected. Run: llm-code ide use <ide>"); const adapter = registry.get(selection.id), taskId = optionValue("task"); let requestedPath: string | undefined = positional[1]; if (taskId) { const plan = await memory.findPlanForTask(taskId), proposal = plan ? await memory.findMutationForPlan(plan.id) : undefined; requestedPath = proposal?.files[0]?.path; if (!requestedPath) throw new Error(`Task ${taskId} has no associated file`); } if (!requestedPath) throw new Error("Usage: llm-code open <file> [--ide <ide>] or llm-code open --task <task-id>"); const canonicalRoot = await realpath(root), target = await realpath(resolve(canonicalRoot, requestedPath)); if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`)) throw new Error("IDE_OPEN_PATH_ESCAPE"); await adapter.connect(); try { await adapter.openFile({ path: target }); } finally { await adapter.disconnect(); } return;
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
      approval: async (input) => args.includes("--yes") ? "approved" : input.mode === "auto" ? "approved" : terminalApproval(input),
      routing: { model: modelOption, budget: budgetOption }, autonomy: { mode: autonomyMode, budget: budgetOption === undefined ? undefined : { maxModelSpend: budgetOption } }
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
  if (requestArg === "route") {
    const request = positional.slice(1).join(" "); if (!request) throw new Error("Usage: llm-code route [--budget 0.10] [--model auto|cheap|fast|reasoning|MODEL] \"your request\"");
    const context = await createContextEngine({ memory }).build({ request });
    const profile = await createTaskProfile(request, project, context);
    const decision = await selectModel(memory, { taskId: `route-preview:${Date.now()}`, profile, model: modelOption, budget: budgetOption });
    console.log(jsonMode ? JSON.stringify(decision, null, 2) : explainRoutingDecision(decision)); return;
  }
  if (requestArg === "impact") {
    const request = positional.slice(1).join(" "); if (!request) throw new Error("Usage: llm-code impact \"change request or file path\"");
    const exact = (await memory.listProjectFiles()).filter((file) => request === file.path || request === file.id).map((file) => file.path);
    const context = exact.length ? undefined : await createContextEngine({ memory }).build({ request });
    const targets = exact.length ? exact : context!.files.slice(0, 3).map((file) => file.path);
    const profile = await createTaskProfile(request, project, context ?? await createContextEngine({ memory }).build({ request }));
    const analysis = await createChangeIntelligence({ memory }).analyzeChangeImpact({ files: targets, taskType: profile.taskType, taskId: "impact-preview", persist: true });
    if (jsonMode) console.log(JSON.stringify({ type: "impact", ...analysis }));
    else { console.log("🔍 Change Impact\nTarget"); for (const target of analysis.targets) console.log(`  ${target}`); console.log("Likely affected"); for (const item of analysis.affectedFiles) console.log(`  ${item.confidence >= .75 ? "HIGH" : item.confidence >= .5 ? "MED " : "LOW "}  ${item.path}\n        ${Math.round(item.confidence * 100)}% confidence · ${item.evidenceCount} observations\n        ${item.evidence.map((entry) => entry.description).join("; ")}`); console.log("Likely tests"); for (const item of analysis.affectedTests) console.log(`  ${item.path}`); console.log(`Risk\n  ${analysis.confidence >= .75 ? "HIGH" : analysis.confidence >= .5 ? "MEDIUM" : "LOW"}`); }
    return;
  }
  if (requestArg === "why" && positional[1]) { console.log(await explainTask(memory, positional[1])); return; }
  if (requestArg === "diff") {
    const result = await gitDiffTool.execute({}, { root }); console.log(result.diff || "No working-tree diff."); return;
  }
  if (requestArg === "sandbox") {
    const requested = positional[1] ?? "list", action = requested.startsWith("sandbox:") ? "inspect" : requested, sandboxId = requested.startsWith("sandbox:") ? requested : positional[2], manager = new SandboxManager({ memory, provider: new LocalProcessSandboxProvider() });
    if (action === "list") { const sandboxes = await memory.listSandboxes(); if (jsonMode) console.log(JSON.stringify(sandboxes, null, 2)); else for (const sandbox of sandboxes) console.log(`${sandbox.id}  ${sandbox.status.padEnd(9)}  task ${sandbox.taskId}  ${sandbox.workspace.retained ? "retained" : "released"}`); return; }
    if (!sandboxId) throw new Error(`Usage: llm-code sandbox ${action} SANDBOX_ID`);
    if (action === "inspect") { const inspection = await manager.inspect(sandboxId); console.log(JSON.stringify(inspection, null, 2)); return; }
    if (action === "diff") { console.log(await manager.diff(sandboxId) || "No sandbox diff."); return; }
    if (action === "events") { const filter = optionValue("type"), events = (await memory.getSandboxEvents(sandboxId)).filter((event) => !filter || event.type.includes(filter)); if (jsonMode) console.log(JSON.stringify(events, null, 2)); else for (const event of events) console.log(`${event.timestamp}  ${event.type}`); return; }
    throw new Error(`Unknown sandbox action: ${action}`);
  }
  if (requestArg === "verify") {
    const taskId = `manual-verification-${Date.now()}`, manager = new SandboxManager({ memory, provider: new LocalProcessSandboxProvider() }); let sandbox = await manager.create({ taskId, projectId: project.id, repositoryPath: root }); sandbox = await manager.prepare(sandbox.id, { languages: project.detectedLanguages }); sandbox = await manager.start(sandbox.id); const workspace = await manager.workspacePath(sandbox.id), verificationProject = { ...project, root: workspace };
    const commands = await detectVerificationCommands(verificationProject);
    const run = await runVerification(verificationProject, taskId, "manual", commands, undefined, { execute: async (command) => { const result = await manager.execute(sandbox.id, { executable: command.executable, args: command.args, timeoutMs: command.timeoutMs }); return { stepId: "", command: command.command, status: result.status === "completed" ? "passed" : result.status === "timed_out" ? "timed_out" : result.status === "blocked" ? "denied" : "failed", exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, classification: result.failureReason }; } });
    await manager.finalize(sandbox.id, run.passed);
    if (jsonMode) console.log(JSON.stringify(run, null, 2)); else { console.log("Verification"); for (const result of run.results) console.log(`${result.status === "passed" ? "✓" : "✗"} ${result.command}`); if (!run.results.length) console.log("No trusted verification scripts detected."); }
    if (!run.passed) process.exitCode = 1; return;
  }
  if (requestArg === "task" && positional[1]) {
    const [task, outcome, plan, models, transactions, verifications, events, execution, decisions, assumptions, reviews, routes, sandbox] = await Promise.all([memory.getTask(positional[1]), memory.getTaskOutcome(positional[1]), memory.findPlanForTask(positional[1]), memory.getModelExecutions(positional[1]), memory.getMutationTransactions(positional[1]), memory.getVerificationRuns(positional[1]), memory.getTaskEvents(positional[1]), memory.getAutonomousExecution(positional[1]), memory.getExecutionDecisions(positional[1]), memory.getAssumptionChecks(positional[1]), memory.getReviewResults(positional[1]), memory.getRoutingDecisions(positional[1]), memory.findSandboxForTask(positional[1])]);
    const value = { task, outcome, plan, models, transactions, verifications, events, execution, decisions, assumptions, reviews, routes, sandbox }; if (jsonMode) console.log(JSON.stringify(value, null, 2));
    else if (!task) console.log(`Task ${positional[1]} not found.`); else { const model = models.at(-1), sandboxInspection = sandbox ? await new SandboxManager({ memory, provider: new LocalProcessSandboxProvider() }).inspect(sandbox.id) : undefined; console.log(`Task: ${task.task.request}\nStatus: ${(outcome?.status ?? task.task.status).toUpperCase()}\nModel\n  ${model?.provider ?? "unknown"}/${model?.model ?? "unknown"}${model?.estimatedCost !== undefined ? `\n  $${model.estimatedCost.toFixed(4)}` : ""}\nPlan\n  ${plan?.steps.length ?? 0} steps\nMutation\n  ${outcome?.filesChanged ?? 0} files\n  ${outcome?.linesChanged ?? 0} changed lines\n  ${transactions.at(-1)?.status ?? "none"}\nVerification\n  ${outcome?.verificationPassed ? "✓ passed" : "not passed"}\n  ${verifications.flatMap((run) => run.results).length} command(s)\nSandbox\n  ${sandbox?.id ?? "none"}\n  ${sandbox ? `${sandbox.provider} / ${sandbox.status}` : "not used"}\n  ${sandboxInspection?.commands.length ?? 0} commands, ${sandboxInspection?.filesystemChanges.length ?? 0} filesystem changes, ${sandboxInspection?.network.length ?? 0} network decisions\n  ${sandbox ? `${sandbox.resourceUsage.durationMs}ms, ${sandbox.resourceUsage.peakMemoryBytes} peak bytes` : ""}\nAttempts\n  ${outcome?.attempts ?? 0}\nDuration\n  ${outcome?.durationMs ?? 0}ms`); }
    if (!jsonMode && events.length) { console.log("Timeline:"); for (const event of events) console.log(`  ${event.timestamp.slice(11, 19)} ${event.event.type}`); }
    if (!jsonMode && args.includes("--decisions")) { console.log("Execution decisions"); for (const decision of decisions) console.log(`  ${decision.iteration}. ${decision.action.toUpperCase()} — ${decision.reason}`); }
    if (!jsonMode && args.includes("--assumptions")) { console.log("Assumptions"); for (const check of assumptions) console.log(`  ${check.assumption.id} ${check.assumption.status.toUpperCase()} — ${check.assumption.statement}`); }
    if (!jsonMode && args.includes("--budget")) { console.log("Autonomous budget"); console.log(JSON.stringify({ limits: execution?.budget, usage: execution?.usage }, null, 2)); }
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
