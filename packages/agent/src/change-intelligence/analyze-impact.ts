import { createHash } from "node:crypto";
import type { ProjectMemory } from "../memory/project-memory.js";
import { outcomeQuality } from "../intelligence/outcome-model.js";
import { DEFAULT_CHANGE_INTELLIGENCE_POLICY, type ChangeIntelligencePolicy } from "./policy.js";
import { mineChangePatterns } from "./patterns.js";
import type { AnalyzeChangeImpactInput, ChangeImpactAnalysis, ImpactCandidate, ImpactEvidence, ImpactEvidenceType, ImpactPrediction } from "./types.js";

const pathOf = (value: string): string => value.startsWith("file:") ? value.slice(5) : value;
const dayTimestamp = (): string => new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString();
const bounded = (value: number): number => Math.max(0, Math.min(1, value));
const isTest = (path: string): boolean => /(^|\/)(__tests__\/|test\/|tests\/)|\.(?:test|spec)\.[^.]+$/i.test(path);
const subsystemOf = (path: string): string | undefined => path.split("/").filter(Boolean).slice(0, -1).at(-1);

interface Accumulator { structural: number; historical: number; coChange: number; taskHistory: number; outcome: number; context: number; evidence: ImpactEvidence[]; observations: Set<string> }
const empty = (): Accumulator => ({ structural: 0, historical: 0, coChange: 0, taskHistory: 0, outcome: 0, context: 0, evidence: [], observations: new Set() });

