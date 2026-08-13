import { createFeltDB, type EmbeddedOperation } from "@feltdb/core";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { coChangePairs, revertedSha } from "../history/changes.js";
import type { CommitRecord, FileChangeRecord, HistoryCursor } from "../history/history-types.js";
import type { ProjectMemory } from "./project-memory.js";
import type { AgentTask, ChangeRecord, ContextBundle, ContextFile, ContextQuery, ContextSymbol,
  Observation, Project, ProjectChangeEvent, ProjectEdge, ProjectFile, ProjectSymbol, RiskSignal } from "./types.js";
import type { AgentPlan, Evidence, ModelExecution, PlanStep, ToolRun } from "../planning/types.js";
import type { FilePatch, MutationProposal, MutationTransaction, RepairAttempt, TaskOutcome } from "../mutation/types.js";
import type { VerificationRun } from "../verification/types.js";
import type { TaskCheckpoint } from "../task/checkpoint.js";
import type { PersistedAgentEvent } from "../task/events.js";
import type { OutcomeSignal, ContextOutcome } from "../intelligence/outcome-model.js";
import type { RoutingDecision, RoutingFallback } from "../routing/decision.js";
import type { SuccessfulPattern } from "./successful-patterns.js";
import type { FailurePattern } from "./failure-patterns.js";
import type { ActualChange, ChangePattern, ImpactPrediction, PredictionOutcome } from "../change-intelligence/types.js";
import type { AssumptionCheck, AutonomousExecution, ExecutionDecision, ExecutionPattern, ReviewResult } from "../autonomy/types.js";
import type { EnvironmentFingerprint, ExecutionResult, FilesystemChange, NetworkObservation, ProcessObservation, ResourceUsage, Sandbox, SandboxEvent, SandboxSnapshot } from "../sandbox/core/sandbox-types.js";
import type { MemoryExport, MemoryFactProvenance, MemoryResetScope, SyncState } from "./types.js";

interface StoredObservation extends Observation { id: string; projectId: string }
interface StoredChange extends FileChangeRecord { projectId: string }
interface StoredCommit extends CommitRecord { projectId: string; revertedBy?: string }
interface CoChange { id: string; projectId: string; from: string; to: string; count: number }
export interface MemoryOptions { root: string; namespace?: string; server?: { url: string; token: string }; hybrid?: { url: string; token: string }; ephemeral?: boolean; storagePath?: string }

const tokenize = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9_./-]+/).filter(Boolean);
const lexical = (text: string, query: string, tokens: string[]): number => {
  const lower = text.toLowerCase(); let score = lower.includes(query) ? 4 : 0;
  for (const token of tokens) if (lower.includes(token) || (token.length >= 4 && lower.includes(token.slice(0, 4)))) score++;
  return score;
};
const recency = (timestamp: string): number => Math.max(0, 1 - (Date.now() - Date.parse(timestamp)) / (365 * 86400000));
const pathOf = (idOrPath: string): string => idOrPath.startsWith("file:") ? idOrPath.slice(5) : idOrPath;
export const CONTEXT_RANKING_WEIGHTS = {
  lexicalRelevance: 0.30,
  graphDistance: 0.25,
  recency: 0.15,
  coChange: 0.15,
  taskHistory: 0.15
} as const;
const MEMORY_SCHEMA_VERSION = 2;
interface LocalMemoryJournal { version: number; namespace: string; generation: number; operations: EmbeddedOperation[]; lastSyncAt?: string; remoteGeneration?: number }
const wait = (milliseconds: number): Promise<void> => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const operationKey = (operation: EmbeddedOperation): string => operation.id;
const redactSensitiveText = (value: string): string => value
  .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
  .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
const safeExportValue = (value: unknown, key = ""): unknown => {
  if (/token|secret|password|authorization|api[_-]?key/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => safeExportValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, safeExportValue(entryValue, entryKey)]));
  return value;
};

