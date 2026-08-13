export type ContextItemType = "file" | "symbol" | "relationship" | "commit" | "change" | "observation" | "test";

export interface ContextReason {
  lexical: number;
  structural: number;
  historical: number;
  recency: number;
  coChange: number;
  memory: number;
}

export interface ContextItem {
  id: string;
  type: ContextItemType;
  reference: string;
  score: number;
  reason: ContextReason;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ContextBudget { maxItems: number; maxCharacters: number; maxTokens?: number }
export interface ExpansionPolicy { maxDepth: number; maxNodes: number }
export interface RankingWeights {
  lexical: number; structural: number; historical: number;
  recency: number; coChange: number; memory: number;
}
export interface ContextPolicy { budget?: Partial<ContextBudget>; target?: { contextWindow?: number } }
export interface ContextMetrics {
  candidateCount: number; selectedCount: number; characters: number;
  estimatedTokens: number; rawEstimatedTokens: number; compressionRatio: number;
}
export interface IntelligentContextBundle {
  items: ContextItem[];
  totalCandidates: number;
  selectedItems: number;
  estimatedTokens: number;
  budget: ContextBudget;
  strategy: string;
  metrics: ContextMetrics;
  /** Compatibility projections for PR1 callers. Canonical consumers should use items. */
  files: import("../memory/types.js").ContextFile[];
  symbols: import("../memory/types.js").ContextSymbol[];
  relationships: import("../memory/types.js").ProjectEdge[];
}

export interface ContextSelectionObservation {
  taskId: string;
  request: string;
  selected: { id: string; score: number; reason: ContextReason }[];
  excludedCount: number;
  estimatedTokens: number;
  timestamp: string;
}

export const emptyReason = (): ContextReason => ({ lexical: 0, structural: 0, historical: 0, recency: 0, coChange: 0, memory: 0 });
