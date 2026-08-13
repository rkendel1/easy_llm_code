import type { ContextItem, ContextItemType, RankingWeights } from "./types.js";

export const DEFAULT_WEIGHTS: RankingWeights = {
  lexical: 0.30, structural: 0.25, historical: 0.15,
  recency: 0.10, coChange: 0.10, memory: 0.10
};

const TYPE_PRIORITY: Record<ContextItemType, number> = {
  file: 0, test: 1, symbol: 2, relationship: 3, commit: 4, change: 5, observation: 6
};
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export const scoreContextItem = (item: ContextItem, weights: RankingWeights = DEFAULT_WEIGHTS): ContextItem => ({
  ...item,
  reason: Object.fromEntries(Object.entries(item.reason).map(([key, value]) => [key, clamp(value)])) as unknown as ContextItem["reason"],
  score: clamp(item.reason.lexical) * weights.lexical + clamp(item.reason.structural) * weights.structural +
    clamp(item.reason.historical) * weights.historical + clamp(item.reason.recency) * weights.recency +
    clamp(item.reason.coChange) * weights.coChange + clamp(item.reason.memory) * weights.memory
});

export const rankContextItems = (items: ContextItem[], weights: RankingWeights = DEFAULT_WEIGHTS): ContextItem[] =>
  items.map((item) => scoreContextItem(item, weights)).sort((a, b) =>
    b.score - a.score || TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] ||
    a.reference.localeCompare(b.reference) || a.id.localeCompare(b.id));
