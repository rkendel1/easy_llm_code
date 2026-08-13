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
  | "TESTS";

export interface ProjectEdge {
  id: string;
  from: string;
  to: string;
  relation: ProjectRelation;
  confidence: number;
  source: "filesystem" | "ast" | "git" | "agent";
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
}

export interface Observation {
  type: "agent_analysis" | string;
  taskId: string;
  content: unknown;
  timestamp: string;
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