export const createFeltDBProjectMemory = (options: MemoryOptions): ProjectMemory => {
  if ([Boolean(options.server), Boolean(options.hybrid), Boolean(options.ephemeral)].filter(Boolean).length > 1) throw new Error("MEMORY_MODE_CONFLICT: server, hybrid, and ephemeral are mutually exclusive");
  const namespace = options.namespace ?? `code-agent:${resolve(options.root)}`, localDurable = !options.server && !options.ephemeral;
  const db = options.server
    ? createFeltDB({ namespace, server: options.server })
    : createFeltDB({ namespace, memory: true });
  const remoteDb = options.hybrid ? createFeltDB({ namespace, server: options.hybrid }) : undefined;
  const requestedStoragePath = options.storagePath ?? join(homedir(), ".easy-llm", "projects", createHash("sha256").update(namespace).digest("hex").slice(0, 24), "memory", "project.json"), storagePath = process.platform === "win32" ? join(dirname(requestedStoragePath), basename(requestedStoragePath).replace(/[<>:"|?*]/g, "_")) : requestedStoragePath;
  const projects = db.collection<Project & { id: string }>("projects");
  const files = db.collection<ProjectFile & { projectId: string }>("files");
  const symbols = db.collection<ProjectSymbol & { projectId: string }>("symbols");
  const edges = db.collection<ProjectEdge & { projectId: string }>("edges");
  const observations = db.collection<StoredObservation>("observations");
  const tasks = db.collection<AgentTask & { projectId: string }>("tasks");
  const commits = db.collection<StoredCommit>("commits");
  const changes = db.collection<StoredChange>("changes");
  const cursors = db.collection<HistoryCursor & { id: string }>("history-cursors");
  const cochanges = db.collection<CoChange>("cochanges");
  const plans = db.collection<AgentPlan & { projectId: string }>("plans");
  const planSteps = db.collection<PlanStep & { projectId: string; planId: string }>("plan_steps");
  const toolRuns = db.collection<ToolRun & { projectId: string }>("tool_runs");
  const evidenceRecords = db.collection<Evidence & { projectId: string; planId: string; stepId?: string }>("evidence");
  const modelExecutions = db.collection<ModelExecution & { projectId: string }>("model_executions");
  const mutationProposals = db.collection<MutationProposal & { projectId: string }>("mutation_proposals");
  const filePatches = db.collection<FilePatch & { id: string; projectId: string; proposalId: string }>("file_patches");
  const mutationTransactions = db.collection<MutationTransaction & { projectId: string }>("mutation_transactions");
  const verificationRuns = db.collection<VerificationRun & { projectId: string }>("verification_runs");
  const repairAttempts = db.collection<RepairAttempt & { projectId: string }>("repair_attempts");
  const taskOutcomes = db.collection<TaskOutcome & { id: string; taskId: string; projectId: string }>("task_outcomes");
  const taskCheckpoints = db.collection<TaskCheckpoint & { id: string; projectId: string }>("task_checkpoints");
  const taskEvents = db.collection<PersistedAgentEvent & { projectId: string }>("task_events");
  const outcomeSignals = db.collection<OutcomeSignal & { id: string; projectId: string }>("outcome_signals");
  const contextOutcomes = db.collection<ContextOutcome & { id: string; projectId: string }>("context_outcomes");
  const successfulPatterns = db.collection<SuccessfulPattern & { projectId: string }>("successful_patterns");
  const failurePatterns = db.collection<FailurePattern & { projectId: string }>("failure_patterns");
  const routingDecisions = db.collection<RoutingDecision & { projectId: string }>("routing_decisions");
  const routingFallbacks = db.collection<RoutingFallback & { projectId: string }>("routing_fallbacks");
  const impactPredictions = db.collection<ImpactPrediction & { projectId: string }>("impact_predictions");
  const actualChanges = db.collection<ActualChange & { projectId: string }>("actual_changes");
  const predictionOutcomes = db.collection<PredictionOutcome & { projectId: string }>("prediction_outcomes");
  const changePatterns = db.collection<ChangePattern & { projectId: string }>("change_patterns");
  const autonomousExecutions = db.collection<AutonomousExecution & { projectId: string }>("autonomous_executions");
  const executionDecisions = db.collection<ExecutionDecision & { projectId: string }>("execution_decisions");
  const assumptionChecks = db.collection<AssumptionCheck & { projectId: string }>("assumption_checks");
  const reviewResults = db.collection<ReviewResult & { projectId: string }>("review_results");
  const executionPatterns = db.collection<ExecutionPattern & { projectId: string }>("execution_patterns");
  const sandboxes = db.collection<Sandbox & { projectId: string }>("sandboxes");
  const sandboxFingerprints = db.collection<EnvironmentFingerprint & { id: string; sandboxId: string; projectId: string }>("sandbox_fingerprints");
  const sandboxCommands = db.collection<ExecutionResult & { projectId: string }>("sandbox_commands");
  const processObservations = db.collection<ProcessObservation & { projectId: string }>("process_observations");
  const filesystemChanges = db.collection<FilesystemChange & { projectId: string }>("filesystem_changes");
  const networkObservations = db.collection<NetworkObservation & { projectId: string }>("network_observations");
  const sandboxResources = db.collection<ResourceUsage & { id: string; sandboxId: string; projectId: string }>("sandbox_resources");
  const sandboxSnapshots = db.collection<SandboxSnapshot & { projectId: string }>("sandbox_snapshots");
  const sandboxEvents = db.collection<SandboxEvent & { projectId: string }>("sandbox_events");
  const factProvenance = db.collection<MemoryFactProvenance>("fact_provenance");
  const memoryMetadata = db.collection<{ id: string; projectId: string; generation: number; reason: string; updatedAt: string }>("memory_metadata");
  const namedCollections = new Map<any, string>([[projects, "projects"], [files, "files"], [symbols, "symbols"], [edges, "edges"], [observations, "observations"], [tasks, "tasks"], [commits, "commits"], [changes, "changes"], [cursors, "history-cursors"], [cochanges, "cochanges"], [plans, "plans"], [planSteps, "plan_steps"], [toolRuns, "tool_runs"], [evidenceRecords, "evidence"], [modelExecutions, "model_executions"], [mutationProposals, "mutation_proposals"], [filePatches, "file_patches"], [mutationTransactions, "mutation_transactions"], [verificationRuns, "verification_runs"], [repairAttempts, "repair_attempts"], [taskOutcomes, "task_outcomes"], [taskCheckpoints, "task_checkpoints"], [taskEvents, "task_events"], [outcomeSignals, "outcome_signals"], [contextOutcomes, "context_outcomes"], [successfulPatterns, "successful_patterns"], [failurePatterns, "failure_patterns"], [routingDecisions, "routing_decisions"], [routingFallbacks, "routing_fallbacks"], [impactPredictions, "impact_predictions"], [actualChanges, "actual_changes"], [predictionOutcomes, "prediction_outcomes"], [changePatterns, "change_patterns"], [autonomousExecutions, "autonomous_executions"], [executionDecisions, "execution_decisions"], [assumptionChecks, "assumption_checks"], [reviewResults, "review_results"], [executionPatterns, "execution_patterns"], [sandboxes, "sandboxes"], [sandboxFingerprints, "sandbox_fingerprints"], [sandboxCommands, "sandbox_commands"], [processObservations, "process_observations"], [filesystemChanges, "filesystem_changes"], [networkObservations, "network_observations"], [sandboxResources, "sandbox_resources"], [sandboxSnapshots, "sandbox_snapshots"], [sandboxEvents, "sandbox_events"], [factProvenance, "fact_provenance"], [memoryMetadata, "memory_metadata"]]);
  let currentProjectId: string | undefined;
  let generation = 1, loaded = false, flushing = Promise.resolve(), lastSyncAt: string | undefined, remoteGeneration = 0, batchDepth = 0, batchDirty = false;
  const listeners = new Set<(event: ProjectChangeEvent) => void>();

  const readJournal = async (): Promise<LocalMemoryJournal | undefined> => { try { const value = JSON.parse(await readFile(storagePath, "utf8")) as LocalMemoryJournal; if (value.namespace !== namespace) throw new Error("MEMORY_NAMESPACE_MISMATCH"); if (!Array.isArray(value.operations)) throw new Error("MEMORY_JOURNAL_INVALID"); return value; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } };
  const withLock = async <T>(action: () => Promise<T>): Promise<T> => { const lockPath = `${storagePath}.lock`; await mkdir(dirname(storagePath), { recursive: true, mode: 0o700 }); for (let attempt = 0; attempt < 250; attempt++) { try { const handle = await open(lockPath, "wx", 0o600); try { return await action(); } finally { await handle.close(); await unlink(lockPath).catch(() => undefined); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; try { if (Date.now() - (await stat(lockPath)).mtimeMs > 30_000) await unlink(lockPath); } catch {} await wait(20); } } throw new Error("MEMORY_LOCK_TIMEOUT"); };
  const replaceJournal = async (temporary: string): Promise<void> => { if (process.platform !== "win32") { await rename(temporary, storagePath); return; } const backup = `${storagePath}.${randomUUID()}.bak`; let moved = false; try { await rename(storagePath, backup); moved = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } try { await rename(temporary, storagePath); if (moved) await unlink(backup).catch(() => undefined); } catch (error) { if (moved) await rename(backup, storagePath).catch(() => undefined); throw error; } };
  const flush = async (): Promise<void> => { if (!localDurable || !loaded) return; if (batchDepth > 0) { batchDirty = true; return; } const write = async () => withLock(async () => { const stored = await readJournal(); if (stored?.operations.length) await db.applyOperations(stored.operations); const exported = await db.exportOperations(), merged = new Map<string, EmbeddedOperation>(); for (const operation of [...(stored?.operations ?? []), ...exported]) merged.set(operationKey(operation), operation); generation = Math.max(generation, stored?.generation ?? 0) + 1; lastSyncAt = lastSyncAt ?? stored?.lastSyncAt; remoteGeneration = Math.max(remoteGeneration, stored?.remoteGeneration ?? 0); const journal: LocalMemoryJournal = { version: MEMORY_SCHEMA_VERSION, namespace, generation, operations: [...merged.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)), ...(lastSyncAt ? { lastSyncAt } : {}), remoteGeneration }; const temporary = `${storagePath}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(journal)}\n`, { mode: 0o600 }); await chmod(temporary, 0o600); await replaceJournal(temporary); }); flushing = flushing.then(write, write); await flushing; };
  const load = async (): Promise<void> => { if (loaded) return; if (localDurable) { const stored = await readJournal(); if (stored) { generation = stored.generation ?? 1; remoteGeneration = stored.remoteGeneration ?? 0; lastSyncAt = stored.lastSyncAt; if (stored.operations.length) await db.applyOperations(stored.operations); } } loaded = true; };
  const provenanceFor = async (collection: string, item: Record<string, any>): Promise<void> => { if (!currentProjectId || collection === "fact_provenance") return; const factId = String(item.id), id = `provenance:${collection}:${factId}`, derived = collection.includes("pattern") || collection.includes("prediction") || collection.includes("routing") || item.relation === "CO_CHANGED" || String(item.relation ?? "").startsWith("LIKELY_"), record: MemoryFactProvenance = { id, factId, collection, projectId: currentProjectId, source: typeof item.source === "string" ? item.source : item.commitId ? "git" : "runtime", observedAt: item.lastObservedAt ?? item.timestamp ?? item.createdAt ?? new Date().toISOString(), confidence: typeof item.confidence === "number" ? item.confidence : 1, generation, evidence: [item.commitId, ...(Array.isArray(item.evidence) ? item.evidence.map((value: any) => typeof value === "string" ? value : value?.id ?? value?.description).filter(Boolean) : [])].filter(Boolean), classification: derived ? "DERIVED" : "FACTUAL", ...(item.taskId ? { taskId: String(item.taskId) } : {}), ...(item.commitId ? { commitId: String(item.commitId) } : {}), ...(item.sandboxId ? { sandboxId: String(item.sandboxId) } : {}) }; const found = await factProvenance.find({ id }); if (found.length) await factProvenance.update(id, record); else await factProvenance.insert(record, id); };

  const upsert = async <T extends { id: string }>(collection: any, item: T, collectionName = namedCollections.get(collection) ?? "fact"): Promise<void> => {
    const found = await collection.find({ id: item.id });
    if (found.length) await collection.update(item.id, item); else await collection.insert(item, item.id);
    await provenanceFor(collectionName, item); await flush();
  };
  const projectId = (): string => { if (!currentProjectId) throw new Error("Project memory not initialized"); return currentProjectId; };
  const emit = (type: string, ids: string[]): void => {
    const event = { type, ids, timestamp: new Date().toISOString() };
    for (const listener of listeners) listener(event);
  };
  const all = async () => {
    const id = projectId();
    return Promise.all([files.find({ projectId: id }), symbols.find({ projectId: id }), edges.find({ projectId: id }),
      commits.find({ projectId: id }), changes.find({ projectId: id }), observations.find({ projectId: id }), cochanges.find({ projectId: id })]);
  };
  const assemble = async (selected: StoredCommit[]): Promise<ChangeRecord[]> => {
    const projectChanges = await changes.find({ projectId: projectId() });
    return selected.map((commit) => ({ commit, files: projectChanges.filter((change) => change.commitId === commit.id), revertedBy: commit.revertedBy }));
  };
  const clearCollection = async (collection: any, query: Record<string, unknown> = { projectId: projectId() }): Promise<number> => { const records = await collection.find(query); for (const record of records) await collection.delete(record.id); return records.length; };
  const resetGroups: Record<Exclude<MemoryResetScope, "all">, any[]> = {
    graph: [files, symbols], history: [commits, changes, cursors, cochanges],
    tasks: [tasks, taskCheckpoints, taskEvents, observations, plans, planSteps, toolRuns, evidenceRecords, mutationProposals, filePatches, mutationTransactions, verificationRuns, repairAttempts, autonomousExecutions, executionDecisions, assumptionChecks, reviewResults],
    outcomes: [taskOutcomes, outcomeSignals, contextOutcomes, successfulPatterns, failurePatterns, impactPredictions, actualChanges, predictionOutcomes, changePatterns, executionPatterns],
    routing: [routingDecisions, routingFallbacks],
    execution: [sandboxes, sandboxFingerprints, sandboxCommands, processObservations, filesystemChanges, networkObservations, sandboxResources, sandboxSnapshots, sandboxEvents]
  };

  return {
    async initialize(project) { await load(); currentProjectId = project.id; const metadata = (await memoryMetadata.find({ id: `generation:${project.id}` }))[0]; generation = Math.max(generation, metadata?.generation ?? 1); await upsert(projects, project); },
    async getProject() { const found = await projects.find({ id: projectId() }); if (!found[0]) throw new Error("Project not found"); return found[0]; },
    async upsertFile(file) { await upsert(files, { ...file, projectId: projectId() }); emit("file", [file.id]); },
    async upsertSymbol(symbol) { await upsert(symbols, { ...symbol, projectId: projectId() }); emit("symbol", [symbol.id]); },
    async listProjectFiles() { return files.find({ projectId: projectId() }); },
    async listProjectSymbols() { return symbols.find({ projectId: projectId() }); },
    async listRelationships() { return edges.find({ projectId: projectId() }); },
    async listObservations() { return observations.find({ projectId: projectId() }); },
    async addRelationship(edge) { await upsert(edges, { ...edge, projectId: projectId() }); emit("relationship", [edge.id]); },
    async recordObservation(observation) {
      const id = observation.id ?? `${observation.type}:${observation.taskId}:${observation.timestamp}`;
      await upsert(observations, { ...observation, id, projectId: projectId() });
      await this.addRelationship({ id: `edge:task-produced:${observation.taskId}:${id}`, from: `task:${observation.taskId}`,
        to: `observation:${id}`, relation: "PRODUCED", confidence: 1, source: "agent" });
      for (const file of observation.relatedFiles ?? []) await this.addRelationship({ id: `edge:observation-file:${id}:${file}`,
        from: `observation:${id}`, to: file, relation: "OBSERVED", confidence: 1, source: "agent" });
      emit("observation", [id]);
    },
    async upsertTask(task) { await upsert(tasks, { ...task, projectId: projectId() }); emit("task", [task.id]); },
    async getTask(taskId) {
      const found = await tasks.find({ id: taskId, projectId: projectId() }); if (!found[0]) return undefined;
      return { task: found[0], observations: await observations.find({ taskId, projectId: projectId() }) };
    },
    async listTasks(limit = 20) { return (await tasks.find({ projectId: projectId() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); },
    async persistTaskCheckpoint(checkpoint) { await upsert(taskCheckpoints, { ...checkpoint, id: checkpoint.taskId, projectId: projectId() }); emit("task_checkpoint", [checkpoint.taskId]); },
    async getTaskCheckpoint(taskId) { return (await taskCheckpoints.find({ id: taskId, projectId: projectId() }))[0]; },
    async recordTaskEvent(event) { await upsert(taskEvents, { ...event, projectId: projectId() }); emit("task_event", [event.id]); },
    async getTaskEvents(taskId) { return (await taskEvents.find({ taskId, projectId: projectId() })).sort((a, b) => a.sequence - b.sequence); },
    async ingestCommit(commit, commitChanges) {
      const id = projectId();
      await upsert(commits, { ...commit, projectId: id });
      for (const change of commitChanges) {
        await upsert(changes, { ...change, projectId: id });
        await upsert(edges, { id: `edge:changed:${commit.id}:${change.fileId}`, projectId: id, from: commit.id, to: change.fileId,
          relation: "CHANGED", confidence: 1, source: "git", commitId: commit.id, validFrom: commit.sha });
        await upsert(edges, { id: `edge:changed-in:${commit.id}:${change.fileId}`, projectId: id, from: change.fileId, to: commit.id,
          relation: "CHANGED_IN", confidence: 1, source: "git", commitId: commit.id, validFrom: commit.sha });
      }
      for (const parent of commit.parentShas) await upsert(edges, { id: `edge:parent:${parent}:${commit.sha}`, projectId: id,
        from: `commit:${parent}`, to: commit.id, relation: "PARENT_OF", confidence: 1, source: "git", commitId: commit.id });
      for (const [from, to] of coChangePairs(commitChanges)) {
        const pairId = `cochange:${from}:${to}`; const found = await cochanges.find({ id: pairId }); const count = (found[0]?.count ?? 0) + 1;
        await upsert(cochanges, { id: pairId, projectId: id, from, to, count });
        await upsert(edges, { id: `edge:${pairId}`, projectId: id, from, to, relation: "CO_CHANGED",
          confidence: Math.min(0.99, count / (count + 2)), source: "git", commitId: commit.id });
        await upsert(edges, { id: `edge:co-changed-with:${from}:${to}`, projectId: id, from, to, relation: "CO_CHANGED_WITH",
          confidence: Math.min(0.99, count / (count + 2)), source: "git", commitId: commit.id });
      }
      const reverted = revertedSha(commit.message);
      if (reverted) {
        const originals = await commits.find({ sha: reverted, projectId: id });
        if (originals[0]) {
          await commits.update(originals[0].id, { revertedBy: commit.id }); await provenanceFor("commits", { ...originals[0], revertedBy: commit.id }); await flush();
          await upsert(edges, { id: `edge:revert:${originals[0].id}:${commit.id}`, projectId: id, from: originals[0].id,
            to: commit.id, relation: "REVERTED_BY", confidence: 1, source: "git", commitId: commit.id });
        }
      }
      emit("commit", [commit.id, ...commitChanges.map((change) => change.fileId)]);
    },
    async getHistoryCursor() { return (await cursors.find({ id: projectId() }))[0]; },
    async setHistoryCursor(cursor) { await upsert(cursors, { ...cursor, id: cursor.repositoryId }); },
    async getFileHistory(fileId, opts = {}) {
      const [projectFiles, projectCommits, projectChanges] = await Promise.all([files.find({ projectId: projectId() }), commits.find({ projectId: projectId() }), changes.find({ projectId: projectId() })]);
      const path = pathOf(fileId); const file = projectFiles.find((item) => item.id === fileId || item.path === path) ?? { id: `file:${path}`, path, size: 0 };
      const ids = new Set(projectChanges.filter((change) => change.fileId === file.id || change.oldPath === path || change.newPath === path).map((change) => change.commitId));
      let matching = projectCommits.filter((commit) => ids.has(commit.id) && (!opts.before || commit.timestamp < opts.before)).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const totalCommits = matching.length; matching = matching.slice(0, opts.limit ?? 20);
      return { file, changes: await assemble(matching), totalCommits };
    },
    async getRelatedChanges(query) {
      const projectCommits = await commits.find({ projectId: projectId() }); const tokens = tokenize(query.text ?? "");
      const projectChanges = await changes.find({ projectId: projectId() });
      const selected = projectCommits.map((commit) => {
        const linked = projectChanges.filter((change) => change.commitId === commit.id);
        const fileMatch = !query.fileIds?.length || linked.some((change) => query.fileIds!.some((id) => change.fileId === id || pathOf(change.fileId) === pathOf(id)));
        const commitMatch = !query.commitIds?.length || query.commitIds.includes(commit.id) || query.commitIds.includes(commit.sha);
        return { commit, score: lexical(`${commit.message} ${linked.map((c) => pathOf(c.fileId)).join(" ")}`, (query.text ?? "").toLowerCase(), tokens) + recency(commit.timestamp), fileMatch, commitMatch };
      }).filter((item) => item.fileMatch && item.commitMatch && (!query.text || item.score > 0)).sort((a, b) => b.score - a.score).slice(0, query.limit ?? 12);
      const records = await assemble(selected.map((item) => item.commit));
      return records.map((record, index) => ({ ...record, score: selected[index].score, reason: "message, changed-file, and recency match" }));
    },
    async getRecentChanges(opts = {}) {
      const selected = (await commits.find({ projectId: projectId() })).filter((c) => !opts.since || c.timestamp >= opts.since).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, opts.limit ?? 10);
      return assemble(selected);
    },
    async getChangeImpact(inputFiles) {
      const [projectFiles, , projectEdges, , , , pairs] = await all();
      const selected = new Set(inputFiles.map((value) => projectFiles.find((f) => f.path === pathOf(value))?.id ?? value));
      const dependents = new Set<string>(), tests = new Set<string>(), co = new Map<string, number>();
      for (const edge of projectEdges) {
        if (selected.has(edge.to) && ["IMPORTS", "DEPENDS_ON"].includes(edge.relation)) dependents.add(pathOf(edge.from));
        if (selected.has(edge.to) && edge.relation === "TESTS") tests.add(pathOf(edge.from));
      }
      for (const pair of pairs) if (selected.has(pair.from)) co.set(pair.to, pair.count); else if (selected.has(pair.to)) co.set(pair.from, pair.count);
      const riskSignals: RiskSignal[] = [...co.entries()].filter(([, count]) => count >= 2).map(([file, count]) => ({ level: count >= 5 ? "high" : "medium", reason: `changed together in ${count} historical commits`, files: [pathOf(file)] }));
      return { directlyAffected: [...selected].map(pathOf), dependents: [...dependents], tests: [...tests], recentlyChangedTogether: [...co.entries()].sort((a,b) => b[1]-a[1]).map(([id]) => pathOf(id)), riskSignals };
    },
    async getSummary() {
      const [projectFiles, projectSymbols, projectEdges, projectCommits, , projectObservations, pairs] = await all();
      return { files: projectFiles.length, symbols: projectSymbols.length, relationships: projectEdges.length, commits: projectCommits.length,
        tasks: (await tasks.find({ projectId: projectId() })).length, observations: projectObservations.length,
        frequentCoChanges: pairs.filter((pair) => pair.count >= 2).length, revertedChanges: projectCommits.filter((c) => c.revertedBy).length,
        recentChanges: await this.getRecentChanges({ limit: 5 }) };
    },
    async getCapabilities() {
      const runtime = db.runtime();
      const persistent = Boolean(options.server) || localDurable;
      return { persistent, crossProcess: persistent, reactive: runtime.reactive, temporal: true, graph: true, outcomes: true, execution: true, sync: Boolean(options.server || options.hybrid), storage: options.server ? "feltdb-remote" : options.hybrid ? "feltdb-hybrid" : localDurable ? "feltdb-local-journal" : "memory" };
    },
    async persist() { await flush(); },
    async batch<T>(action: () => Promise<T>) { batchDepth++; try { return await action(); } finally { batchDepth--; if (batchDepth === 0 && batchDirty) { batchDirty = false; await flush(); } } },
    async beginGeneration(reason) { generation++; await upsert(memoryMetadata, { id: `generation:${projectId()}`, projectId: projectId(), generation, reason, updatedAt: new Date().toISOString() }); emit("memory_generation", [String(generation)]); return generation; },
    async getGeneration() { return generation; },
    async getFactProvenance(factId) { return (await factProvenance.find({ factId, projectId: projectId() })).sort((a, b) => b.generation - a.generation); },
    async getGraphStatistics() { const [projectFiles, projectSymbols, projectEdges, projectCommits] = await Promise.all([files.find({ projectId: projectId() }), symbols.find({ projectId: projectId() }), edges.find({ projectId: projectId() }), commits.find({ projectId: projectId() })]), relationCounts: Record<string, number> = {}; for (const edge of projectEdges) relationCounts[edge.relation] = (relationCounts[edge.relation] ?? 0) + 1; return { generation, nodes: { files: projectFiles.length, symbols: projectSymbols.length, commits: projectCommits.length, tasks: (await tasks.find({ projectId: projectId() })).length, models: (await modelExecutions.find({ projectId: projectId() })).length, mutations: (await mutationProposals.find({ projectId: projectId() })).length, verifications: (await verificationRuns.find({ projectId: projectId() })).length, repairs: (await repairAttempts.find({ projectId: projectId() })).length, sandboxes: (await sandboxes.find({ projectId: projectId() })).length, patterns: (await successfulPatterns.find({ projectId: projectId() })).length + (await changePatterns.find({ projectId: projectId() })).length, failures: (await failurePatterns.find({ projectId: projectId() })).length }, relationships: relationCounts }; },
    async getStatus() { const [capabilities, statistics, taskList, cursor] = await Promise.all([this.getCapabilities(), this.getGraphStatistics(), this.listTasks(1), this.getHistoryCursor()]); let storageBytes = 0, lastIndexedAt: string | undefined; if (localDurable) try { const details = await stat(storagePath); storageBytes = details.size; if (cursor) lastIndexedAt = details.mtime.toISOString(); } catch {} const sync: SyncState = { projectId: projectId(), localGeneration: generation, remoteGeneration, ...(lastSyncAt ? { lastSyncAt } : {}), pendingChanges: options.hybrid && generation > remoteGeneration ? generation - remoteGeneration : 0, conflicts: 0, status: options.hybrid ? (lastSyncAt && generation <= remoteGeneration ? "synced" : "pending") : options.server ? "synced" : "local-only" }; return { projectId: projectId(), provider: options.server ? "hosted" : options.hybrid ? "hybrid" : options.ephemeral ? "ephemeral" : "local", schemaVersion: MEMORY_SCHEMA_VERSION, generation, storageBytes, integrity: "ok", ...(lastIndexedAt ? { lastIndexedAt } : {}), ...(taskList[0] ? { lastTaskId: taskList[0].id } : {}), sync, capabilities, statistics }; },
    async sync() { if (options.hybrid && remoteDb) { await flush(); const local = await db.exportOperations(); await remoteDb.applyOperations(local); const remote = await remoteDb.exportOperations(); await db.applyOperations(remote); remoteGeneration = generation; lastSyncAt = new Date().toISOString(); await flush(); return { projectId: projectId(), localGeneration: generation, remoteGeneration, lastSyncAt, pendingChanges: 0, conflicts: 0, status: "synced" }; } if (options.server) { lastSyncAt = new Date().toISOString(); remoteGeneration = generation; return { projectId: projectId(), localGeneration: generation, remoteGeneration, lastSyncAt, pendingChanges: 0, conflicts: 0, status: "synced" }; } return { projectId: projectId(), localGeneration: generation, remoteGeneration: 0, pendingChanges: 0, conflicts: 0, status: "local-only" }; },
    async exportMemory() { const operations = (await db.exportOperations()).map((operation) => ({ ...operation, ...(operation.value === undefined ? {} : { value: safeExportValue(operation.value) }) })); const latest = operations.reduce((timestamp, operation) => Math.max(timestamp, operation.timestamp), 0); return { format: "easy-llm-code-project-memory", schemaVersion: MEMORY_SCHEMA_VERSION, projectId: projectId(), namespace, generation, exportedAt: new Date(latest).toISOString(), operations: operations.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)) }; },
    async importMemory(snapshot: MemoryExport) { if (snapshot.format !== "easy-llm-code-project-memory" || snapshot.schemaVersion > MEMORY_SCHEMA_VERSION) throw new Error("MEMORY_EXPORT_UNSUPPORTED"); if (snapshot.projectId !== projectId()) throw new Error("MEMORY_PROJECT_MISMATCH"); await db.applyOperations(snapshot.operations); generation = Math.max(generation, snapshot.generation); await flush(); emit("memory_import", [String(snapshot.operations.length)]); },
    async compact(policy = {}) { const executionLimit = policy.executionEvents ?? 10_000, commandLimit = policy.commandExecutions ?? 10_000, removed: Record<string, number> = { sandbox_events: 0, sandbox_commands: 0 }; const events = (await sandboxEvents.find({ projectId: projectId() })).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)); for (const event of events.slice(executionLimit)) { await sandboxEvents.delete(event.id); removed.sandbox_events++; } const commands = await sandboxCommands.find({ projectId: projectId() }), failures = commands.filter((command) => command.status !== "completed" || (command.exitCode ?? 0) !== 0), successful = commands.filter((command) => command.status === "completed" && (command.exitCode ?? 0) === 0).sort((a, b) => b.id.localeCompare(a.id)); for (const command of successful.slice(commandLimit)) { await sandboxCommands.delete(command.id); removed.sandbox_commands++; } if (removed.sandbox_events || removed.sandbox_commands) await flush(); return { removed, preservedFailures: failures.length, generation }; },
    async reset(scope = "all") {
      const removed: Record<string, number> = {}, selected = scope === "all" ? [...new Set(Object.values(resetGroups).flat())] : resetGroups[scope], removedEdgeIds = new Set<string>();
      const clearedNames = new Set(selected.map((collection) => namedCollections.get(collection) ?? "unknown"));
      for (const collection of selected) { const name = namedCollections.get(collection) ?? "unknown"; removed[name] = collection === cursors ? await clearCollection(collection, { id: projectId() }) : await clearCollection(collection); }
      if (scope === "all") { const records = await edges.find({ projectId: projectId() }); records.forEach((edge) => removedEdgeIds.add(edge.id)); removed.edges = await clearCollection(edges); clearedNames.add("edges"); }
      else if (scope === "graph") { const records = (await edges.find({ projectId: projectId() })).filter((edge: ProjectEdge) => edge.source === "filesystem" || edge.source === "ast"); for (const edge of records) { removedEdgeIds.add(edge.id); await edges.delete(edge.id); } removed.edges = records.length; }
      else if (scope === "history") { const records = (await edges.find({ projectId: projectId() })).filter((edge: ProjectEdge) => edge.source === "git"); for (const edge of records) { removedEdgeIds.add(edge.id); await edges.delete(edge.id); } removed.edges = records.length; }
      const provenance = await factProvenance.find({ projectId: projectId() });
      const forgotten = scope === "all" ? provenance : provenance.filter((record) => clearedNames.has(record.collection) || (record.collection === "edges" && removedEdgeIds.has(record.factId)));
      for (const record of forgotten) await factProvenance.delete(record.id); removed.fact_provenance = forgotten.length;
      await this.beginGeneration(`reset:${scope}`); await flush(); emit("memory_reset", [scope]); return { scope, removed, generation };
    },
    async prepareRebuild() {
      const removed: Record<string, number> = {}, factualCollections = [...resetGroups.graph, ...resetGroups.history], factualNames = new Set(factualCollections.map((collection) => namedCollections.get(collection) ?? "unknown"));
      for (const collection of factualCollections) { const name = namedCollections.get(collection) ?? "unknown"; removed[name] = collection === cursors ? await clearCollection(collection, { id: projectId() }) : await clearCollection(collection); }
      const factualEdges = (await edges.find({ projectId: projectId() })).filter((edge: ProjectEdge) => ["filesystem", "ast", "git"].includes(edge.source)); for (const edge of factualEdges) await edges.delete(edge.id); removed.edges = factualEdges.length;
      const factualEdgeIds = new Set(factualEdges.map((edge) => edge.id)), staleProvenance = (await factProvenance.find({ projectId: projectId() })).filter((record) => factualNames.has(record.collection) || (record.collection === "edges" && factualEdgeIds.has(record.factId))); for (const record of staleProvenance) await factProvenance.delete(record.id); removed.fact_provenance = staleProvenance.length;
      generation++; await upsert(memoryMetadata, { id: `generation:${projectId()}`, projectId: projectId(), generation, reason: "rebuild", updatedAt: new Date().toISOString() }); await flush(); emit("memory_rebuild", [String(generation)]); return { scope: "graph", removed, generation };
    },
    async persistPlan(plan) {
      const id = projectId(), priorPlans = await plans.find({ taskId: plan.taskId, projectId: id }); await upsert(plans, { ...plan, projectId: id });
      await upsert(edges, { id: `edge:task-plan:${plan.taskId}:${plan.id}`, projectId: id, from: `task:${plan.taskId}`, to: `plan:${plan.id}`, relation: "HAS_PLAN", confidence: 1, source: "agent" });
      await upsert(edges, { id: `edge:task-produced-plan:${plan.taskId}:${plan.id}`, projectId: id, from: `task:${plan.taskId}`, to: `plan:${plan.id}`, relation: "PRODUCED_PLAN", confidence: 1, source: "agent" });
      const priorPlan = priorPlans.filter((item) => item.id !== plan.id).at(-1); if (priorPlan) await upsert(edges, { id: `edge:replanned:${priorPlan.id}:${plan.id}`, projectId: id, from: `plan:${priorPlan.id}`, to: `plan:${plan.id}`, relation: "REPLANNED", confidence: 1, source: "agent" });
      for (const step of plan.steps) {
        await upsert(planSteps, { ...step, projectId: id, planId: plan.id });
        await upsert(edges, { id: `edge:plan-step:${plan.id}:${step.id}`, projectId: id, from: `plan:${plan.id}`, to: `step:${step.id}`, relation: "PLAN_STEP", confidence: 1, source: "agent" });
        for (const evidenceId of step.evidence) await upsert(edges, { id: `edge:step-evidence:${step.id}:${evidenceId}`, projectId: id, from: `step:${step.id}`, to: `evidence:${evidenceId}`, relation: "SUPPORTED_BY", confidence: 1, source: "agent" });
      }
      emit("plan", [plan.id]);
    },
    async getPlan(planId) { return (await plans.find({ id: planId, projectId: projectId() }))[0]; },
    async findPlanForTask(taskId) { return (await plans.find({ taskId, projectId: projectId() }))[0]; },
    async recordToolRun(run) { await upsert(toolRuns, { ...run, projectId: projectId() }); emit("tool_run", [run.id]); },
    async recordEvidence(evidence, planId, stepId) {
      const id = projectId(); await upsert(evidenceRecords, { ...evidence, projectId: id, planId, stepId });
      if (stepId) await upsert(edges, { id: `edge:step-evidence:${stepId}:${evidence.id}`, projectId: id, from: `step:${stepId}`, to: `evidence:${evidence.id}`, relation: "SUPPORTED_BY", confidence: evidence.confidence, source: "agent" });
      emit("evidence", [evidence.id]);
    },
    async recordModelExecution(execution) { await upsert(modelExecutions, { ...execution, projectId: projectId() }); emit("model_execution", [execution.id]); },
    async getModelExecutions(taskId) { return modelExecutions.find({ taskId, projectId: projectId() }); },
    async persistMutationProposal(proposal) {
      const id = projectId(); await upsert(mutationProposals, { ...proposal, projectId: id });
      await upsert(edges, { id: `edge:plan-mutation:${proposal.planId}:${proposal.id}`, projectId: id, from: `plan:${proposal.planId}`, to: `mutation:${proposal.id}`, relation: "HAS_MUTATION", confidence: 1, source: "agent" });
      for (const [index, patch] of proposal.files.entries()) { const patchId = `${proposal.id}:file:${index}`; await upsert(filePatches, { ...patch, id: patchId, projectId: id, proposalId: proposal.id }); await upsert(edges, { id: `edge:mutation-file:${proposal.id}:${index}`, projectId: id, from: `mutation:${proposal.id}`, to: `file-patch:${patchId}`, relation: "CONTAINS", confidence: 1, source: "agent" }); }
      emit("mutation_proposal", [proposal.id]);
    },
    async getMutationProposal(proposalId) { return (await mutationProposals.find({ id: proposalId, projectId: projectId() }))[0]; },
    async findMutationForPlan(planId) { return (await mutationProposals.find({ planId, projectId: projectId() }))[0]; },
    async listMutationProposals() { return mutationProposals.find({ projectId: projectId() }); },
    async persistMutationTransaction(transaction) { const id = projectId(); await upsert(mutationTransactions, { ...transaction, projectId: id }); await upsert(edges, { id: `edge:mutation-transaction:${transaction.proposalId}:${transaction.id}`, projectId: id, from: `mutation:${transaction.proposalId}`, to: `transaction:${transaction.id}`, relation: "HAS_TRANSACTION", confidence: 1, source: "agent" }); await upsert(edges, { id: `edge:execution-applied:${transaction.taskId}:${transaction.id}`, projectId: id, from: `execution:${transaction.taskId}`, to: `transaction:${transaction.id}`, relation: "APPLIED_MUTATION", confidence: 1, source: "agent" }); for (const patch of transaction.applied) await upsert(edges, { id: `edge:transaction-file:${transaction.id}:${patch.path}`, projectId: id, from: `transaction:${transaction.id}`, to: `file:${patch.path}`, relation: "CHANGED_FILE", confidence: 1, source: "agent" }); emit("mutation_transaction", [transaction.id]); },
    async getMutationTransactions(taskId) { return mutationTransactions.find({ taskId, projectId: projectId() }); },
    async persistVerificationRun(run) { const id = projectId(); await upsert(verificationRuns, { ...run, projectId: id }); await upsert(edges, { id: `edge:mutation-verification:${run.proposalId}:${run.id}`, projectId: id, from: `mutation:${run.proposalId}`, to: `verification:${run.id}`, relation: "VERIFIED_BY", confidence: 1, source: "agent" }); await upsert(edges, { id: `edge:task-triggered-verification:${run.taskId}:${run.id}`, projectId: id, from: `task:${run.taskId}`, to: `verification:${run.id}`, relation: "TRIGGERED_VERIFICATION", confidence: 1, source: "agent" }); await upsert(edges, { id: `edge:execution-verification:${run.taskId}:${run.id}`, projectId: id, from: `execution:${run.taskId}`, to: `verification:${run.id}`, relation: "RAN_VERIFICATION", confidence: 1, source: "agent" }); emit("verification_run", [run.id]); },
    async getVerificationRuns(taskId) { return verificationRuns.find({ taskId, projectId: projectId() }); },
    async persistRepairAttempt(attempt) { const id = projectId(); await upsert(repairAttempts, { ...attempt, projectId: id }); await upsert(edges, { id: `edge:repair:${attempt.id}:${attempt.proposalId}`, projectId: id, from: `repair:${attempt.id}`, to: `mutation:${attempt.proposalId}`, relation: "REPAIR_OF", confidence: 1, source: "agent" }); emit("repair_attempt", [attempt.id]); },
    async persistTaskOutcome(taskId, outcome) { const id = projectId(); await upsert(taskOutcomes, { ...outcome, id: `outcome:${taskId}`, taskId, projectId: id }); await upsert(edges, { id: `edge:task-outcome:${taskId}`, projectId: id, from: `task:${taskId}`, to: `outcome:${taskId}`, relation: "HAS_OUTCOME", confidence: 1, source: "agent" }); emit("task_outcome", [taskId]); },
    async getTaskOutcome(taskId) { return (await taskOutcomes.find({ taskId, projectId: projectId() }))[0]; },
    async persistOutcomeSignal(signal) {
      const id = projectId(), signalId = `outcome-signal:${signal.taskId}:${signal.model}`;
      await upsert(outcomeSignals, { ...signal, id: signalId, projectId: id });
      await upsert(edges, { id: `edge:signal:${signal.taskId}:${signal.model}`, projectId: id, from: `task:${signal.taskId}`, to: signalId, relation: "RESULTED_IN", confidence: 1, source: "agent" });
      emit("outcome_signal", [signalId]);
    },
    async listOutcomeSignals() { return (await outcomeSignals.find({ projectId: projectId() })).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); },
    async persistContextOutcome(outcome) { const id = `context-outcome:${outcome.taskId}:${outcome.strategy}`; await upsert(contextOutcomes, { ...outcome, id, projectId: projectId() }); emit("context_outcome", [id]); },
    async listContextOutcomes(taskId) { const id = projectId(); return taskId ? contextOutcomes.find({ taskId, projectId: id }) : contextOutcomes.find({ projectId: id }); },
    async persistSuccessfulPattern(pattern) { await upsert(successfulPatterns, { ...pattern, projectId: projectId() }); emit("successful_pattern", [pattern.id]); },
    async listSuccessfulPatterns() { return (await successfulPatterns.find({ projectId: projectId() })).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); },
    async persistFailurePattern(pattern) { await upsert(failurePatterns, { ...pattern, projectId: projectId() }); emit("failure_pattern", [pattern.id]); },
    async listFailurePatterns() { return (await failurePatterns.find({ projectId: projectId() })).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); },
    async persistRoutingDecision(decision) {
      const id = projectId(), prior = (await routingDecisions.find({ taskId: decision.taskId, projectId: id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]; await upsert(routingDecisions, { ...decision, projectId: id });
      await upsert(edges, { id: `edge:routing:${decision.taskId}`, projectId: id, from: `task:${decision.taskId}`, to: `model:${decision.selectedModel}`, relation: "ROUTED_TO", confidence: decision.reason.confidence.level === "high" ? 1 : decision.reason.confidence.level === "medium" ? 0.75 : 0.5, source: "agent" }); emit("routing_decision", [decision.id]);
      await upsert(edges, { id: `edge:selected-model:${decision.id}`, projectId: id, from: `execution:${decision.taskId}`, to: `model:${decision.selectedModel}`, relation: "SELECTED_MODEL", confidence: 1, source: "agent" }); await upsert(edges, { id: `edge:profile:${decision.taskId}`, projectId: id, from: `task:${decision.taskId}`, to: `profile:${decision.taskId}`, relation: "HAS_PROFILE", confidence: 1, source: "agent" });
      if (prior && prior.selectedModel !== decision.selectedModel) await upsert(edges, { id: `edge:model-switch:${prior.id}:${decision.id}`, projectId: id, from: `model:${prior.selectedModel}`, to: `model:${decision.selectedModel}`, relation: "SWITCHED_MODEL", confidence: 1, source: "agent" });
    },
    async getRoutingDecision(taskId) { return (await routingDecisions.find({ taskId, projectId: projectId() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]; },
    async getRoutingDecisions(taskId) { return (await routingDecisions.find({ taskId, projectId: projectId() })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); },
    async listRoutingDecisions() { return (await routingDecisions.find({ projectId: projectId() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async persistRoutingFallback(fallback) { const id = projectId(); await upsert(routingFallbacks, { ...fallback, projectId: id }); await upsert(edges, { id: `edge:${fallback.id}`, projectId: id, from: `model:${fallback.originalModel}`, to: `model:${fallback.fallbackModel}`, relation: "FELL_BACK_TO", confidence: 1, source: "agent" }); emit("routing_fallback", [fallback.id]); },
    async getRoutingFallbacks(taskId) { return (await routingFallbacks.find({ taskId, projectId: projectId() })).sort((a, b) => a.timestamp.localeCompare(b.timestamp)); },
    async persistImpactPrediction(prediction) {
      const id = projectId(); await upsert(impactPredictions, { ...prediction, projectId: id });
      if (prediction.taskId) await upsert(edges, { id: `edge:task-impact:${prediction.taskId}:${prediction.id}`, projectId: id, from: `task:${prediction.taskId}`, to: `prediction:${prediction.id}`, relation: "RELATED_TO_TASK", confidence: 1, source: "agent" });
      if (prediction.taskId) await upsert(edges, { id: `edge:task-impact-assessment:${prediction.taskId}:${prediction.id}`, projectId: id, from: `task:${prediction.taskId}`, to: `prediction:${prediction.id}`, relation: "HAS_IMPACT_ASSESSMENT", confidence: prediction.confidence, source: "agent" });
      for (const candidate of prediction.affectedFiles) await upsert(edges, { id: `edge:likely-affects:${prediction.id}:${candidate.path}`, projectId: id, from: `prediction:${prediction.id}`, to: `file:${candidate.path}`, relation: "LIKELY_AFFECTS", confidence: candidate.confidence, source: "agent", evidenceCount: candidate.evidenceCount, evidenceTypes: candidate.evidenceTypes, lastObservedAt: prediction.generatedAt, derivedEvidence: candidate.evidence });
      for (const candidate of prediction.affectedTests) await upsert(edges, { id: `edge:likely-test:${prediction.id}:${candidate.path}`, projectId: id, from: `prediction:${prediction.id}`, to: `file:${candidate.path}`, relation: "LIKELY_REQUIRES_TEST", confidence: candidate.confidence, source: "agent", evidenceCount: candidate.evidenceCount, evidenceTypes: candidate.evidenceTypes, lastObservedAt: prediction.generatedAt, derivedEvidence: candidate.evidence });
      for (const candidate of prediction.affectedFiles.filter((item) => item.confidence >= .5 && !prediction.affectedTests.some((test) => test.path === item.path))) await upsert(edges, { id: `edge:likely-review:${prediction.id}:${candidate.path}`, projectId: id, from: `prediction:${prediction.id}`, to: `file:${candidate.path}`, relation: "LIKELY_REQUIRES_REVIEW", confidence: candidate.confidence, source: "agent", evidenceCount: candidate.evidenceCount, evidenceTypes: candidate.evidenceTypes, lastObservedAt: prediction.generatedAt, derivedEvidence: candidate.evidence });
      emit("impact_prediction", [prediction.id]);
    },
    async getImpactPrediction(taskId) { return (await impactPredictions.find({ taskId, projectId: projectId() }))[0]; },
    async getImpactPredictionById(predictionId) { return (await impactPredictions.find({ id: predictionId, projectId: projectId() }))[0]; },
    async listImpactPredictions() { return (await impactPredictions.find({ projectId: projectId() })).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)); },
    async persistActualChange(change) { const id = projectId(); await upsert(actualChanges, { ...change, projectId: id }); await upsert(edges, { id: `edge:prediction-actual:${change.predictionId}:${change.id}`, projectId: id, from: `prediction:${change.predictionId}`, to: change.id, relation: "RESULTED_IN", confidence: 1, source: "agent" }); for (const file of change.files) await upsert(edges, { id: `edge:actual-file:${change.id}:${file}`, projectId: id, from: change.id, to: `file:${file}`, relation: "CHANGED_FILE", confidence: 1, source: "agent" }); emit("actual_change", [change.id]); },
    async getActualChange(taskId) { return (await actualChanges.find({ taskId, projectId: projectId() }))[0]; },
    async persistPredictionOutcome(outcome) { const id = projectId(); await upsert(predictionOutcomes, { ...outcome, projectId: id }); await upsert(edges, { id: `edge:prediction-outcome:${outcome.predictionId}:${outcome.id}`, projectId: id, from: `prediction:${outcome.predictionId}`, to: outcome.id, relation: "RESULTED_IN", confidence: 1, source: "agent" }); emit("prediction_outcome", [outcome.id]); },
    async getPredictionOutcomes(taskId) { return predictionOutcomes.find({ taskId, projectId: projectId() }); },
    async listPredictionOutcomes() { return predictionOutcomes.find({ projectId: projectId() }); },
    async persistChangePattern(pattern) { await upsert(changePatterns, { ...pattern, projectId: projectId() }); emit("change_pattern", [pattern.id]); },
    async listChangePatterns() { return changePatterns.find({ projectId: projectId() }); },
    async persistAutonomousExecution(execution) { const id = projectId(); await upsert(autonomousExecutions, { ...execution, projectId: id }); await upsert(edges, { id: `edge:task-execution:${execution.taskId}`, projectId: id, from: `task:${execution.taskId}`, to: execution.id, relation: "HAS_EXECUTION", confidence: 1, source: "agent" }); emit("autonomous_execution", [execution.id]); },
    async getAutonomousExecution(taskId) { return (await autonomousExecutions.find({ taskId, projectId: projectId() }))[0]; },
    async persistExecutionDecision(decision) { const id = projectId(); await upsert(executionDecisions, { ...decision, projectId: id }); await upsert(edges, { id: `edge:execution-decision:${decision.taskId}:${decision.id}`, projectId: id, from: `execution:${decision.taskId}`, to: decision.id, relation: "HAS_DECISION", confidence: decision.confidence, source: "agent" }); emit("execution_decision", [decision.id]); },
    async getExecutionDecisions(taskId) { return (await executionDecisions.find({ taskId, projectId: projectId() })).sort((a, b) => a.iteration - b.iteration || a.id.localeCompare(b.id)); },
    async persistAssumptionCheck(check) { const id = projectId(); await upsert(assumptionChecks, { ...check, projectId: id }); await upsert(edges, { id: `edge:assumption:${check.taskId}:${check.id}`, projectId: id, from: `execution:${check.taskId}`, to: check.id, relation: "CHECKED_ASSUMPTION", confidence: check.assumption.status === "unverified" ? .5 : 1, source: "agent" }); emit("assumption_check", [check.id]); },
    async getAssumptionChecks(taskId) { return (await assumptionChecks.find({ taskId, projectId: projectId() })).sort((a, b) => a.iteration - b.iteration || a.id.localeCompare(b.id)); },
    async persistReviewResult(review) { const id = projectId(); await upsert(reviewResults, { ...review, projectId: id }); await upsert(edges, { id: `edge:review:${review.taskId}:${review.id}`, projectId: id, from: `execution:${review.taskId}`, to: review.id, relation: "RAN_REVIEW", confidence: review.status === "pass" ? 1 : .8, source: "agent" }); emit("review", [review.id]); },
    async getReviewResults(taskId) { return (await reviewResults.find({ taskId, projectId: projectId() })).sort((a, b) => a.iteration - b.iteration); },
    async persistExecutionPattern(pattern) { await upsert(executionPatterns, { ...pattern, projectId: projectId() }); emit("execution_pattern", [pattern.id]); },
    async listExecutionPatterns() { return (await executionPatterns.find({ projectId: projectId() })).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); },
    async persistSandbox(sandbox) { const id = projectId(); await upsert(sandboxes, { ...sandbox, projectId: id }); await upsert(edges, { id: `edge:task-sandbox:${sandbox.taskId}:${sandbox.id}`, projectId: id, from: `task:${sandbox.taskId}`, to: sandbox.id, relation: "EXECUTED_IN", confidence: 1, source: "agent" }); await upsert(edges, { id: `edge:sandbox-policy:${sandbox.id}`, projectId: id, from: sandbox.id, to: `sandbox-policy:${sandbox.id}`, relation: "HAS_POLICY", confidence: 1, source: "agent" }); emit("sandbox", [sandbox.id]); },
    async getSandbox(sandboxId) { return (await sandboxes.find({ id: sandboxId, projectId: projectId() }))[0]; },
    async findSandboxForTask(taskId) { return (await sandboxes.find({ taskId, projectId: projectId() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; },
    async listSandboxes() { return (await sandboxes.find({ projectId: projectId() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async persistSandboxFingerprint(sandboxId, fingerprint) { const id = projectId(); await upsert(sandboxFingerprints, { ...fingerprint, id: `fingerprint:${sandboxId}`, sandboxId, projectId: id }); await upsert(edges, { id: `edge:sandbox-environment:${sandboxId}`, projectId: id, from: sandboxId, to: `fingerprint:${sandboxId}`, relation: "HAS_ENVIRONMENT", confidence: 1, source: "agent" }); emit("sandbox_fingerprint", [sandboxId]); },
    async persistSandboxCommand(result) { const id = projectId(); await upsert(sandboxCommands, { ...result, stdout: redactSensitiveText(result.stdout).slice(0, 4_000), stderr: redactSensitiveText(result.stderr).slice(0, 4_000), projectId: id }); await upsert(edges, { id: `edge:sandbox-command:${result.sandboxId}:${result.id}`, projectId: id, from: result.sandboxId, to: result.id, relation: "HAS_EXECUTION", confidence: 1, source: "agent" }); emit("sandbox_command", [result.id]); },
    async getSandboxCommands(sandboxId) { return (await sandboxCommands.find({ sandboxId, projectId: projectId() })).sort((a, b) => a.id.localeCompare(b.id)); },
    async persistProcessObservation(observation) { const id = projectId(); await upsert(processObservations, { ...observation, projectId: id }); await upsert(edges, { id: `edge:sandbox-process:${observation.sandboxId}:${observation.id}`, projectId: id, from: observation.sandboxId, to: observation.id, relation: "OBSERVED_PROCESS", confidence: 1, source: "agent" }); },
    async getProcessObservations(sandboxId) { return processObservations.find({ sandboxId, projectId: projectId() }); },
    async persistFilesystemChange(change) { const id = projectId(); await upsert(filesystemChanges, { ...change, projectId: id }); await upsert(edges, { id: `edge:sandbox-file-change:${change.sandboxId}:${change.id}`, projectId: id, from: change.sandboxId, to: change.id, relation: "OBSERVED_FILE_CHANGE", confidence: 1, source: "agent" }); },
    async getFilesystemChanges(sandboxId) { return filesystemChanges.find({ sandboxId, projectId: projectId() }); },
    async persistNetworkObservation(observation) { const id = projectId(); await upsert(networkObservations, { ...observation, projectId: id }); await upsert(edges, { id: `edge:sandbox-network:${observation.sandboxId}:${observation.id}`, projectId: id, from: observation.sandboxId, to: observation.id, relation: "OBSERVED_NETWORK_EVENT", confidence: 1, source: "agent" }); },
    async getNetworkObservations(sandboxId) { return networkObservations.find({ sandboxId, projectId: projectId() }); },
    async persistSandboxResourceUsage(sandboxId, usage) { const id = projectId(), resourceId = `resource:${sandboxId}`; await upsert(sandboxResources, { ...usage, id: resourceId, sandboxId, projectId: id }); await upsert(edges, { id: `edge:sandbox-resource:${sandboxId}`, projectId: id, from: sandboxId, to: resourceId, relation: "RESULTED_IN", confidence: 1, source: "agent" }); },
    async persistSandboxSnapshot(snapshot) { const id = projectId(); await upsert(sandboxSnapshots, { ...snapshot, projectId: id }); await upsert(edges, { id: `edge:sandbox-snapshot:${snapshot.sandboxId}:${snapshot.id}`, projectId: id, from: snapshot.sandboxId, to: snapshot.id, relation: "HAS_SNAPSHOT", confidence: 1, source: "agent" }); emit("sandbox_snapshot", [snapshot.id]); },
    async getSandboxSnapshot(snapshotId) { return (await sandboxSnapshots.find({ id: snapshotId, projectId: projectId() }))[0]; },
    async getSandboxSnapshots(sandboxId) { return (await sandboxSnapshots.find({ sandboxId, projectId: projectId() })).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); },
    async persistSandboxEvent(event) { await upsert(sandboxEvents, { ...event, payload: JSON.parse(JSON.stringify(event.payload, (_key, value) => typeof value === "string" ? value.slice(0, 4_000) : value)), projectId: projectId() }); },
    async getSandboxEvents(sandboxId) { return (await sandboxEvents.find({ sandboxId, projectId: projectId() })).sort((a, b) => a.sequence - b.sequence); },
    subscribeToProjectChanges(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async queryContext(query: ContextQuery): Promise<ContextBundle> {
      const [projectFiles, projectSymbols, projectEdges, projectCommits, projectChanges, projectObservations, pairs] = await all();
      const tokens = tokenize(query.text), normalized = query.text.toLowerCase(), limit = query.limit ?? 12;
      const scoreFiles = new Map<string, { score: number; reasons: string[] }>();
      for (const file of projectFiles) { const score = lexical(file.path, normalized, tokens); if (score) scoreFiles.set(file.id, { score: score * CONTEXT_RANKING_WEIGHTS.lexicalRelevance, reasons: ["direct task match"] }); }
      for (const symbol of projectSymbols) { const score = lexical(symbol.name, normalized, tokens); if (score) { const prior = scoreFiles.get(symbol.fileId) ?? { score: 0, reasons: [] }; prior.score += score * CONTEXT_RANKING_WEIGHTS.lexicalRelevance; prior.reasons.push(`symbol ${symbol.name}`); scoreFiles.set(symbol.fileId, prior); } }
      for (const observation of projectObservations) { const score = lexical(JSON.stringify(observation.content), normalized, tokens); if (!score) continue; for (const id of observation.relatedFiles ?? []) { const prior = scoreFiles.get(id) ?? { score: 0, reasons: [] }; prior.score += score * CONTEXT_RANKING_WEIGHTS.taskHistory; prior.reasons.push("previous agent observation"); scoreFiles.set(id, prior); } }
      const initial = [...scoreFiles.keys()];
      for (const edge of projectEdges) if (initial.includes(edge.from) || initial.includes(edge.to)) { const other = initial.includes(edge.from) ? edge.to : edge.from; if (projectFiles.some((f) => f.id === other)) { const prior = scoreFiles.get(other) ?? { score: 0, reasons: [] }; prior.score += edge.relation === "CO_CHANGED" ? edge.confidence * CONTEXT_RANKING_WEIGHTS.coChange : CONTEXT_RANKING_WEIGHTS.graphDistance; prior.reasons.push(edge.relation.toLowerCase().replace("_", " ")); scoreFiles.set(other, prior); } }
      for (const pair of pairs) for (const id of initial) { const other = pair.from === id ? pair.to : pair.to === id ? pair.from : undefined; if (other) { const prior = scoreFiles.get(other) ?? { score: 0, reasons: [] }; prior.score += Math.min(1, pair.count / 5) * CONTEXT_RANKING_WEIGHTS.coChange; prior.reasons.push(`co-changed ${pair.count} times`); scoreFiles.set(other, prior); } }
      const selected = [...scoreFiles.entries()].sort((a,b) => b[1].score-a[1].score).slice(0, limit); const ids = new Set(selected.map(([id]) => id));
      const contextFiles: ContextFile[] = selected.map(([id, rank]) => ({ ...projectFiles.find((f) => f.id === id)!, score: Math.min(1, rank.score), reason: rank.reasons.join(" + ") })).filter((f) => f.id);
      const contextSymbols: ContextSymbol[] = projectSymbols.filter((s) => ids.has(s.fileId)).slice(0, limit * 3).map((s) => ({ ...s, score: scoreFiles.get(s.fileId)?.score ?? .1, reason: "symbol attached to selected file" }));
      const history = projectCommits.map((commit) => ({ commit, score: lexical(commit.message, normalized, tokens) * CONTEXT_RANKING_WEIGHTS.lexicalRelevance + recency(commit.timestamp) * CONTEXT_RANKING_WEIGHTS.recency })).filter((x) => x.score > CONTEXT_RANKING_WEIGHTS.lexicalRelevance).sort((a,b) => b.score-a.score).slice(0, Math.min(5, limit));
      const contextChanges = await assemble(history.map((x) => x.commit)); contextChanges.forEach((record, i) => { record.score = history[i].score; record.reason = record.revertedBy ? "reverted historical approach" : "related historical change"; });
      return { files: contextFiles, symbols: contextSymbols, relationships: projectEdges.filter((e) => ids.has(e.from) || ids.has(e.to)).slice(0, limit * 4), changes: contextChanges,
        observations: projectObservations.filter((o) => lexical(JSON.stringify(o.content), normalized, tokens) > 0).slice(0, 5) };
    }
  };
};
