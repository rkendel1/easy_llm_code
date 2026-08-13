import type { RiskAssessment, RiskInput, RiskLevel } from "./types.js";

const critical = /\b(database|migration|schema|security|credential|payment|billing|production)\b/i;
const sensitive = /\b(auth|session|token|permission|api|checkout)\b/i;
export const assessAutonomousRisk = (input: RiskInput): RiskAssessment => {
  const reasons: string[] = []; let score = 0;
  if (["bugfix", "feature", "refactor"].includes(input.profile.taskType)) score += .12;
  if (input.profile.estimatedComplexity === "high") { score += .20; reasons.push("high task complexity"); } else if (input.profile.estimatedComplexity === "medium") score += .10;
  if (input.files > 10 || input.impact.affectedFiles.length > 10) { score += .22; reasons.push("large predicted file impact"); } else if (input.files > 5 || input.impact.affectedFiles.length > 5) score += .12;
  if (input.lines > 300) { score += .18; reasons.push("large mutation"); } else if (input.lines > 100) score += .08;
  const scope = `${input.profile.subsystem ?? ""} ${input.impact.relatedSubsystems.join(" ")}`;
  if (critical.test(scope)) { score += .35; reasons.push("critical subsystem"); } else if (sensitive.test(scope)) { score += .17; reasons.push("sensitive subsystem"); }
  if (input.historicalFailureRate >= .4) { score += .20; reasons.push("high historical failure rate"); } else score += input.historicalFailureRate * .25;
  if (input.impact.confidence < .35) { score += .12; reasons.push("weak impact confidence"); }
  if (input.dependencyCount && input.dependencyCount > 8) { score += .10; reasons.push("broad dependency impact"); }
  const verificationStrength = input.verificationCommands >= 3 ? "strong" : input.verificationCommands >= 1 ? "moderate" : "weak";
  if (verificationStrength === "weak") { score += .15; reasons.push("weak verification coverage"); }
  score = Math.max(0, Math.min(1, score));
  const level: RiskLevel = score >= .80 ? "critical" : score >= .55 ? "high" : score >= .28 ? "medium" : "low";
  return { level, score, reasons: reasons.length ? reasons : ["bounded low-risk change"], verificationStrength, generatedAt: new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString() };
};
