import { createFeltDB } from "@feltdb/core";
import { coChangePairs, revertedSha } from "../history/changes.js";
import type { CommitRecord, FileChangeRecord, HistoryCursor } from "../history/history-types.js";
import type { ProjectMemory } from "./project-memory.js";
import type { AgentTask, ChangeRecord, ContextBundle, ContextFile, ContextQuery, ContextSymbol,
  Observation, Project, ProjectChangeEvent, ProjectEdge, ProjectFile, ProjectSymbol, RiskSignal } from "./types.js";
import type { AgentPlan, Evidence, ModelExecution, PlanStep, ToolRun } from "../planning/types.js";
import type { FilePatch, MutationProposal, MutationTransaction, RepairAttempt, TaskOutcome } from "../mutation/types.js";
import type { VerificationRun } from "../verification/types.js";

interface StoredObservation extends Observation { id: string; projectId: string }
interface StoredChange extends FileChangeRecord { projectId: string }
interface StoredCommit extends CommitRecord { projectId: string; revertedBy?: string }
interface CoChange { id: string; projectId: string; from: string; to: string; count: number }
export interface MemoryOptions { root: string; namespace?: string; server?: { url: string; token: string } }

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

export const createFeltDBProjectMemory = (options: MemoryOptions): ProjectMemory => {
  const db = options.server
    ? createFeltDB({ namespace: options.namespace ?? `code-agent:${options.root}`, server: options.server })
    : createFeltDB({ namespace: options.namespace ?? `code-agent:${options.root}`, memory: true });
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
  let currentProjectId: string | undefined;
  const listeners = new Set<(event: ProjectChangeEvent) => void>();

  const upsert = async <T extends { id: string }>(collection: any, item: T): Promise<void> => {
    const found = await collection.find({ id: item.id });
    if (found.length) await collection.update(item.id, item); else await collection.insert(item, item.id);
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

  return {
    async initialize(project) { currentProjectId = project.id; await upsert(projects, project); },
    async getProject() { const found = await projects.find({ id: projectId() }); if (!found[0]) throw new Error("Project not found"); return found[0]; },
    async upsertFile(file) { await upsert(files, { ...file, projectId: projectId() }); emit("file", [file.id]); },
    async upsertSymbol(symbol) { await upsert(symbols, { ...symbol, projectId: projectId() }); emit("symbol", [symbol.id]); },
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
    async ingestCommit(commit, commitChanges) {
      const id = projectId();
      await upsert(commits, { ...commit, projectId: id });
      for (const change of commitChanges) {
        await upsert(changes, { ...change, projectId: id });
        await upsert(edges, { id: `edge:changed:${commit.id}:${change.fileId}`, projectId: id, from: commit.id, to: change.fileId,
          relation: "CHANGED", confidence: 1, source: "git", commitId: commit.id, validFrom: commit.sha });
      }
      for (const parent of commit.parentShas) await upsert(edges, { id: `edge:parent:${parent}:${commit.sha}`, projectId: id,
        from: `commit:${parent}`, to: commit.id, relation: "PARENT_OF", confidence: 1, source: "git", commitId: commit.id });
      for (const [from, to] of coChangePairs(commitChanges)) {
        const pairId = `cochange:${from}:${to}`; const found = await cochanges.find({ id: pairId }); const count = (found[0]?.count ?? 0) + 1;
        await upsert(cochanges, { id: pairId, projectId: id, from, to, count });
        await upsert(edges, { id: `edge:${pairId}`, projectId: id, from, to, relation: "CO_CHANGED",
          confidence: Math.min(0.99, count / (count + 2)), source: "git", commitId: commit.id });
      }
      const reverted = revertedSha(commit.message);
      if (reverted) {
        const originals = await commits.find({ sha: reverted, projectId: id });
        if (originals[0]) {
          await commits.update(originals[0].id, { revertedBy: commit.id });
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
      return { persistent: runtime.persistent, reactive: runtime.reactive, temporal: true, graph: true };
    },
    async persistPlan(plan) {
      const id = projectId(); await upsert(plans, { ...plan, projectId: id });
      await upsert(edges, { id: `edge:task-plan:${plan.taskId}:${plan.id}`, projectId: id, from: `task:${plan.taskId}`, to: `plan:${plan.id}`, relation: "HAS_PLAN", confidence: 1, source: "agent" });
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
    async persistMutationTransaction(transaction) { const id = projectId(); await upsert(mutationTransactions, { ...transaction, projectId: id }); await upsert(edges, { id: `edge:mutation-transaction:${transaction.proposalId}:${transaction.id}`, projectId: id, from: `mutation:${transaction.proposalId}`, to: `transaction:${transaction.id}`, relation: "HAS_TRANSACTION", confidence: 1, source: "agent" }); emit("mutation_transaction", [transaction.id]); },
    async getMutationTransactions(taskId) { return mutationTransactions.find({ taskId, projectId: projectId() }); },
    async persistVerificationRun(run) { const id = projectId(); await upsert(verificationRuns, { ...run, projectId: id }); await upsert(edges, { id: `edge:mutation-verification:${run.proposalId}:${run.id}`, projectId: id, from: `mutation:${run.proposalId}`, to: `verification:${run.id}`, relation: "VERIFIED_BY", confidence: 1, source: "agent" }); emit("verification_run", [run.id]); },
    async getVerificationRuns(taskId) { return verificationRuns.find({ taskId, projectId: projectId() }); },
    async persistRepairAttempt(attempt) { const id = projectId(); await upsert(repairAttempts, { ...attempt, projectId: id }); await upsert(edges, { id: `edge:repair:${attempt.id}:${attempt.proposalId}`, projectId: id, from: `repair:${attempt.id}`, to: `mutation:${attempt.proposalId}`, relation: "REPAIR_OF", confidence: 1, source: "agent" }); emit("repair_attempt", [attempt.id]); },
    async persistTaskOutcome(taskId, outcome) { const id = projectId(); await upsert(taskOutcomes, { ...outcome, id: `outcome:${taskId}`, taskId, projectId: id }); await upsert(edges, { id: `edge:task-outcome:${taskId}`, projectId: id, from: `task:${taskId}`, to: `outcome:${taskId}`, relation: "HAS_OUTCOME", confidence: 1, source: "agent" }); emit("task_outcome", [taskId]); },
    async getTaskOutcome(taskId) { return (await taskOutcomes.find({ taskId, projectId: projectId() }))[0]; },
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
