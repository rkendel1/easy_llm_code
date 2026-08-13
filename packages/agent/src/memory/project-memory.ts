import type {
  ContextBundle,
  ChangeImpact,
  ChangeQuery,
  ChangeRecord,
  FileHistory,
  HistoryQueryOptions,
  MemorySummary,
  MemoryCapabilities,
  MemoryFactProvenance,
  MemoryGraphStatistics,
  MemoryResetResult,
  MemoryResetScope,
  MemoryExport,
  MemoryStatus,
  SyncState,
  MemoryCompactionPolicy,
  MemoryCompactionResult,
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
import type { AssumptionCheck, AutonomousExecution, ExecutionDecision, ExecutionPattern, ReviewResult } from "../autonomy/types.js";
import type { EnvironmentFingerprint, ExecutionResult, FilesystemChange, NetworkObservation, ProcessObservation, ResourceUsage, Sandbox, SandboxEvent, SandboxSnapshot } from "../sandbox/core/sandbox-types.js";

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
  persist(): Promise<void>;
  reset(scope?: MemoryResetScope): Promise<MemoryResetResult>;
  prepareRebuild(): Promise<MemoryResetResult>;
  beginGeneration(reason: string): Promise<number>;
  getGeneration(): Promise<number>;
  getFactProvenance(factId: string): Promise<MemoryFactProvenance[]>;
  getGraphStatistics(): Promise<MemoryGraphStatistics>;
  getStatus(): Promise<MemoryStatus>;
  sync(): Promise<SyncState>;
  exportMemory(): Promise<MemoryExport>;
  importMemory(snapshot: MemoryExport): Promise<void>;
  compact(policy?: Partial<MemoryCompactionPolicy>): Promise<MemoryCompactionResult>;
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
  getRoutingDecisions(taskId: string): Promise<RoutingDecision[]>;
  listRoutingDecisions(): Promise<RoutingDecision[]>;
  persistRoutingFallback(fallback: RoutingFallback): Promise<void>;
  getRoutingFallbacks(taskId: string): Promise<RoutingFallback[]>;
  persistImpactPrediction(prediction: ImpactPrediction): Promise<void>;
  getImpactPrediction(taskId: string): Promise<ImpactPrediction | undefined>;
  getImpactPredictionById(predictionId: string): Promise<ImpactPrediction | undefined>;
  listImpactPredictions(): Promise<ImpactPrediction[]>;
  persistActualChange(change: ActualChange): Promise<void>;
  getActualChange(taskId: string): Promise<ActualChange | undefined>;
  persistPredictionOutcome(outcome: PredictionOutcome): Promise<void>;
  getPredictionOutcomes(taskId: string): Promise<PredictionOutcome[]>;
  listPredictionOutcomes(): Promise<PredictionOutcome[]>;
  persistChangePattern(pattern: ChangePattern): Promise<void>;
  listChangePatterns(): Promise<ChangePattern[]>;
  persistAutonomousExecution(execution: AutonomousExecution): Promise<void>;
  getAutonomousExecution(taskId: string): Promise<AutonomousExecution | undefined>;
  persistExecutionDecision(decision: ExecutionDecision): Promise<void>;
  getExecutionDecisions(taskId: string): Promise<ExecutionDecision[]>;
  persistAssumptionCheck(check: AssumptionCheck): Promise<void>;
  getAssumptionChecks(taskId: string): Promise<AssumptionCheck[]>;
  persistReviewResult(review: ReviewResult): Promise<void>;
  getReviewResults(taskId: string): Promise<ReviewResult[]>;
  persistExecutionPattern(pattern: ExecutionPattern): Promise<void>;
  listExecutionPatterns(): Promise<ExecutionPattern[]>;
  persistSandbox(sandbox: Sandbox): Promise<void>;
  getSandbox(sandboxId: string): Promise<Sandbox | undefined>;
  findSandboxForTask(taskId: string): Promise<Sandbox | undefined>;
  listSandboxes(): Promise<Sandbox[]>;
  persistSandboxFingerprint(sandboxId: string, fingerprint: EnvironmentFingerprint): Promise<void>;
  persistSandboxCommand(result: ExecutionResult): Promise<void>;
  getSandboxCommands(sandboxId: string): Promise<ExecutionResult[]>;
  persistProcessObservation(observation: ProcessObservation): Promise<void>;
  getProcessObservations(sandboxId: string): Promise<ProcessObservation[]>;
  persistFilesystemChange(change: FilesystemChange): Promise<void>;
  getFilesystemChanges(sandboxId: string): Promise<FilesystemChange[]>;
  persistNetworkObservation(observation: NetworkObservation): Promise<void>;
  getNetworkObservations(sandboxId: string): Promise<NetworkObservation[]>;
  persistSandboxResourceUsage(sandboxId: string, usage: ResourceUsage): Promise<void>;
  persistSandboxSnapshot(snapshot: SandboxSnapshot): Promise<void>;
  getSandboxSnapshot(snapshotId: string): Promise<SandboxSnapshot | undefined>;
  getSandboxSnapshots(sandboxId: string): Promise<SandboxSnapshot[]>;
  persistSandboxEvent(event: SandboxEvent): Promise<void>;
  getSandboxEvents(sandboxId: string): Promise<SandboxEvent[]>;
  subscribeToProjectChanges(listener: (event: ProjectChangeEvent) => void): () => void;
  queryContext(query: ContextQuery): Promise<ContextBundle>;
}
