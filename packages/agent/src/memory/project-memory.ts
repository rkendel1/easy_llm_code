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

export interface ProjectMemory {
  initialize(project: Project): Promise<void>;
  getProject(): Promise<Project>;
  upsertFile(file: ProjectFile): Promise<void>;
  upsertSymbol(symbol: ProjectSymbol): Promise<void>;
  addRelationship(edge: ProjectEdge): Promise<void>;
  recordObservation(observation: Observation): Promise<void>;
  upsertTask(task: AgentTask): Promise<void>;
  getTask(taskId: string): Promise<{ task: AgentTask; observations: Observation[] } | undefined>;
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
  recordToolRun(run: ToolRun): Promise<void>;
  recordEvidence(evidence: Evidence, planId: string, stepId?: string): Promise<void>;
  recordModelExecution(execution: ModelExecution): Promise<void>;
  subscribeToProjectChanges(listener: (event: ProjectChangeEvent) => void): () => void;
  queryContext(query: ContextQuery): Promise<ContextBundle>;
}
