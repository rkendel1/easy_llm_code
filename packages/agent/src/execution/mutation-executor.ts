import type { ProjectMemory } from "../memory/project-memory.js";
import type { Project } from "../memory/types.js";
import type { AgentPlan } from "../planning/types.js";
import { applyValidatedMutation, restoreSnapshot } from "../mutation/apply.js";
import { DEFAULT_MUTATION_POLICY, type MutationPolicy, type MutationProposal, type MutationTransaction, type RepairAttempt, type TaskOutcome } from "../mutation/types.js";
import { validateMutation } from "../mutation/validate.js";
import { DEFAULT_EXECUTION_POLICY, type ExecutionPolicy, type VerificationRun } from "../verification/types.js";
import { runVerification } from "../verification/runner.js";

interface MutationExecutorOptions {
  root: string; project: Project; memory: ProjectMemory;
  mutationPolicy?: MutationPolicy; executionPolicy?: ExecutionPolicy; maxRepairAttempts?: number;
  repair?: (failure: VerificationRun, attempt: number) => Promise<MutationProposal>;
}
export interface MutationExecutionResult { outcome: TaskOutcome; proposal: MutationProposal; transaction?: MutationTransaction; verificationRuns: VerificationRun[] }

export const createMutationExecutor = (options: MutationExecutorOptions) => ({
  async execute(input: { proposal: MutationProposal; plan: AgentPlan; approved?: boolean }): Promise<MutationExecutionResult> {
    const started = Date.now(), policy = options.mutationPolicy ?? DEFAULT_MUTATION_POLICY, maxAttempts = 1 + (options.maxRepairAttempts ?? 2);
    let proposal = input.proposal, lastTransaction: MutationTransaction | undefined, totalLines = 0; const verificationRuns: VerificationRun[] = [];
    await options.memory.persistMutationProposal(proposal);
    if (policy.mode === "propose") {
      const outcome: TaskOutcome = { status: "partial", attempts: 0, filesChanged: proposal.files.length, linesChanged: 0, testsPassed: 0, testsFailed: 0, verificationPassed: false, durationMs: Date.now() - started };
      await options.memory.persistTaskOutcome(proposal.taskId, outcome); return { outcome, proposal, verificationRuns };
    }
    if (policy.mode === "approve" && !input.approved) throw new Error("APPROVAL_REQUIRED");
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const validation = await validateMutation(proposal, input.plan, options.root, policy); totalLines += validation.changedLines;
      if (!validation.valid) {
        const outcome: TaskOutcome = { status: "failure", attempts: attempt, filesChanged: 0, linesChanged: totalLines, testsPassed: 0, testsFailed: 0, verificationPassed: false, durationMs: Date.now() - started };
        await options.memory.persistTaskOutcome(proposal.taskId, outcome); await options.memory.upsertTask({ id: proposal.taskId, request: input.plan.objective, status: "failed", createdAt: new Date(started).toISOString(), completedAt: new Date().toISOString() });
        throw new Error(`MUTATION_REJECTED: ${validation.issues.map((issue) => issue.code).join(",")}`);
      }
      const applied = await applyValidatedMutation(options.root, proposal, validation); lastTransaction = applied.transaction;
      await options.memory.persistMutationTransaction(applied.transaction);
      const verification = await runVerification(options.project, proposal.taskId, proposal.id, proposal.verification, options.executionPolicy ?? DEFAULT_EXECUTION_POLICY);
      verificationRuns.push(verification); await options.memory.persistVerificationRun(verification);
      if (verification.passed) {
        applied.transaction.status = "verified"; applied.transaction.completedAt = new Date().toISOString(); await options.memory.persistMutationTransaction(applied.transaction);
        const passed = verification.results.filter((result) => result.status === "passed").length;
        const outcome: TaskOutcome = { status: "success", attempts: attempt, filesChanged: proposal.files.length, linesChanged: totalLines, testsPassed: passed, testsFailed: 0, verificationPassed: true, durationMs: Date.now() - started };
        await options.memory.persistTaskOutcome(proposal.taskId, outcome); await options.memory.upsertTask({ id: proposal.taskId, request: input.plan.objective, status: "completed", createdAt: new Date(started).toISOString(), completedAt: new Date().toISOString() });
        return { outcome, proposal, transaction: applied.transaction, verificationRuns };
      }
      await restoreSnapshot(options.root, applied.transaction, applied.snapshot); await options.memory.persistMutationTransaction(applied.transaction);
      const repair: RepairAttempt = { id: `repair:${proposal.taskId}:${attempt}`, taskId: proposal.taskId, attempt, proposalId: proposal.id, verificationRunId: verification.id, status: "failed" };
      await options.memory.persistRepairAttempt(repair);
      if (attempt >= maxAttempts || !options.repair) break;
      proposal = await options.repair(verification, attempt + 1); await options.memory.persistMutationProposal(proposal);
    }
    const testsPassed = verificationRuns.flatMap((run) => run.results).filter((result) => result.status === "passed").length;
    const testsFailed = verificationRuns.flatMap((run) => run.results).filter((result) => result.status !== "passed").length;
    const outcome: TaskOutcome = { status: "failure", attempts: verificationRuns.length, filesChanged: 0, linesChanged: totalLines, testsPassed, testsFailed, verificationPassed: false, durationMs: Date.now() - started };
    await options.memory.persistTaskOutcome(proposal.taskId, outcome); await options.memory.upsertTask({ id: proposal.taskId, request: input.plan.objective, status: "failed", createdAt: new Date(started).toISOString(), completedAt: new Date().toISOString() });
    await options.memory.recordObservation({ type: "warning", taskId: proposal.taskId, content: { code: "TASK_FAILED", attempts: verificationRuns.length }, timestamp: new Date().toISOString() });
    return { outcome, proposal, transaction: lastTransaction, verificationRuns };
  }
});
