import type { AutonomousBudget, AutonomyMode, RiskLevel } from "./types.js";

export const DEFAULT_AUTONOMOUS_BUDGET: Readonly<AutonomousBudget> = Object.freeze({ maxIterations: 8, maxMutations: 5, maxFilesChanged: 20, maxLinesChanged: 500, maxReplans: 2, maxRepairs: 2, maxVerificationTimeMs: 600_000, maxModelSpend: 1.50, maxWallClockMs: 1_800_000 });
export const requiresApproval = (mode: AutonomyMode, risk: RiskLevel, verificationStrong: boolean): boolean => {
  if (risk === "critical") return true;
  if (mode === "safe") return risk !== "low";
  if (mode === "standard") return risk === "high";
  return risk === "high" && !verificationStrong;
};
