import type {
  ContextBundle,
  ChangeImpact,
  ChangeQuery,
  ChangeRecord,
  FileHistory,
  HistoryQueryOptions,
  MemorySummary,
  MemoryCapabilities,
  RecentChangeOptions,
  AgentTask,
  ProjectChangeEvent,
  ContextQuery,
  Observation,
  Project,
  ProjectEdge,
  ProjectFile,
  ProjectSymbol
} from "./types.js";
import type { CommitRecord, FileChangeRecord, HistoryCursor } from "../history/history-types.js";
import type { AgentPlan, Evidence, ModelExecution, ToolRun } from "../planning/types.js";
import type { MutationProposal, MutationTransaction, RepairAttempt, TaskOutcome } from "../mutation/types.js";
import type { VerificationRun } from "../verification/types.js";
import type { TaskCheckpoint } from "../task/checkpoint.js";
import type { PersistedAgentEvent } from "../task/events.js";
import type { OutcomeSignal, ContextOutcome } from "../intelligence/outcome-model.js";
import type { RoutingDecision, RoutingFallback } from "../routing/decision.js";
import type { SuccessfulPattern } from "./successful-patterns.js";
import type { FailurePattern } from "./failure-patterns.js";
import type { ActualChange, ChangePattern, ImpactPrediction, PredictionOutcome } from "../change-intelligence/types.js";

export interface ProjectMemory {
  initialize(project: Project): Promise<void>;
  getProject(): Promise<Project>;
  upsertFile(file: ProjectFile): Promise<void>;
  upsertSymbol(symbol: ProjectSymbol): Promise<void>;
  listProjectFiles(): Promise<ProjectFile[]>;
  listProjectSymbols(): Promise<ProjectSymbol[]>;
  listRelationships(): Promise<ProjectEdge[]>;
  listObservations(): Promise<Observation[]>;
  addRelationship(edge: ProjectEdge): Promise<void>;
  recordObservation(observation: Observation): Promise<void>;
  upsertTask(task: AgentTask): Promise<void>;
  getTask(taskId: string): Promise<{ task: AgentTask; observations: Observation[] } | undefined>;
  listTasks(limit?: number): Promise<AgentTask[]>;
  persistTaskCheckpoint(checkpoint: TaskCheckpoint): Promise<void>;
  getTaskCheckpoint(taskId: string): Promise<TaskCheckpoint | undefined>;
  recordTaskEvent(event: PersistedAgentEvent): Promise<void>;
  getTaskEvents(taskId: string): Promise<PersistedAgentEvent[]>;
  ingestCommit(commit: CommitRecord, changes: FileChangeRecord[]): Promise<void>;
  getHistoryCursor(): Promise<HistoryCursor | undefined>;
  setHistoryCursor(cursor: HistoryCursor): Promise<void>;
  getFileHistory(fileId: string, options?: HistoryQueryOptions): Promise<FileHistory>;
  getRelatedChanges(query: ChangeQuery): Promise<ChangeRecord[]>;
  getRecentChanges(options?: RecentChangeOptions): Promise<ChangeRecord[]>;
  getChangeImpact(files: string[]): Promise<ChangeImpact>;
  getSummary(): Promise<MemorySummary>;
  getCapabilities(): Promise<MemoryCapabilities>;
  persistPlan(plan: AgentPlan): Promise<void>;
  getPlan(planId: string): Promise<AgentPlan | undefined>;
  findPlanForTask(taskId: string): Promise<AgentPlan | undefined>;
  recordToolRun(run: ToolRun): Promise<void>;
  recordEvidence(evidence: Evidence, planId: string, stepId?: string): Promise<void>;
  recordModelExecution(execution: ModelExecution): Promise<void>;
  getModelExecutions(taskId: string): Promise<ModelExecution[]>;
  persistMutationProposal(proposal: MutationProposal): Promise<void>;
  getMutationProposal(proposalId: string): Promise<MutationProposal | undefined>;
  findMutationForPlan(planId: string): Promise<MutationProposal | undefined>;
  listMutationProposals(): Promise<MutationProposal[]>;
  persistMutationTransaction(transaction: MutationTransaction): Promise<void>;
  getMutationTransactions(taskId: string): Promise<MutationTransaction[]>;
  persistVerificationRun(run: VerificationRun): Promise<void>;
  getVerificationRuns(taskId: string): Promise<VerificationRun[]>;
  persistRepairAttempt(attempt: RepairAttempt): Promise<void>;
  persistTaskOutcome(taskId: string, outcome: TaskOutcome): Promise<void>;
  getTaskOutcome(taskId: string): Promise<TaskOutcome | undefined>;
  persistOutcomeSignal(signal: OutcomeSignal): Promise<void>;
  listOutcomeSignals(): Promise<OutcomeSignal[]>;
  persistContextOutcome(outcome: ContextOutcome): Promise<void>;
  listContextOutcomes(taskId?: string): Promise<ContextOutcome[]>;
  persistSuccessfulPattern(pattern: SuccessfulPattern): Promise<void>;
  listSuccessfulPatterns(): Promise<SuccessfulPattern[]>;
  persistFailurePattern(pattern: FailurePattern): Promise<void>;
  listFailurePatterns(): Promise<FailurePattern[]>;
  persistRoutingDecision(decision: RoutingDecision): Promise<void>;
  getRoutingDecision(taskId: string): Promise<RoutingDecision | undefined>;
  listRoutingDecisions(): Promise<RoutingDecision[]>;
  persistRoutingFallback(fallback: RoutingFallback): Promise<void>;
  getRoutingFallbacks(taskId: string): Promise<RoutingFallback[]>;
  persistImpactPrediction(prediction: ImpactPrediction): Promise<void>;
  getImpactPrediction(taskId: string): Promise<ImpactPrediction | undefined>;
  listImpactPredictions(): Promise<ImpactPrediction[]>;
  persistActualChange(change: ActualChange): Promise<void>;
  getActualChange(taskId: string): Promise<ActualChange | undefined>;
  persistPredictionOutcome(outcome: PredictionOutcome): Promise<void>;
  getPredictionOutcomes(taskId: string): Promise<PredictionOutcome[]>;
  listPredictionOutcomes(): Promise<PredictionOutcome[]>;
  persistChangePattern(pattern: ChangePattern): Promise<void>;
  listChangePatterns(): Promise<ChangePattern[]>;
  subscribeToProjectChanges(listener: (event: ProjectChangeEvent) => void): () => void;
  queryContext(query: ContextQuery): Promise<ContextBundle>;
}
