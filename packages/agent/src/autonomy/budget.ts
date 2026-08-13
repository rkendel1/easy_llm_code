import type { AutonomousBudget, BudgetRemaining, BudgetUsage } from "./types.js";

export const emptyBudgetUsage = (): BudgetUsage => ({ iterations: 0, mutations: 0, filesChanged: 0, linesChanged: 0, replans: 0, repairs: 0, verificationTimeMs: 0, modelSpend: 0, wallClockMs: 0 });
export const remainingBudget = (budget: AutonomousBudget, usage: BudgetUsage): BudgetRemaining => ({ iterations: budget.maxIterations - usage.iterations, mutations: budget.maxMutations - usage.mutations, filesChanged: budget.maxFilesChanged - usage.filesChanged, linesChanged: budget.maxLinesChanged - usage.linesChanged, replans: budget.maxReplans - usage.replans, repairs: budget.maxRepairs - usage.repairs, verificationTimeMs: budget.maxVerificationTimeMs - usage.verificationTimeMs, modelSpend: budget.maxModelSpend - usage.modelSpend, wallClockMs: budget.maxWallClockMs - usage.wallClockMs });
export const exhaustedDimensions = (budget: AutonomousBudget, usage: BudgetUsage): string[] => Object.entries(remainingBudget(budget, usage)).filter(([, value]) => value < 0).map(([key]) => key).sort();
export const nearBudgetLimit = (budget: AutonomousBudget, usage: BudgetUsage): string[] => {
  const remaining = remainingBudget(budget, usage), maxima: Record<keyof BudgetUsage, number> = { iterations: budget.maxIterations, mutations: budget.maxMutations, filesChanged: budget.maxFilesChanged, linesChanged: budget.maxLinesChanged, replans: budget.maxReplans, repairs: budget.maxRepairs, verificationTimeMs: budget.maxVerificationTimeMs, modelSpend: budget.maxModelSpend, wallClockMs: budget.maxWallClockMs };
  return (Object.keys(remaining) as (keyof BudgetUsage)[]).filter((key) => remaining[key] > 0 && remaining[key] <= maxima[key] * .2).sort();
};