export const createChangeIntelligence = (options: { memory: ProjectMemory; policy?: ChangeIntelligencePolicy }) => ({
  async analyzeChangeImpact(input: AnalyzeChangeImpactInput): Promise<ImpactPrediction> {
    const policy = options.policy ?? DEFAULT_CHANGE_INTELLIGENCE_POLICY, generatedAt = dayTimestamp();
    const [project, files, symbols, edges, changes, proposals, tasks, observations, signals, predictionHistory, predictionOutcomes, contextOutcomes] = await Promise.all([
      options.memory.getProject(), options.memory.listProjectFiles(), options.memory.listProjectSymbols(), options.memory.listRelationships(), options.memory.getRecentChanges({ limit: 10_000 }),
      options.memory.listMutationProposals(), options.memory.listTasks(10_000), options.memory.listObservations(), options.memory.listOutcomeSignals(), options.memory.listImpactPredictions(), options.memory.listPredictionOutcomes(), options.memory.listContextOutcomes()
    ]);
    const known = new Map(files.flatMap((file) => [[file.path, file.path], [file.id, file.path]]));
    for (const symbol of symbols) known.set(symbol.id, known.get(symbol.fileId) ?? pathOf(symbol.fileId));
    const targets = [...new Set([...input.files, ...(input.symbols ?? [])].map((value) => known.get(value) ?? known.get(`file:${value}`) ?? pathOf(value)))].sort();
    const targetSet = new Set(targets), candidates = new Map<string, Accumulator>();
    const add = (target: string, candidate: string, type: ImpactEvidenceType, signal: keyof Omit<Accumulator, "evidence" | "observations">, value: number, sampleSize: number, description: string, observationIds: string[]) => {
      candidate = pathOf(candidate); if (targetSet.has(candidate) || !known.has(candidate)) return;
      const item = candidates.get(candidate) ?? empty(); item[signal] = Math.max(item[signal], bounded(value)); observationIds.forEach((id) => item.observations.add(id));
      const scope = type === "structural" || type === "test" ? "file" : type === "task" && subsystemOf(target) === subsystemOf(candidate) ? "subsystem" : "repository";
      item.evidence.push({ source: type, target, candidate, confidence: bounded(value), observations: observationIds.slice(0, 20), sampleSize, generatedAt, description, scope }); candidates.set(candidate, item);
    };

    const structuralRelations = new Set(["IMPORTS", "EXPORTS", "CALLS", "REFERENCES", "IMPLEMENTS", "EXTENDS", "DEPENDS_ON", "TESTS", "CONTAINS"]);
    for (const target of targets) for (const edge of edges) {
      if (!structuralRelations.has(edge.relation)) continue; const from = known.get(edge.from), to = known.get(edge.to);
      const candidate = from === target ? to : to === target ? from : undefined; if (!candidate) continue;
      add(target, candidate, edge.relation === "TESTS" ? "test" : "structural", "structural", edge.confidence, 1, `${edge.relation} factual relationship`, [edge.id]);
    }

    for (const target of targets) {
      const relevant = changes.filter((change) => change.files.some((file) => pathOf(file.fileId) === target)), recent = relevant.slice(0, 20);
      const counts = new Map<string, string[]>();
      for (const change of relevant) for (const file of change.files) { const candidate = pathOf(file.fileId); if (candidate !== target) counts.set(candidate, [...(counts.get(candidate) ?? []), change.commit.id]); }
      for (const [candidate, commits] of counts) {
        const recentCount = recent.filter((change) => change.files.some((file) => pathOf(file.fileId) === candidate)).length;
        const reverted = relevant.filter((change) => change.revertedBy && change.files.some((file) => pathOf(file.fileId) === candidate)).length;
        add(target, candidate, "historical", "historical", commits.length / (relevant.length + policy.samplePrior), commits.length, `changed together in ${commits.length}/${relevant.length} commits${reverted ? `; ${reverted} reverted` : ""}`, commits);
        add(target, candidate, "cochange", "coChange", (0.7 * commits.length / (relevant.length + policy.samplePrior)) + (0.3 * recentCount / Math.max(1, recent.length)), commits.length, `${recentCount} recent and ${commits.length} total co-change observations`, commits);
      }
    }

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    for (const target of targets) {
      const relevant = proposals.filter((proposal) => proposal.files.some((file) => file.path === target));
      const pairs = new Map<string, string[]>();
      for (const proposal of relevant) for (const file of proposal.files) if (file.path !== target) pairs.set(file.path, [...(pairs.get(file.path) ?? []), proposal.taskId]);
      for (const [candidate, taskIds] of pairs) {
        const typed = input.taskType ? taskIds.filter((id) => taskById.get(id) && signals.find((signal) => signal.taskId === id)?.taskType === input.taskType) : taskIds;
        const matched = typed.length ? typed : taskIds; add(target, candidate, "task", "taskHistory", matched.length / (relevant.length + policy.samplePrior), matched.length, `changed together in ${matched.length}/${relevant.length} repository tasks`, matched);
        const outcomes = signals.filter((signal) => matched.includes(signal.taskId));
        if (outcomes.length) { const quality = outcomes.reduce((sum, signal) => sum + outcomeQuality(signal), 0) / outcomes.length; add(target, candidate, "outcome", "outcome", ((quality + 1) / 2) * outcomes.length / (outcomes.length + policy.samplePrior), outcomes.length, `${outcomes.length} task outcomes support this relationship`, outcomes.map((item) => item.taskId)); }
      }
    }

    for (const target of targets) {
      const selectedTogether = new Map<string, string[]>();
      for (const observation of observations.filter((item) => item.type === "decision")) {
        const selected = ((observation.content as { selected?: { id: string }[] })?.selected ?? []).map((item) => known.get(item.id)).filter((item): item is string => Boolean(item));
        if (!selected.includes(target)) continue; for (const candidate of selected) if (candidate !== target) selectedTogether.set(candidate, [...(selectedTogether.get(candidate) ?? []), observation.id ?? `context:${observation.taskId}`]);
      }
      for (const [candidate, ids] of selectedTogether) {
        const taskIds = ids.map((id) => observations.find((item) => item.id === id)?.taskId).filter((item): item is string => Boolean(item));
        const usefulness = taskIds.map((taskId) => contextOutcomes.filter((item) => item.taskId === taskId)).flat().reduce((sum, item) => sum + (item.usefulness ?? (item.outcome === "success" ? 1 : 0)), 0);
        add(target, candidate, "context", "context", (usefulness || ids.length * .5) / (ids.length + policy.samplePrior), ids.length, `selected together in ${ids.length} task contexts; usefulness ${usefulness.toFixed(1)}`, ids);
      }
    }

    for (const target of targets) {
      const relevantPredictionIds = new Set(predictionHistory.filter((prediction) => prediction.targets.includes(target)).map((prediction) => prediction.id));
      const relevant = predictionOutcomes.filter((outcome) => relevantPredictionIds.has(outcome.predictionId));
      const byFile = new Map<string, typeof relevant>();
      for (const outcome of relevant) byFile.set(outcome.file, [...(byFile.get(outcome.file) ?? []), outcome]);
      for (const [candidate, outcomes] of byFile) {
        const positive = outcomes.filter((item) => item.classification === "confirmed" || item.classification === "false_negative").length;
        const failedOmissions = outcomes.filter((item) => item.classification === "false_negative" && signals.some((signal) => signal.taskId === item.taskId && !signal.verificationPassed)).length;
        add(target, candidate, "outcome", "outcome", positive / (outcomes.length + policy.samplePrior), outcomes.length,
          `${positive}/${outcomes.length} prior predictions confirmed impact${failedOmissions ? `; ${failedOmissions} omissions accompanied verification failure` : ""}`, outcomes.map((item) => item.id));
      }
    }

    const ranked: ImpactCandidate[] = [...candidates].map(([path, item]) => {
      const base = item.structural * policy.weights.structural + item.historical * policy.weights.historical + item.coChange * policy.weights.coChange + item.taskHistory * policy.weights.taskHistory + item.outcome * policy.weights.outcome;
      const diversity = new Set(item.evidence.map((entry) => entry.source)), evidenceCount = item.observations.size;
      let confidence = bounded((base + item.context * policy.contextBonus) * Math.min(1, 0.65 + diversity.size * 0.07));
      if (evidenceCount <= 1) confidence = Math.min(0.49, confidence);
      return { path, confidence, evidenceCount, evidenceTypes: [...diversity].sort(), signals: { structural: item.structural, historical: item.historical, coChange: item.coChange, taskHistory: item.taskHistory, outcome: item.outcome, context: item.context }, evidence: item.evidence.sort((a, b) => a.source.localeCompare(b.source) || a.description.localeCompare(b.description)) };
    }).filter((item) => item.confidence >= policy.minimumPrediction).sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount || a.path.localeCompare(b.path));
    const tests = ranked.filter((item) => isTest(item.path) || item.evidence.some((entry) => entry.source === "test"));
    const evidence = ranked.flatMap((item) => item.evidence), affectedPaths = new Set(ranked.map((item) => item.path));
    const historicalChanges = changes.filter((change) => change.files.some((file) => targetSet.has(pathOf(file.fileId)))).slice(0, 20).map((change) => change.commit.id);
    const riskAreas = [...new Set(ranked.filter((item) => item.confidence >= policy.mediumConfidence).map((item) => subsystemOf(item.path)).filter((item): item is string => Boolean(item)))].sort();
    const decisions = ranked.filter((item) => item.confidence >= policy.highConfidence).map((item) => ({ path: item.path, decision: "not_modified" as const, reason: "Planner must explicitly include or justify this high-confidence impact" }));
    const assessment = { expectedFiles: targets, likelyAffectedFiles: ranked.map((item) => item.path), expectedTests: tests.map((item) => item.path), riskAreas, evidence, decisions };
    const idSeed = JSON.stringify({ repositoryId: project.id, targets, symbols: input.symbols?.slice().sort(), taskType: input.taskType, proposedChanges: input.proposedChanges?.slice().sort() });
    const id = `impact:${createHash("sha256").update(idSeed).digest("hex").slice(0, 20)}`, confidence = ranked.length ? ranked.reduce((sum, item) => sum + item.confidence, 0) / ranked.length : 0;
    const analysis: ImpactPrediction = { id, repositoryId: project.id, taskId: input.taskId, targets, affectedFiles: ranked, affectedSymbols: symbols.filter((symbol) => affectedPaths.has(known.get(symbol.fileId) ?? "")).map((symbol) => symbol.id).sort(),
      affectedTests: tests, relatedSubsystems: [...new Set([...targets, ...ranked.map((item) => item.path)].map(subsystemOf).filter((item): item is string => Boolean(item)))].sort(), historicalChanges, confidence, evidence, assessment, generatedAt };
    for (const pattern of mineChangePatterns(project.id, changes, generatedAt)) await options.memory.persistChangePattern(pattern);
    if (input.persist) await options.memory.persistImpactPrediction(analysis);
    return analysis;
  }
});
