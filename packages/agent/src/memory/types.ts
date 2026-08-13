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
  | "HAS_OUTCOME";


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
  status: "created" | "analyzing" | "planning" | "planned" | "executing" | "completed" | "failed" | "cancelled";
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
  reactive: boolean;
  temporal: boolean;
  graph: boolean;
}

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
