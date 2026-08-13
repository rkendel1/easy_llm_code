import type { ContextBudget, ContextItem } from "./types.js";

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = { maxItems: 30, maxCharacters: 60_000 };
export const estimateTokens = (characters: number): number => Math.ceil(characters / 4);

export const selectWithinBudget = (ranked: ContextItem[], budget: ContextBudget): ContextItem[] => {
  const selected: ContextItem[] = [];
  let characters = 0;
  for (const item of ranked) {
    const size = item.content.length;
    if (selected.length >= budget.maxItems || characters + size > budget.maxCharacters) continue;
    if (budget.maxTokens !== undefined && estimateTokens(characters + size) > budget.maxTokens) continue;
    selected.push(item); characters += size;
  }
  return selected;
};
