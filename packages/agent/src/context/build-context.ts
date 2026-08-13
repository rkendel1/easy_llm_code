import type { ProjectMemory } from "../memory/project-memory.js";
import type { ContextFile, ContextSymbol, ProjectEdge } from "../memory/types.js";
import { DEFAULT_CONTEXT_BUDGET, estimateTokens, selectWithinBudget } from "./budget.js";
import { generateContextCandidates } from "./candidates.js";
import { DEFAULT_EXPANSION, expandContextGraph } from "./expansion.js";
import { DEFAULT_WEIGHTS, rankContextItems } from "./ranking.js";
import type { ContextBudget, ContextPolicy, ExpansionPolicy, IntelligentContextBundle, RankingWeights } from "./types.js";

interface ContextEngineOptions {
  memory: ProjectMemory;
  budget?: Partial<ContextBudget>;
  ranking?: Partial<RankingWeights>;
  expansion?: Partial<ExpansionPolicy>;
}

export const createContextEngine = (options: ContextEngineOptions) => {
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...options.budget };
  const weights = { ...DEFAULT_WEIGHTS, ...options.ranking };
  const expansion = { ...DEFAULT_EXPANSION, ...options.expansion };
  return {
    async build(input: { request: string; policy?: ContextPolicy; preferredFiles?: string[] }): Promise<IntelligentContextBundle> {
      const effectiveBudget = { ...budget, ...input.policy?.budget };
      if (input.policy?.target?.contextWindow && effectiveBudget.maxTokens === undefined) {
        effectiveBudget.maxTokens = Math.floor(input.policy.target.contextWindow * 0.5);
      }
      const discovered = await generateContextCandidates({ request: input.request, memory: options.memory, preferredFiles: input.preferredFiles });
      const candidates = expandContextGraph(discovered, expansion);
      const ranked = rankContextItems(candidates, weights);
      const items = selectWithinBudget(ranked, effectiveBudget);
      const characters = items.reduce((sum, item) => sum + item.content.length, 0);
      const rawCharacters = candidates.reduce((sum, item) => sum + item.content.length, 0);
      const files: ContextFile[] = items.filter((item) => item.type === "file" || item.type === "test").map((item) => ({
        id: item.id, path: String(item.metadata?.path ?? item.reference), language: item.metadata?.language as string | undefined,
        size: item.content.length, score: item.score, reason: String(item.metadata?.sourceReason ?? "context intelligence ranking")
      }));
      const symbols: ContextSymbol[] = items.filter((item) => item.type === "symbol").map((item) => ({
        id: item.id, fileId: String(item.metadata?.fileId ?? ""), name: item.reference,
        kind: item.metadata?.kind as ContextSymbol["kind"], score: item.score, reason: "context intelligence ranking"
      }));
      const relationships = items.filter((item) => item.type === "relationship").map((item) => ({
        id: item.id, from: String(item.metadata?.from), to: String(item.metadata?.to), relation: item.metadata?.relation,
        confidence: item.reason.structural, source: "agent"
      } as ProjectEdge));
      const estimatedTokens = estimateTokens(characters);
      return { items, totalCandidates: candidates.length, selectedItems: items.length, estimatedTokens, budget: effectiveBudget,
        strategy: "lexical+graph+history+memory/deterministic-v1", files, symbols, relationships,
        metrics: { candidateCount: candidates.length, selectedCount: items.length, characters, estimatedTokens,
          rawEstimatedTokens: estimateTokens(rawCharacters), compressionRatio: rawCharacters ? 1 - characters / rawCharacters : 0 } };
    }
  };
};
