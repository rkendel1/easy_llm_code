import { randomUUID } from "node:crypto";
import { llm as routedLlm } from "@easy-llm/llm";
import { createContextEngine } from "../context/build-context.js";
import type { IntelligentContextBundle } from "../context/types.js";
import { applyValidatedMutation, restoreSnapshot } from "../mutation/apply.js";
import { createMutationPlanner, type MutationLlm } from "../mutation/planner.js";
import type { MutationProposal, MutationTransaction, TaskOutcome, WorkspaceSnapshot } from "../mutation/types.js";
import { validateMutation } from "../mutation/validate.js";
import { createTaskPlanner, type PlannerLlm } from "../planning/planner.js";
import type { AgentPlan } from "../planning/types.js";
import { defaultApproval, type ApprovalHandler } from "../policy/approval.js";
import { DEFAULT_TASK_POLICY, type TaskPolicy } from "../policy/task-policy.js";
import type { ProjectMemory } from "../memory/project-memory.js";
import { runVerification } from "../verification/runner.js";
import type { VerificationRun } from "../verification/types.js";
import type { TaskCheckpoint } from "./checkpoint.js";
import type { AgentEvent, PersistedAgentEvent } from "./events.js";
import { classifyTaskFailure, type FailureClass, type TaskMode } from "./lifecycle.js";
import { transitionTaskState, type TaskState } from "./state-machine.js";

export interface TaskRunResult { taskId: string; state: TaskState; checkpoint: TaskCheckpoint; context?: IntelligentContextBundle; plan?: AgentPlan; proposal?: MutationProposal; outcome?: TaskOutcome; failureClass?: FailureClass; answer?: unknown }
export interface TaskRunnerOptions {
  root: string; memory: ProjectMemory; plannerLlm?: PlannerLlm; mutationLlm?: MutationLlm;
  askLlm?: (input: { request: string; context: IntelligentContextBundle }) => Promise<unknown>;
  policy?: Partial<TaskPolicy>; approval?: ApprovalHandler;
}

