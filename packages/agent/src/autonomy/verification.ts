import type { Project } from "../memory/types.js";
import { runVerification } from "../verification/runner.js";
import { detectVerificationCommands } from "../verification/policy.js";
import type { ExecutionPolicy, VerificationRun, VerificationStep, VerificationScope } from "../verification/types.js";
import type { RiskLevel } from "./types.js";

const scopeOf = (step: VerificationStep): VerificationScope => /lint|syntax/i.test(`${step.id} ${step.command} ${step.purpose}`) ? "syntax" : /typecheck|tsc/i.test(`${step.id} ${step.command} ${step.purpose}`) ? "type" : /test/i.test(`${step.id} ${step.command} ${step.purpose}`) ? "targeted" : /build/i.test(`${step.id} ${step.command} ${step.purpose}`) ? "package" : "affected";
const order: VerificationScope[] = ["syntax", "type", "targeted", "affected", "package", "full"];
export interface LayeredVerificationResult { runs: VerificationRun[]; final: VerificationRun; escalations: { from: VerificationScope; to: VerificationScope; reason: string }[] }
export const runLayeredVerification = async (project: Project, taskId: string, proposalId: string, requested: VerificationStep[], policy: ExecutionPolicy, options: { risk?: RiskLevel } = {}): Promise<LayeredVerificationResult> => {
  const trusted = options.risk === "high" || options.risk === "critical" ? await detectVerificationCommands(project) : [], selected = [...requested];
  for (const command of trusted) if (!selected.some((item) => item.command === command.command)) selected.push(command);
  const grouped = new Map<VerificationScope, VerificationStep[]>(); for (const step of selected) grouped.set(scopeOf(step), [...(grouped.get(scopeOf(step)) ?? []), step]);
  const scopes = order.filter((scope) => grouped.has(scope)), runs: VerificationRun[] = [], escalations: { from: VerificationScope; to: VerificationScope; reason: string }[] = [];
  for (const [index, scope] of scopes.entries()) {
    const run = await runVerification(project, taskId, proposalId, grouped.get(scope)!, policy); run.verificationScope = scope; run.verificationReason = index ? `escalated from ${scopes[index - 1]}` : "smallest sufficient trusted verification layer"; runs.push(run);
    if (!run.passed && scopes[index + 1]) escalations.push({ from: scope, to: scopes[index + 1], reason: "earlier verification layer failed" });
    if (!run.passed && !scopes[index + 1]) break;
  }
  if (!runs.length) { const run = await runVerification(project, taskId, proposalId, requested, policy); run.verificationScope = "targeted"; run.verificationReason = "proposal verification"; runs.push(run); }
  const hardFailures = runs.filter((run) => (run.verificationScope === "syntax" || run.verificationScope === "type") && !run.passed);
  if (hardFailures.length) { const final = runs.at(-1)!; final.passed = false; final.results = runs.flatMap((run) => run.results); final.verificationReason = `${final.verificationReason}; syntax/type failure cannot be masked by broader verification`; }
  return { runs, final: runs.at(-1)!, escalations };
};
