export interface Project {
  id: string;
  root: string;
  name: string;
  detectedLanguages: string[];
  packageManagers: string[];
}

export interface ProjectFile {
  id: string;
  path: string;
  language?: string;
  size: number;
  hash?: string;
}

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "constant";

export interface ProjectSymbol {
  id: string;
  fileId: string;
  name: string;
  kind: SymbolKind;
}

export type ProjectRelation =
  | "CONTAINS"
  | "IMPORTS"
  | "EXPORTS"
  | "CALLS"
  | "REFERENCES"
  | "IMPLEMENTS"
  | "EXTENDS"
  | "DEPENDS_ON"
  | "TESTS"
  | "PARENT_OF"
  | "CHANGED"
  | "CO_CHANGED"
  | "REVERTED_BY"
  | "OBSERVED"
  | "PRODUCED"
  | "RELATED_TO"
  | "HAS_CONTEXT"
  | "HAS_PLAN"
  | "PLAN_STEP"
  | "SUPPORTED_BY"
  | "HAS_MUTATION"
  | "HAS_TRANSACTION"
  | "VERIFIED_BY"
  | "REPAIR_OF"
  | "HAS_OUTCOME"
  | "ROUTED_TO"
  | "RESULTED_IN"
  | "USED_PATTERN"
  | "FELL_BACK_TO"
  | "CHANGED_IN"
  | "CO_CHANGED_WITH"
  | "RELATED_TO_TASK"
  | "USED_CONTEXT"
  | "PRODUCED_PLAN"
  | "CHANGED_FILE"
  | "TRIGGERED_VERIFICATION"
  | "LIKELY_AFFECTS"
  | "LIKELY_REQUIRES_TEST"
  | "LIKELY_REQUIRES_REVIEW"
  | "HAS_PROFILE"
  | "SELECTED_CONTEXT"
  | "SELECTED_MODEL"
  | "HAS_IMPACT_ASSESSMENT"
  | "HAS_EXECUTION"
  | "HAS_DECISION"
  | "CHECKED_ASSUMPTION"
  | "REFRESHED_CONTEXT"
  | "SWITCHED_MODEL"
  | "APPLIED_MUTATION"
  | "RAN_VERIFICATION"
  | "RAN_REVIEW"
  | "REPLANNED"
  | "EXECUTED_IN"
  | "HAS_ENVIRONMENT"
  | "HAS_POLICY"
  | "HAS_SNAPSHOT"
  | "OBSERVED_PROCESS"
  | "OBSERVED_FILE_CHANGE"
  | "OBSERVED_NETWORK_EVENT"
  | "RUN_IN_IDE"
  | "ASSOCIATED_WORKSPACE"
  | "PRODUCED_RUNTIME_EVENTS";


export interface ProjectEdge {
  id: string;
  from: string;
  to: string;
  relation: ProjectRelation;
  confidence: number;
  source: "filesystem" | "ast" | "git" | "agent";
  validFrom?: string;
  validTo?: string;
  commitId?: string;
  derivedEvidence?: import("../change-intelligence/types.js").DerivedEvidence[];
  evidenceCount?: number;
  evidenceTypes?: import("../change-intelligence/types.js").ImpactEvidenceType[];
  lastObservedAt?: string;
  generation?: number;
}

export interface ContextQuery {
  text: string;
  limit?: number;
}

export interface ContextFile extends ProjectFile {
  score: number;
  reason: string;
}

export interface ContextSymbol extends ProjectSymbol {
  score: number;
  reason: string;
}

export interface ContextBundle {
  files: ContextFile[];
  symbols: ContextSymbol[];
  relationships: ProjectEdge[];
  changes?: ChangeRecord[];
  observations?: Observation[];
}

export interface Observation {
  id?: string;
  type: "agent_analysis" | "test_result" | "tool_result" | "decision" | "warning";
  taskId: string;
  content: unknown;
  timestamp: string;
  relatedFiles?: string[];
  relatedSymbols?: string[];
  relatedCommit?: string;
}

export interface AgentTask {
  id: string;
  request: string;
  status: "created" | "analyzing" | "contextualizing" | "planning" | "planned" | "awaiting_approval" | "executing" | "mutating" | "verifying" | "reviewing" | "repairing" | "replanning" | "paused" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt?: string;
}

export interface HistoryQueryOptions { limit?: number; before?: string }
export interface ChangeQuery { text?: string; fileIds?: string[]; commitIds?: string[]; limit?: number }
export interface RecentChangeOptions { limit?: number; since?: string }
export interface ChangeRecord {
  commit: import("../history/history-types.js").CommitRecord;
  files: import("../history/history-types.js").FileChangeRecord[];
  score?: number;
  reason?: string;
  revertedBy?: string;
}
export interface FileHistory { file: ProjectFile; changes: ChangeRecord[]; totalCommits: number }
export interface RiskSignal { level: "low" | "medium" | "high"; reason: string; files?: string[] }
export interface ChangeImpact {
  directlyAffected: string[];
  dependents: string[];
  tests: string[];
  recentlyChangedTogether: string[];
  riskSignals: RiskSignal[];
}
export interface MemorySummary {
  files: number; symbols: number; relationships: number; commits: number;
  tasks: number; observations: number; frequentCoChanges: number; revertedChanges: number;
  recentChanges: ChangeRecord[];
}
export type ProjectChangeEvent = { type: string; ids: string[]; timestamp: string };
export interface MemoryCapabilities {
  persistent: boolean;
  crossProcess: boolean;
  reactive: boolean;
  temporal: boolean;
  graph: boolean;
  outcomes: boolean;
  execution: boolean;
  sync: boolean;
  storage: "feltdb-remote" | "feltdb-local-journal" | "feltdb-hybrid" | "memory";
}

export type MemoryResetScope = "all" | "graph" | "history" | "tasks" | "outcomes" | "execution" | "routing";
export interface MemoryResetResult { scope: MemoryResetScope; removed: Record<string, number>; generation: number }
export type MemoryFactClass = "FACTUAL" | "DERIVED";
export interface MemoryFactProvenance { id: string; factId: string; collection: string; projectId: string; source: string; observedAt: string; confidence: number; generation: number; evidence: string[]; classification: MemoryFactClass; taskId?: string; commitId?: string; sandboxId?: string }
export interface MemoryGraphStatistics { generation: number; nodes: Record<string, number>; relationships: Record<string, number> }
export interface SyncState { projectId: string; localGeneration: number; remoteGeneration: number; lastSyncAt?: string; pendingChanges: number; conflicts: number; status: "local-only" | "offline" | "synced" | "pending" }
export interface MemoryStatus { projectId: string; provider: "local" | "hosted" | "hybrid" | "ephemeral"; schemaVersion: number; generation: number; storageBytes: number; integrity: "ok" | "error"; lastIndexedAt?: string; lastTaskId?: string; sync: SyncState; capabilities: MemoryCapabilities; statistics: MemoryGraphStatistics }
export interface MemoryExport { format: "easy-llm-code-project-memory"; schemaVersion: number; projectId: string; namespace: string; generation: number; exportedAt: string; operations: import("@feltdb/core").EmbeddedOperation[] }
export interface MemoryCompactionPolicy { executionEvents: number; commandExecutions: number }
export interface MemoryCompactionResult { removed: Record<string, number>; preservedFailures: number; generation: number }

export interface AgentAnalysis {
  summary: string;
  relevantFiles: {
    path: string;
    reason: string;
  }[];
  dependencies: {
    from: string;
    to: string;
    reason: string;
  }[];
  recommendedNextSteps: string[];
}