export const createTaskRunner = (options: TaskRunnerOptions) => {
  const subscribers = new Set<(event: AgentEvent) => void>(); let cancellationRequested = false, running = false;
  const policy: TaskPolicy = { ...DEFAULT_TASK_POLICY, ...options.policy,
    mutation: { ...DEFAULT_TASK_POLICY.mutation, ...options.policy?.mutation }, execution: { ...DEFAULT_TASK_POLICY.execution, ...options.policy?.execution } };
  const contextEngine = createContextEngine({ memory: options.memory });
  const planner = createTaskPlanner({ root: options.root, memory: options.memory, contextEngine, llm: options.plannerLlm });
  const mutationPlanner = createMutationPlanner({ root: options.root, memory: options.memory, llm: options.mutationLlm });
  let sequence = 0;
  const emit = async (taskId: string, event: AgentEvent): Promise<void> => {
    for (const subscriber of subscribers) subscriber(event);
    const stored: PersistedAgentEvent = { id: `task-event:${taskId}:${sequence}`, taskId, sequence: sequence++, timestamp: new Date().toISOString(), event };
    await options.memory.recordTaskEvent(stored);
  };
  const save = async (taskId: string, state: TaskState, attempt: number, prior: Partial<TaskCheckpoint> = {}): Promise<TaskCheckpoint> => {
    const checkpoint: TaskCheckpoint = { ...prior, taskId, state, attempt, updatedAt: new Date().toISOString() };
    await options.memory.persistTaskCheckpoint(checkpoint); return checkpoint;
  };
  const setState = async (taskId: string, request: string, createdAt: string, checkpoint: TaskCheckpoint, next: TaskState, fields: Partial<TaskCheckpoint> = {}): Promise<TaskCheckpoint> => {
    transitionTaskState(checkpoint.state, next);
    await options.memory.upsertTask({ id: taskId, request, status: next, createdAt, completedAt: ["completed", "failed", "cancelled"].includes(next) ? new Date().toISOString() : undefined });
    return save(taskId, next, fields.attempt ?? checkpoint.attempt, { ...checkpoint, ...fields, resumeState: next === "paused" ? fields.resumeState : undefined });
  };
  const pauseAtBoundary = async (taskId: string, request: string, createdAt: string, checkpoint: TaskCheckpoint): Promise<TaskCheckpoint | undefined> => {
    if (!cancellationRequested) return undefined;
    const resumeState = checkpoint.state; const paused = await setState(taskId, request, createdAt, checkpoint, "paused", { resumeState });
    await emit(taskId, { type: "task.paused", taskId }); return paused;
  };
  const complete = async (taskId: string, request: string, createdAt: string, checkpoint: TaskCheckpoint, outcome?: TaskOutcome): Promise<TaskRunResult> => {
    const completed = await setState(taskId, request, createdAt, checkpoint, "completed"); if (outcome) await options.memory.persistTaskOutcome(taskId, outcome);
    await emit(taskId, { type: "task.completed", taskId }); return { taskId, state: "completed", checkpoint: completed, outcome };
  };
  const fail = async (taskId: string, request: string, createdAt: string, checkpoint: TaskCheckpoint, error: unknown): Promise<TaskRunResult> => {
    const reason = (error as Error).message, failureClass = classifyTaskFailure(error); const failed = await setState(taskId, request, createdAt, checkpoint, "failed");
    const outcome: TaskOutcome = { status: "failure", attempts: checkpoint.attempt + 1, filesChanged: 0, linesChanged: 0, testsPassed: 0, testsFailed: failureClass === "verification" ? 1 : 0, verificationPassed: false, durationMs: Date.now() - Date.parse(createdAt) };
    await options.memory.persistTaskOutcome(taskId, outcome); await options.memory.recordObservation({ type: "warning", taskId, content: { failureClass, reason }, timestamp: new Date().toISOString() }); await emit(taskId, { type: "task.failed", taskId, reason });
    return { taskId, state: "failed", checkpoint: failed, failureClass, outcome };
  };

  const executeFromMutation = async (args: { taskId: string; request: string; createdAt: string; checkpoint: TaskCheckpoint; plan: AgentPlan; proposal: MutationProposal; context?: IntelligentContextBundle; transaction?: MutationTransaction; snapshot?: WorkspaceSnapshot }): Promise<TaskRunResult> => {
    let { checkpoint, proposal } = args; let transaction = args.transaction, snapshot = args.snapshot, context = args.context;
    while (checkpoint.attempt <= policy.maxRepairAttempts) {
      if (checkpoint.state === "mutating") {
        await emit(args.taskId, { type: "mutation.started" });
        const validation = await validateMutation(proposal, args.plan, options.root, policy.mutation);
        if (!validation.valid) throw new Error(`MUTATION_REJECTED: ${validation.issues.map((issue) => issue.code).join(",")}`);
        const applied = await applyValidatedMutation(options.root, proposal, validation); transaction = applied.transaction; snapshot = applied.snapshot;
        await options.memory.persistMutationTransaction(transaction);
        checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "verifying", { proposalId: proposal.id, transactionId: transaction.id, snapshot });
        await emit(args.taskId, { type: "mutation.completed", files: proposal.files.map((file) => file.path) });
        const paused = await pauseAtBoundary(args.taskId, args.request, args.createdAt, checkpoint); if (paused) return { taskId: args.taskId, state: "paused", checkpoint: paused, plan: args.plan, proposal };
      }
      if (checkpoint.state === "verifying") {
        if (!transaction || !snapshot) throw new Error("RESUME_DATA_MISSING: transaction snapshot");
        for (const step of proposal.verification) await emit(args.taskId, { type: "verification.started", command: step.command });
        const verification = await runVerification(await options.memory.getProject(), args.taskId, proposal.id, proposal.verification, policy.execution);
        await options.memory.persistVerificationRun(verification); await emit(args.taskId, { type: "verification.completed", success: verification.passed });
        if (verification.passed) {
          const paused = await pauseAtBoundary(args.taskId, args.request, args.createdAt, checkpoint); if (paused) return { taskId: args.taskId, state: "paused", checkpoint: paused, plan: args.plan, proposal };
          transaction.status = "verified"; transaction.completedAt = new Date().toISOString(); await options.memory.persistMutationTransaction(transaction);
          const outcome: TaskOutcome = { status: "success", attempts: checkpoint.attempt + 1, filesChanged: proposal.files.length,
            linesChanged: proposal.files.reduce((sum, file) => sum + file.patch.split("\n").filter((line) => /^[+-](?![+-])/.test(line)).length, 0),
            testsPassed: verification.results.filter((result) => result.status === "passed").length, testsFailed: 0, verificationPassed: true, durationMs: Date.now() - Date.parse(args.createdAt) };
          if (checkpoint.attempt > 0) await options.memory.persistRepairAttempt({ id: `repair:${args.taskId}:${checkpoint.attempt}`, taskId: args.taskId, attempt: checkpoint.attempt, proposalId: proposal.id, verificationRunId: verification.id, status: "passed" });
          return complete(args.taskId, args.request, args.createdAt, checkpoint, outcome);
        }
        await restoreSnapshot(options.root, transaction, snapshot); await options.memory.persistMutationTransaction(transaction);
        await options.memory.persistRepairAttempt({ id: `repair:${args.taskId}:${checkpoint.attempt}`, taskId: args.taskId, attempt: checkpoint.attempt, proposalId: proposal.id, verificationRunId: verification.id, status: "failed" });
        checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "repairing", { lastVerificationId: verification.id, snapshot: undefined, transactionId: undefined });
        if (checkpoint.attempt >= policy.maxRepairAttempts) return fail(args.taskId, args.request, args.createdAt, checkpoint, new Error(`TASK_FAILED: verification failed after ${checkpoint.attempt + 1} attempts`));
        const paused = await pauseAtBoundary(args.taskId, args.request, args.createdAt, checkpoint); if (paused) return { taskId: args.taskId, state: "paused", checkpoint: paused, plan: args.plan, proposal };
      }
      if (checkpoint.state === "repairing") {
        const runs = await options.memory.getVerificationRuns(args.taskId), failure = runs.find((run) => run.id === checkpoint.lastVerificationId) ?? runs.at(-1);
        if (!failure) throw new Error("RESUME_DATA_MISSING: verification failure");
        await emit(args.taskId, { type: "repair.started", attempt: checkpoint.attempt + 1 });
        context = await contextEngine.build({ request: `${args.request}\nRepair: ${JSON.stringify(failure.results.map((result) => ({ classification: result.classification, stderr: result.stderr.slice(0, 1000) })))}` });
        proposal = await mutationPlanner.propose(args.plan, context, failure);
        await options.memory.persistRepairAttempt({ id: `repair:${args.taskId}:${checkpoint.attempt + 1}`, taskId: args.taskId, attempt: checkpoint.attempt + 1, proposalId: proposal.id, verificationRunId: failure.id, status: "proposed" });
        checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "mutating", { attempt: checkpoint.attempt + 1, proposalId: proposal.id }); checkpoint.attempt += 0;
      }
    }
    return fail(args.taskId, args.request, args.createdAt, checkpoint, new Error("TASK_FAILED: repair attempts exhausted"));
  };

  const start = async (request: string, mode: TaskMode, identity?: { taskId: string; createdAt: string; checkpoint: TaskCheckpoint }): Promise<TaskRunResult> => {
    if (running) throw new Error("TASK_RUNNER_BUSY"); running = true; cancellationRequested = false; sequence = 0;
    const taskId = identity?.taskId ?? randomUUID(), createdAt = identity?.createdAt ?? new Date().toISOString(); let checkpoint = identity?.checkpoint ?? await save(taskId, "created", 0, { mode });
    if (!identity) { await options.memory.upsertTask({ id: taskId, request, status: "created", createdAt }); await emit(taskId, { type: "task.started", taskId }); }
    try {
      if (checkpoint.state === "created") checkpoint = await setState(taskId, request, createdAt, checkpoint, "contextualizing", { mode });
      await emit(taskId, { type: "context.started" });
      const context = await contextEngine.build({ request }); await emit(taskId, { type: "context.completed", metrics: context.metrics });
      const contextPause = await pauseAtBoundary(taskId, request, createdAt, checkpoint); if (contextPause) return { taskId, state: "paused", checkpoint: contextPause, context };
      if (mode === "ask") {
        const answer = options.askLlm ? await options.askLlm({ request, context }) : await routedLlm({ task: "analysis", messages: [{ role: "user", content: `${request}\n\nContext: ${JSON.stringify(context)}` }] } as never);
        await options.memory.recordObservation({ type: "agent_analysis", taskId, content: answer, timestamp: new Date().toISOString(), relatedFiles: context.files.map((file) => file.id) });
        const result = await complete(taskId, request, createdAt, checkpoint, { status: "success", attempts: 0, filesChanged: 0, linesChanged: 0, testsPassed: 0, testsFailed: 0, verificationPassed: true, durationMs: Date.now() - Date.parse(createdAt) }); return { ...result, context, answer };
      }
      if (checkpoint.state !== "planning") checkpoint = await setState(taskId, request, createdAt, checkpoint, "planning", { contextSelectionId: `context-selection:${taskId}` });
      await emit(taskId, { type: "planning.started" });
      const planned = await planner.plan(request, { taskId, context, createdAt }); await emit(taskId, { type: "plan.created", planId: planned.plan.id });
      checkpoint = await save(taskId, checkpoint.state, checkpoint.attempt, { ...checkpoint, planId: planned.plan.id });
      const planningPause = await pauseAtBoundary(taskId, request, createdAt, checkpoint); if (planningPause) return { taskId, state: "paused", checkpoint: planningPause, context, plan: planned.plan };
      if (mode === "plan") { const result = await complete(taskId, request, createdAt, checkpoint); return { ...result, context, plan: planned.plan }; }
      const proposal = await mutationPlanner.propose(planned.plan, context);
      checkpoint = await setState(taskId, request, createdAt, checkpoint, "awaiting_approval", { planId: planned.plan.id, proposalId: proposal.id }); await emit(taskId, { type: "approval.required" });
      const decision = await (options.approval ?? defaultApproval)({ proposal, plan: planned.plan, mode });
      if (decision === "rejected") { const cancelled = await setState(taskId, request, createdAt, checkpoint, "cancelled"); return { taskId, state: "cancelled", checkpoint: cancelled, context, plan: planned.plan, proposal }; }
      if (decision === "paused" || cancellationRequested) { cancellationRequested = true; const paused = await pauseAtBoundary(taskId, request, createdAt, checkpoint); return { taskId, state: "paused", checkpoint: paused!, context, plan: planned.plan, proposal }; }
      checkpoint = await setState(taskId, request, createdAt, checkpoint, "mutating");
      return await executeFromMutation({ taskId, request, createdAt, checkpoint, plan: planned.plan, proposal, context });
    } catch (error) { return fail(taskId, request, createdAt, checkpoint, error); }
    finally { running = false; }
  };

  const resume = async (taskId: string): Promise<TaskRunResult> => {
    if (running) throw new Error("TASK_RUNNER_BUSY"); running = true; cancellationRequested = false;
    try {
      const [stored, task, existingEvents] = await Promise.all([options.memory.getTaskCheckpoint(taskId), options.memory.getTask(taskId), options.memory.getTaskEvents(taskId)]);
      if (!stored || !task) throw new Error(`TASK_NOT_FOUND: ${taskId}`); sequence = (existingEvents.at(-1)?.sequence ?? -1) + 1;
      if (["completed", "failed", "cancelled"].includes(stored.state)) return { taskId, state: stored.state, checkpoint: stored, outcome: await options.memory.getTaskOutcome(taskId) };
      const createdAt = task.task.createdAt, request = task.task.request; let checkpoint = stored;
      if (checkpoint.state === "paused") { const target = checkpoint.resumeState ?? "contextualizing"; checkpoint = await setState(taskId, request, createdAt, checkpoint, target); }
      let plan: AgentPlan | undefined, proposal: MutationProposal | undefined;
      if (checkpoint.state === "planning" && checkpoint.planId) {
        plan = await options.memory.getPlan(checkpoint.planId); if (!plan) throw new Error("RESUME_DATA_MISSING: plan");
        const context = await contextEngine.build({ request }); proposal = await mutationPlanner.propose(plan, context);
        checkpoint = await setState(taskId, request, createdAt, checkpoint, "awaiting_approval", { proposalId: proposal.id }); await emit(taskId, { type: "approval.required" });
      } else if (["created", "contextualizing", "planning"].includes(checkpoint.state)) { running = false; return start(request, checkpoint.mode ?? "ask", { taskId, createdAt, checkpoint }); }
      plan ??= checkpoint.planId ? await options.memory.getPlan(checkpoint.planId) : await options.memory.findPlanForTask(taskId);
      proposal ??= checkpoint.proposalId ? await options.memory.getMutationProposal(checkpoint.proposalId) : plan ? await options.memory.findMutationForPlan(plan.id) : undefined;
      if (!plan || !proposal) throw new Error("RESUME_DATA_MISSING: plan or proposal");
      if (checkpoint.state === "awaiting_approval") {
        await emit(taskId, { type: "approval.required" }); const decision = await (options.approval ?? defaultApproval)({ proposal, plan, mode: checkpoint.mode ?? "edit" });
        if (decision !== "approved") { cancellationRequested = true; const paused = await pauseAtBoundary(taskId, request, createdAt, checkpoint); return { taskId, state: "paused", checkpoint: paused!, plan, proposal }; }
        checkpoint = await setState(taskId, request, createdAt, checkpoint, "mutating");
      }
      const transaction = checkpoint.transactionId ? (await options.memory.getMutationTransactions(taskId)).find((item) => item.id === checkpoint.transactionId) : undefined;
      return executeFromMutation({ taskId, request, createdAt, checkpoint, plan, proposal, transaction, snapshot: checkpoint.snapshot });
    } catch (error) {
      const checkpoint = await options.memory.getTaskCheckpoint(taskId); const task = await options.memory.getTask(taskId); if (!checkpoint || !task) throw error; return fail(taskId, task.task.request, task.task.createdAt, checkpoint, error);
    } finally { running = false; }
  };

  return { run: (input: { request: string; mode?: TaskMode }) => start(input.request, input.mode ?? "ask"), resume,
    cancel: () => { cancellationRequested = true; }, subscribe(listener: (event: AgentEvent) => void) { subscribers.add(listener); return () => subscribers.delete(listener); } };
};
