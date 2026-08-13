import { randomUUID } from "node:crypto";
import type { ModelDefinition } from "@easy-llm/llm";
import { invokeModel } from "../model/llm-cx.js";
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
import type { VerificationRun } from "../verification/types.js";
import { detectVerificationCommands } from "../verification/policy.js";
import type { TaskCheckpoint } from "./checkpoint.js";
import type { AgentEvent, PersistedAgentEvent, RuntimeEvent } from "./events.js";
import { classifyTaskFailure, type FailureClass, type TaskMode } from "./lifecycle.js";
import { transitionTaskState, type TaskState } from "./state-machine.js";
import { createTaskProfile, type TaskProfile } from "../intelligence/task-profile.js";
import { buildMemoryRecommendations } from "../intelligence/recommendations.js";
import { rankSuccessfulPatterns } from "../memory/successful-patterns.js";
import { rankFailurePatterns } from "../memory/failure-patterns.js";
import { selectRuntimeModel } from "../routing/cx-selector.js";
import type { RoutingDecision } from "../routing/decision.js";
import { executeWithModelFallback } from "../routing/fallback.js";
import { createChangeIntelligence } from "../change-intelligence/analyze-impact.js";
import { recordImpactFeedback } from "../change-intelligence/feedback.js";
import type { ImpactPrediction } from "../change-intelligence/types.js";
import { createAutonomousController } from "../autonomy/controller.js";
import { emptyBudgetUsage } from "../autonomy/budget.js";
import { checkPlanAssumptions } from "../autonomy/assumptions.js";
import { runLayeredVerification } from "../autonomy/verification.js";
import { reviewExecution } from "../autonomy/review.js";
import type { AutonomousBudget, AutonomousExecution, AutonomyMode, BudgetUsage, RiskAssessment } from "../autonomy/types.js";
import { refreshContext } from "../autonomy/context-refresh.js";
import { SandboxManager } from "../sandbox/core/sandbox-manager.js";
import { LocalProcessSandboxProvider } from "../sandbox/providers/local/local-process-provider.js";
import type { ResourceLimits, Sandbox, SandboxPolicy } from "../sandbox/core/sandbox-types.js";

export interface TaskRunResult { taskId: string; state: TaskState; checkpoint: TaskCheckpoint; context?: IntelligentContextBundle; impact?: ImpactPrediction; plan?: AgentPlan; proposal?: MutationProposal; outcome?: TaskOutcome; failureClass?: FailureClass; answer?: unknown }
export interface TaskRunnerOptions {
  root: string; memory: ProjectMemory; plannerLlm?: PlannerLlm; mutationLlm?: MutationLlm;
  askLlm?: (input: { request: string; context: IntelligentContextBundle; model?: string }) => Promise<unknown>;
  policy?: Partial<TaskPolicy>; approval?: ApprovalHandler;
  routing?: { budget?: number; model?: string; models?: ModelDefinition[] };
  autonomy?: { mode?: AutonomyMode; budget?: Partial<AutonomousBudget> };
  sandbox?: { enabled?: boolean; manager?: SandboxManager; policy?: Partial<SandboxPolicy>; limits?: Partial<ResourceLimits> };
  verification?: { enabled?: boolean };
}

export const createTaskRunner = (options: TaskRunnerOptions) => {
  const subscribers = new Set<(event: RuntimeEvent) => void>(); let cancellationRequested = false, running = false;
  const policy: TaskPolicy = { ...DEFAULT_TASK_POLICY, ...options.policy,
    mutation: { ...DEFAULT_TASK_POLICY.mutation, ...options.policy?.mutation }, execution: { ...DEFAULT_TASK_POLICY.execution, ...options.policy?.execution } };
  const contextEngine = createContextEngine({ memory: options.memory });
  let planner = createTaskPlanner({ root: options.root, memory: options.memory, contextEngine, llm: options.plannerLlm });
  let mutationPlanner = createMutationPlanner({ root: options.root, memory: options.memory, llm: options.mutationLlm });
  const sandboxManager = options.sandbox?.manager ?? new SandboxManager({ memory: options.memory, provider: new LocalProcessSandboxProvider(), policy: options.sandbox?.policy, limits: options.sandbox?.limits });
  sandboxManager.subscribe((event) => { for (const subscriber of subscribers) subscriber(event); });
  const changeIntelligence = createChangeIntelligence({ memory: options.memory });
  let autonomousController = createAutonomousController({ memory: options.memory, mode: options.autonomy?.mode, budget: options.autonomy?.budget });
  let sequence = 0;
  const injectedModel: ModelDefinition | undefined = !options.routing?.models && (options.plannerLlm || options.mutationLlm || options.askLlm) ? {
    id: "injected:custom", provider: "injected", name: "Injected task-runner model", capabilities: { reasoning: true, tools: true, vision: true, audio: false, structuredOutput: true, embeddings: false },
    context: { input: 1_000_000 }, availability: { online: true, status: "available" }, lifecycle: { status: "stable", lastVerifiedAt: new Date().toISOString() }, metadata: {}
  } : undefined;
  let activeProfile: TaskProfile | undefined, activeDecision: RoutingDecision | undefined, activeContext: IntelligentContextBundle | undefined;
  let activePlan: AgentPlan | undefined, activeProposal: MutationProposal | undefined;
  let activeImpact: ImpactPrediction | undefined;
  let activeExecution: AutonomousExecution | undefined, activeRisk: RiskAssessment | undefined, activeUsage: BudgetUsage = emptyBudgetUsage();
  let activeReviewFailure = false;
  let activeImpactExpanded = false;
  let activeSandbox: Sandbox | undefined;
  const approvalEvent = (proposal: MutationProposal): AgentEvent => ({ type: "approval.required", mutationId: proposal.id, files: proposal.files.map((file) => file.path), verificationPlan: proposal.verification.map((step) => step.command), ...(activeSandbox ? { sandboxId: activeSandbox.id } : {}), ...(activeRisk ? { risk: activeRisk } : {}), ...(activeImpact ? { impact: activeImpact } : {}) });
  let activeRunStartedAt = Date.now(), activeBaseWallClockMs = 0;
  const emit = async (taskId: string, event: AgentEvent): Promise<void> => {
    for (const subscriber of subscribers) subscriber(event);
    const stored: PersistedAgentEvent = { id: `task-event:${taskId}:${sequence}`, taskId, sequence: sequence++, timestamp: new Date().toISOString(), event };
    await options.memory.recordTaskEvent(stored);
  };
  const save = async (taskId: string, state: TaskState, attempt: number, prior: Partial<TaskCheckpoint> = {}): Promise<TaskCheckpoint> => {
    const checkpoint: TaskCheckpoint = { ...prior, taskId, state, attempt, updatedAt: new Date().toISOString() };
    await options.memory.persistTaskCheckpoint(checkpoint); return checkpoint;
  };
  const bindSandboxWorkspace = async (sandbox: Sandbox): Promise<string> => { const root = await sandboxManager.workspacePath(sandbox.id); planner = createTaskPlanner({ root, memory: options.memory, contextEngine, llm: options.plannerLlm }); mutationPlanner = createMutationPlanner({ root, memory: options.memory, llm: options.mutationLlm }); return root; };
  const verificationExecutor = () => activeSandbox ? { execute: async (command: { executable: string; args: string[]; command: string; timeoutMs: number }) => { const result = await sandboxManager.execute(activeSandbox!.id, { executable: command.executable, args: command.args, timeoutMs: command.timeoutMs }); return { stepId: "", command: command.command, status: result.status === "completed" ? "passed" as const : result.status === "timed_out" ? "timed_out" as const : result.status === "blocked" ? "denied" as const : "failed" as const, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, classification: result.failureReason }; } } : undefined;
  const setState = async (taskId: string, request: string, createdAt: string, checkpoint: TaskCheckpoint, next: TaskState, fields: Partial<TaskCheckpoint> = {}): Promise<TaskCheckpoint> => {
    transitionTaskState(checkpoint.state, next);
    await options.memory.upsertTask({ id: taskId, request, status: next, createdAt, completedAt: ["completed", "failed", "cancelled"].includes(next) ? new Date().toISOString() : undefined });
    return save(taskId, next, fields.attempt ?? checkpoint.attempt, { ...checkpoint, ...fields, resumeState: next === "paused" ? fields.resumeState : undefined });
  };
  const ensureSandbox = async (taskId: string, mode: TaskMode, checkpoint: TaskCheckpoint): Promise<TaskCheckpoint> => {
    if ((mode !== "edit" && mode !== "auto") || options.sandbox?.enabled === false) return checkpoint;
    if (checkpoint.sandboxId) {
      activeSandbox = await options.memory.getSandbox(checkpoint.sandboxId);
      if (!activeSandbox) throw new Error(`SANDBOX_NOT_FOUND: ${checkpoint.sandboxId}`);
      activeSandbox = await sandboxManager.resume(activeSandbox.id);
      await bindSandboxWorkspace(activeSandbox); return checkpoint;
    }
    const project = await options.memory.getProject(); activeSandbox = await sandboxManager.create({ taskId, projectId: project.id, repositoryPath: options.root }); activeSandbox = await sandboxManager.prepare(activeSandbox.id, { languages: project.detectedLanguages }); activeSandbox = await sandboxManager.start(activeSandbox.id); await bindSandboxWorkspace(activeSandbox);
    return save(taskId, checkpoint.state, checkpoint.attempt, { ...checkpoint, sandboxId: activeSandbox.id, sandboxSnapshotId: activeSandbox.snapshot?.id });
  };
  const pauseAtBoundary = async (taskId: string, request: string, createdAt: string, checkpoint: TaskCheckpoint): Promise<TaskCheckpoint | undefined> => {
    if (!cancellationRequested) return undefined;
    const resumeState = checkpoint.state; if (activeSandbox?.status === "running") activeSandbox = await sandboxManager.pause(activeSandbox.id); const paused = await setState(taskId, request, createdAt, checkpoint, "paused", { resumeState });
    await emit(taskId, { type: "task.paused", taskId }); return paused;
  };
  const recordIntelligence = async (taskId: string, request: string, outcome: TaskOutcome, failureClass?: FailureClass, failureReason?: string): Promise<void> => {
    if (!activeProfile || !activeDecision) return;
    const project = await options.memory.getProject(), executions = await options.memory.getModelExecutions(taskId), execution = executions.at(-1), timestamp = new Date().toISOString();
    await options.memory.persistOutcomeSignal({ taskId, repositoryId: project.id, taskType: activeProfile.taskType, languages: activeProfile.languages, frameworks: activeProfile.frameworks,
      subsystem: activeProfile.subsystem, complexity: activeProfile.estimatedComplexity, model: execution?.model ?? activeDecision.selectedModel,
      provider: execution?.provider ?? activeDecision.selectedProvider, success: outcome.status === "success", repaired: outcome.attempts > 1, attempts: outcome.attempts,
      verificationPassed: outcome.verificationPassed, failureClass, cost: execution?.estimatedCost ?? activeDecision.estimatedCost, latencyMs: execution?.latencyMs, timestamp });
    if (activeContext) {
      const strategies = [
        ["lexical", "lexical"], ["graph", "structural"], ["history", "historical"], ["cochange", "coChange"], ["memory", "memory"]
      ] as const;
      for (const [strategy, reason] of strategies) {
        const selectedItems = activeContext.items.filter((item) => item.reason[reason] > 0).length;
        if (selectedItems) await options.memory.persistContextOutcome({ taskId, strategy, selectedItems, tokenCount: Math.round(activeContext.estimatedTokens * selectedItems / Math.max(1, activeContext.selectedItems)), outcome: outcome.status === "success" ? "success" : "failure", usefulness: outcome.status === "success" ? 1 : 0 });
      }
    }
    if (outcome.status === "success") await options.memory.persistSuccessfulPattern({ id: `successful-pattern:${taskId}`, repositoryId: project.id, taskId,
      taskType: activeProfile.taskType, subsystem: activeProfile.subsystem, summary: request, files: activeProposal?.files.map((file) => file.path) ?? activePlan?.expectedFiles ?? [],
      approach: activePlan?.steps.map((step) => step.description).join("; ") || request, verification: activeProposal?.verification.map((step) => step.command) ?? activePlan?.verification.map((step) => step.description) ?? [],
      model: activeDecision.selectedModel, outcome, timestamp });
    else await options.memory.persistFailurePattern({ id: `failure-pattern:${taskId}`, repositoryId: project.id, taskId, taskType: activeProfile.taskType,
      subsystem: activeProfile.subsystem, failureClass: failureClass ?? "unknown", description: failureReason ?? "task failed", attemptedApproach: activePlan?.steps.map((step) => step.description).join("; ") || request,
      failedFiles: activeProposal?.files.map((file) => file.path) ?? activePlan?.expectedFiles ?? [], repair: outcome.attempts > 1 ? `${outcome.attempts - 1} repair attempt(s)` : undefined, timestamp });
  };
  const complete = async (taskId: string, request: string, createdAt: string, checkpoint: TaskCheckpoint, outcome?: TaskOutcome): Promise<TaskRunResult> => {
    if (activeSandbox && activeSandbox.status !== "destroyed") await sandboxManager.snapshot(activeSandbox.id, "task-completion");
    const completed = await setState(taskId, request, createdAt, checkpoint, "completed"); if (outcome) await options.memory.persistTaskOutcome(taskId, outcome);
    if (outcome) await recordIntelligence(taskId, request, outcome);
    if (outcome && activeImpact && activeProposal) await recordImpactFeedback(options.memory, activeImpact, activeProposal.files.map((file) => file.path), outcome.verificationPassed, outcome.status === "success");
    if (activeExecution) { activeExecution = await autonomousController.update(activeExecution, activeUsage, "completed"); await emit(taskId, { type: "execution.completed", executionId: activeExecution.id });
      if (activeProfile && activeRisk) { const project = await options.memory.getProject(), verifications = await options.memory.getVerificationRuns(taskId); await options.memory.persistExecutionPattern({ id: `execution-pattern:${taskId}:success:${activeUsage.iterations}`, repositoryId: project.id, taskId, taskType: activeProfile.taskType, subsystem: activeProfile.subsystem, risk: activeRisk.level, strategy: ["context", "impact", "plan", ...(activeUsage.replans ? ["replan"] : []), ...(activeUsage.repairs ? ["repair"] : []), "review"], success: outcome?.status === "success", replans: activeUsage.replans, repairs: activeUsage.repairs, verificationScopes: verifications.map((item) => item.verificationScope ?? "targeted"), timestamp: new Date().toISOString() }); }
    }
    await emit(taskId, { type: "task.completed", taskId }); if (activeSandbox) activeSandbox = await sandboxManager.finalize(activeSandbox.id, true); return { taskId, state: "completed", checkpoint: completed, impact: activeImpact, outcome };
  };
  const fail = async (taskId: string, request: string, createdAt: string, checkpoint: TaskCheckpoint, error: unknown): Promise<TaskRunResult> => {
    const reason = (error as Error).message, failureClass = classifyTaskFailure(error); const failed = await setState(taskId, request, createdAt, checkpoint, "failed");
    const outcome: TaskOutcome = { status: "failure", attempts: checkpoint.attempt + 1, filesChanged: 0, linesChanged: 0, testsPassed: 0, testsFailed: failureClass === "verification" ? 1 : 0, verificationPassed: false, durationMs: Date.now() - Date.parse(createdAt) };
    await options.memory.persistTaskOutcome(taskId, outcome); await recordIntelligence(taskId, request, outcome, failureClass, reason); if (activeImpact && activeProposal) await recordImpactFeedback(options.memory, activeImpact, activeProposal.files.map((file) => file.path), false, false); if (activeExecution) { activeExecution = await autonomousController.update(activeExecution, activeUsage, "failed", reason); if (activeProfile && activeRisk) { const project = await options.memory.getProject(), verifications = await options.memory.getVerificationRuns(taskId); await options.memory.persistExecutionPattern({ id: `execution-pattern:${taskId}:failure:${activeUsage.iterations}`, repositoryId: project.id, taskId, taskType: activeProfile.taskType, subsystem: activeProfile.subsystem, risk: activeRisk.level, strategy: ["context", "impact", "plan", ...(activeUsage.replans ? ["replan"] : []), ...(activeUsage.repairs ? ["repair"] : [])], success: false, replans: activeUsage.replans, repairs: activeUsage.repairs, verificationScopes: verifications.map((item) => item.verificationScope ?? "targeted"), timestamp: new Date().toISOString() }); } } await options.memory.recordObservation({ type: "warning", taskId, content: { failureClass, reason }, timestamp: new Date().toISOString() }); await emit(taskId, { type: "task.failed", taskId, reason });
    if (activeSandbox && activeSandbox.status !== "destroyed") activeSandbox = await sandboxManager.finalize(activeSandbox.id, false); return { taskId, state: "failed", checkpoint: failed, impact: activeImpact, failureClass, outcome };
  };

  const executeFromMutation = async (args: { taskId: string; request: string; createdAt: string; checkpoint: TaskCheckpoint; plan: AgentPlan; proposal: MutationProposal; context?: IntelligentContextBundle; transaction?: MutationTransaction; snapshot?: WorkspaceSnapshot }): Promise<TaskRunResult> => {
    let { checkpoint, proposal } = args; let plan = args.plan, transaction = args.transaction, snapshot = args.snapshot, context = args.context;
    const executionRoot = activeSandbox ? await sandboxManager.workspacePath(activeSandbox.id) : options.root;
    const pauseForBudget = async (dimensions: string[]): Promise<TaskRunResult> => { await emit(args.taskId, { type: "execution.budget.exhausted", dimensions }); const paused = await setState(args.taskId, args.request, args.createdAt, checkpoint, "paused", { resumeState: checkpoint.state, budgetUsage: activeUsage }); if (activeExecution) activeExecution = await autonomousController.update(activeExecution, activeUsage, "paused", `budget exhausted: ${dimensions.join(", ")}`); await emit(args.taskId, { type: "task.paused", taskId: args.taskId }); return { taskId: args.taskId, state: "paused", checkpoint: paused, plan, proposal, impact: activeImpact }; };
    while (checkpoint.attempt <= policy.maxRepairAttempts) {
      if (checkpoint.state === "mutating") {
        if (activeExecution) { const executions = await options.memory.getModelExecutions(args.taskId); activeUsage = { ...activeUsage, modelSpend: executions.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0), wallClockMs: activeBaseWallClockMs + Date.now() - activeRunStartedAt }; const exhausted = [activeUsage.mutations >= activeExecution.budget.maxMutations ? "mutations" : "", activeUsage.modelSpend >= activeExecution.budget.maxModelSpend ? "modelSpend" : "", activeUsage.wallClockMs >= activeExecution.budget.maxWallClockMs ? "wallClockMs" : ""].filter(Boolean); if (exhausted.length) return pauseForBudget(exhausted); }
        await emit(args.taskId, { type: "mutation.started" });
        if (activeSandbox) { const durable = await sandboxManager.snapshot(activeSandbox.id, `before-mutation-${checkpoint.attempt}`); checkpoint = await save(args.taskId, checkpoint.state, checkpoint.attempt, { ...checkpoint, sandboxSnapshotId: durable.id }); }
        const validation = await validateMutation(proposal, plan, executionRoot, policy.mutation);
        if (!validation.valid) throw new Error(`MUTATION_REJECTED: ${validation.issues.map((issue) => issue.code).join(",")}`);
        if (activeExecution) { const projectedFiles = activeUsage.filesChanged + proposal.files.length, projectedLines = activeUsage.linesChanged + validation.files.reduce((sum, item) => sum + item.changedLines, 0), exceeded = [projectedFiles > activeExecution.budget.maxFilesChanged ? "filesChanged" : "", projectedLines > activeExecution.budget.maxLinesChanged ? "linesChanged" : ""].filter(Boolean); if (exceeded.length) return pauseForBudget(exceeded); }
        const applied = await applyValidatedMutation(executionRoot, proposal, validation); transaction = applied.transaction; snapshot = applied.snapshot;
        if (activeSandbox) await sandboxManager.snapshot(activeSandbox.id, `after-mutation-${checkpoint.attempt}`);
        await options.memory.persistMutationTransaction(transaction);
        if (activeExecution && activeImpact && activeProfile) { const prior = new Set(activeImpact.affectedFiles.filter((item) => item.confidence >= .5).map((item) => item.path)), recalculated = await changeIntelligence.analyzeChangeImpact({ files: proposal.files.map((file) => file.path), taskType: activeProfile.taskType, taskId: args.taskId, persist: true }), addedFiles = recalculated.affectedFiles.filter((item) => item.confidence >= .5 && !prior.has(item.path)).map((item) => item.path), comparable = (await options.memory.listOutcomeSignals()).filter((item) => item.taskType === activeProfile!.taskType && (!activeProfile!.subsystem || item.subsystem === activeProfile!.subsystem)), trusted = await detectVerificationCommands(await options.memory.getProject()), trustedCount = proposal.verification.filter((step) => trusted.some((command) => command.command === step.command)).length; activeImpact = recalculated; activeImpactExpanded = addedFiles.length > 0; activeRisk = autonomousController.assessRisk({ profile: activeProfile, impact: recalculated, files: proposal.files.length, lines: validation.files.reduce((sum, item) => sum + item.changedLines, 0), historicalFailureRate: comparable.length ? comparable.filter((item) => !item.success).length / comparable.length : 0, verificationCommands: trustedCount, dependencyCount: recalculated.affectedFiles.length }); await emit(args.taskId, { type: "impact.recalculated", predictionId: recalculated.id, addedFiles }); await emit(args.taskId, { type: "execution.risk", risk: activeRisk }); }
        if (activeExecution) { const changedLines = validation.files.reduce((sum, item) => sum + item.changedLines, 0); activeUsage = { ...activeUsage, mutations: activeUsage.mutations + 1, filesChanged: activeUsage.filesChanged + proposal.files.length, linesChanged: activeUsage.linesChanged + changedLines, wallClockMs: activeBaseWallClockMs + Date.now() - activeRunStartedAt }; activeExecution = await autonomousController.update(activeExecution, activeUsage); const warning = autonomousController.budgetState(activeUsage).warning; if (warning.length) await emit(args.taskId, { type: "execution.budget.warning", dimensions: warning }); }
        checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "verifying", { proposalId: proposal.id, transactionId: transaction.id, snapshot, budgetUsage: activeUsage, impactPredictionId: activeImpact?.id, riskAssessment: activeRisk });
        await emit(args.taskId, { type: "mutation.completed", files: proposal.files.map((file) => file.path) });
        const paused = await pauseAtBoundary(args.taskId, args.request, args.createdAt, checkpoint); if (paused) return { taskId: args.taskId, state: "paused", checkpoint: paused, plan, proposal };
      }
      if (checkpoint.state === "verifying") {
        if (!transaction || !snapshot) throw new Error("RESUME_DATA_MISSING: transaction snapshot");
        if (activeExecution && activeUsage.verificationTimeMs >= activeExecution.budget.maxVerificationTimeMs) return pauseForBudget(["verificationTimeMs"]);
        for (const step of proposal.verification) await emit(args.taskId, { type: "verification.started", command: step.command });
        const canonicalProject = await options.memory.getProject(), verificationProject = activeSandbox ? { ...canonicalProject, root: executionRoot } : canonicalProject;
        const layered = options.verification?.enabled === false ? (() => { const timestamp = new Date().toISOString(), run: VerificationRun = { id: `verification:${args.taskId}:disabled`, taskId: args.taskId, proposalId: proposal.id, results: [], passed: true, startedAt: timestamp, completedAt: timestamp, verificationScope: "syntax", verificationReason: "disabled by project configuration" }; return { runs: [run], escalations: [], final: run }; })() : await runLayeredVerification(verificationProject, args.taskId, proposal.id, proposal.verification, policy.execution, { risk: activeRisk?.level, executor: verificationExecutor() }), verification = layered.final;
        for (const run of layered.runs) await options.memory.persistVerificationRun(run); for (const escalation of layered.escalations) await emit(args.taskId, { type: "verification.escalated", ...escalation });
        if (activeExecution) { activeUsage = { ...activeUsage, verificationTimeMs: activeUsage.verificationTimeMs + layered.runs.flatMap((run) => run.results).reduce((sum, item) => sum + item.durationMs, 0), wallClockMs: Date.now() - Date.parse(activeExecution.startedAt) }; activeExecution = await autonomousController.update(activeExecution, activeUsage); }
        await emit(args.taskId, { type: "verification.completed", success: verification.passed });
        if (verification.passed) {
          const paused = await pauseAtBoundary(args.taskId, args.request, args.createdAt, checkpoint); if (paused) return { taskId: args.taskId, state: "paused", checkpoint: paused, plan, proposal };
          if (activeExecution && activeImpact && activeRisk) {
            const evidence = layered.runs.flatMap((run) => run.results.flatMap((result) => [result.stdout, result.stderr, result.classification ?? ""])).filter(Boolean), checks = checkPlanAssumptions(args.taskId, activeUsage.iterations, plan, evidence);
            for (const check of checks) { await options.memory.persistAssumptionCheck(check); await emit(args.taskId, { type: "assumption.checked", assumptionId: check.assumption.id, status: check.assumption.status }); if (check.assumption.status === "contradicted") await emit(args.taskId, { type: "assumption.contradicted", assumptionId: check.assumption.id, evidence: check.evidence }); }
            const decision = await autonomousController.decide({ taskId: args.taskId, iteration: activeUsage.iterations, risk: activeRisk, budget: activeExecution.budget, usage: activeUsage, verificationPassed: true, assumptionChecks: checks, impactExpanded: activeImpactExpanded }); await emit(args.taskId, { type: "execution.decision", decision });
            if (decision.action === "replan") { await restoreSnapshot(executionRoot, transaction, snapshot); await options.memory.persistMutationTransaction(transaction); checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "repairing", { lastVerificationId: verification.id, transactionId: undefined, snapshot: undefined }); activeReviewFailure = true; continue; }
            checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "reviewing", { lastVerificationId: verification.id }); await emit(args.taskId, { type: "review.started", iteration: activeUsage.iterations });
            const review = reviewExecution({ taskId: args.taskId, iteration: activeUsage.iterations, request: args.request, plan, proposal, impact: activeImpact, verification, assumptions: checks, risk: activeRisk }); await options.memory.persistReviewResult(review); await emit(args.taskId, { type: "review.completed", review });
            if (review.status === "fail") { await restoreSnapshot(executionRoot, transaction, snapshot); await options.memory.persistMutationTransaction(transaction); checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "repairing", { lastVerificationId: verification.id, transactionId: undefined, snapshot: undefined }); activeReviewFailure = true; continue; }
          }
          transaction.status = "verified"; transaction.completedAt = new Date().toISOString(); await options.memory.persistMutationTransaction(transaction);
          if (activeSandbox) { const canonicalValidation = await validateMutation(proposal, plan, options.root, policy.mutation); if (!canonicalValidation.valid) throw new Error(`SANDBOX_PROMOTION_CONFLICT: ${canonicalValidation.issues.map((issue) => issue.code).join(",")}`); const promoted = await applyValidatedMutation(options.root, proposal, canonicalValidation); promoted.transaction.status = "verified"; promoted.transaction.completedAt = new Date().toISOString(); await options.memory.persistMutationTransaction(promoted.transaction); }
          const outcome: TaskOutcome = { status: "success", attempts: checkpoint.attempt + 1, filesChanged: proposal.files.length,
            linesChanged: proposal.files.reduce((sum, file) => sum + file.patch.split("\n").filter((line) => /^[+-](?![+-])/.test(line)).length, 0),
            testsPassed: verification.results.filter((result) => result.status === "passed").length, testsFailed: 0, verificationPassed: true, durationMs: Date.now() - Date.parse(args.createdAt) };
          if (checkpoint.attempt > 0) await options.memory.persistRepairAttempt({ id: `repair:${args.taskId}:${checkpoint.attempt}`, taskId: args.taskId, attempt: checkpoint.attempt, proposalId: proposal.id, verificationRunId: verification.id, status: "passed" });
          return complete(args.taskId, args.request, args.createdAt, checkpoint, outcome);
        }
        await restoreSnapshot(executionRoot, transaction, snapshot); await options.memory.persistMutationTransaction(transaction);
        await options.memory.persistRepairAttempt({ id: `repair:${args.taskId}:${checkpoint.attempt}`, taskId: args.taskId, attempt: checkpoint.attempt, proposalId: proposal.id, verificationRunId: verification.id, status: "failed" });
        checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "repairing", { lastVerificationId: verification.id, snapshot: undefined, transactionId: undefined });
        if (checkpoint.attempt >= policy.maxRepairAttempts) return fail(args.taskId, args.request, args.createdAt, checkpoint, new Error(`TASK_FAILED: verification failed after ${checkpoint.attempt + 1} attempts`));
        const paused = await pauseAtBoundary(args.taskId, args.request, args.createdAt, checkpoint); if (paused) return { taskId: args.taskId, state: "paused", checkpoint: paused, plan, proposal };
      }
      if (checkpoint.state === "repairing") {
        const runs = await options.memory.getVerificationRuns(args.taskId), failure = runs.find((run) => run.id === checkpoint.lastVerificationId) ?? runs.at(-1);
        if (!failure) throw new Error("RESUME_DATA_MISSING: verification failure");
        const failureEvidence = failure.results.flatMap((result) => [result.classification ?? "", result.stderr.slice(0, 1000), result.stdout.slice(0, 1000)]).filter(Boolean);
        if (activeExecution) { const executions = await options.memory.getModelExecutions(args.taskId); activeUsage = { ...activeUsage, modelSpend: executions.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0), wallClockMs: activeBaseWallClockMs + Date.now() - activeRunStartedAt }; if (activeUsage.modelSpend >= activeExecution.budget.maxModelSpend) return pauseForBudget(["modelSpend"]); }
        await emit(args.taskId, { type: "context.refresh.started", reason: activeReviewFailure ? "review invalidated completion" : "verification evidence requires reevaluation" });
        context = await refreshContext(contextEngine, { request: args.request, reason: activeReviewFailure ? "review invalidated completion" : "verification evidence requires reevaluation", executionEvidence: failureEvidence }); activeContext = context; const refreshId = `context-refresh:${args.taskId}:${activeUsage.iterations}`; await options.memory.recordObservation({ id: refreshId, type: "decision", taskId: args.taskId, content: { reason: activeReviewFailure ? "review" : "verification", selected: context.items.map((item) => ({ id: item.id, score: item.score, reason: item.reason })) }, timestamp: new Date().toISOString(), relatedFiles: context.files.map((file) => file.id) }); await options.memory.addRelationship({ id: `edge:execution-refreshed-context:${args.taskId}:${activeUsage.iterations}`, from: `execution:${args.taskId}`, to: `observation:${refreshId}`, relation: "REFRESHED_CONTEXT", confidence: 1, source: "agent" }); await emit(args.taskId, { type: "context.refresh.completed", metrics: context.metrics });
        const priorImpact = activeImpact, refreshedTargets = [...new Set([...proposal.files.map((file) => file.path), ...context.files.slice(0, 5).map((file) => file.path)])];
        if (activeProfile) { const recalculated = await changeIntelligence.analyzeChangeImpact({ files: refreshedTargets, taskType: activeProfile.taskType, taskId: args.taskId, persist: true }), prior = new Set(priorImpact?.affectedFiles.filter((item) => item.confidence >= .5).map((item) => item.path) ?? []), addedFiles = recalculated.affectedFiles.filter((item) => item.confidence >= .5 && !prior.has(item.path)).map((item) => item.path); activeImpact = recalculated; await emit(args.taskId, { type: "impact.recalculated", predictionId: recalculated.id, addedFiles });
          const checks = checkPlanAssumptions(args.taskId, activeUsage.iterations, plan, failureEvidence); for (const check of checks) { await options.memory.persistAssumptionCheck(check); await emit(args.taskId, { type: "assumption.checked", assumptionId: check.assumption.id, status: check.assumption.status }); if (check.assumption.status === "contradicted") await emit(args.taskId, { type: "assumption.contradicted", assumptionId: check.assumption.id, evidence: check.evidence }); }
          if (activeExecution && activeRisk) { const decision = await autonomousController.decide({ taskId: args.taskId, iteration: activeUsage.iterations, risk: activeRisk, budget: activeExecution.budget, usage: activeUsage, verificationPassed: false, assumptionChecks: checks, impactExpanded: Boolean(addedFiles.length) || activeReviewFailure, implementationFailure: !activeReviewFailure && !checks.some((item) => item.assumption.status === "contradicted") && !addedFiles.length }); await emit(args.taskId, { type: "execution.decision", decision });
            if (decision.action === "stop") return pauseForBudget(Object.entries(decision.budgetRemaining).filter(([, value]) => value <= 0).map(([key]) => key));
            if (decision.action === "replan") {
              if (activeUsage.replans >= activeExecution.budget.maxReplans || activeUsage.iterations >= activeExecution.budget.maxIterations) return pauseForBudget([activeUsage.replans >= activeExecution.budget.maxReplans ? "replans" : "iterations"]);
              activeUsage = { ...activeUsage, replans: activeUsage.replans + 1, iterations: activeUsage.iterations + 1 }; activeExecution = await autonomousController.update(activeExecution, activeUsage); activeReviewFailure = false; activeImpactExpanded = false;
              checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "replanning", { iteration: activeUsage.iterations, budgetUsage: activeUsage, impactPredictionId: activeImpact?.id, riskAssessment: activeRisk }); await emit(args.taskId, { type: "execution.iteration.started", iteration: activeUsage.iterations }); await emit(args.taskId, { type: "routing.reconsidered", iteration: activeUsage.iterations });
              if (activeDecision) { const previous = activeDecision.selectedModel, updatedProfile = { ...activeProfile, expectedFiles: refreshedTargets.length, contextSize: context.estimatedTokens, estimatedComplexity: refreshedTargets.length >= 8 ? "high" as const : activeProfile.estimatedComplexity }; activeProfile = updatedProfile; activeDecision = await selectRuntimeModel(options.memory, { taskId: args.taskId, request: args.request, profile: updatedProfile, ...options.routing, models: options.routing?.models ?? (injectedModel ? [injectedModel] : undefined), iteration: activeUsage.iterations }); if (previous !== activeDecision.selectedModel) await emit(args.taskId, { type: "model.switched", from: previous, to: activeDecision.selectedModel, reason: "routing reconsidered after plan-level evidence" }); }
              const recommendations = buildMemoryRecommendations(rankSuccessfulPatterns(await options.memory.listSuccessfulPatterns(), { taskType: activeProfile.taskType, subsystem: activeProfile.subsystem }), rankFailurePatterns(await options.memory.listFailurePatterns(), { taskType: activeProfile.taskType, subsystem: activeProfile.subsystem }));
              const replanned = activeDecision ? (await executeWithModelFallback(options.memory, activeDecision, (candidate) => planner.plan(`${args.request}\nReplan from execution evidence: ${failureEvidence.join("\n")}`, { taskId: args.taskId, context, createdAt: args.createdAt, model: candidate.model, historicalMemory: recommendations.prompt, impactAssessment: activeImpact?.assessment }))).value : await planner.plan(args.request, { taskId: args.taskId, context, createdAt: args.createdAt, impactAssessment: activeImpact?.assessment }); plan = replanned.plan; activePlan = plan; proposal = activeDecision ? (await executeWithModelFallback(options.memory, activeDecision, (candidate) => mutationPlanner.propose(plan, context!, undefined, candidate.model))).value : await mutationPlanner.propose(plan, context); activeProposal = proposal;
              checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "awaiting_approval", { planId: plan.id, proposalId: proposal.id }); await emit(args.taskId, { type: "execution.replanned", planId: plan.id, iteration: activeUsage.iterations });
              const replanApprovalMode = activeRisk && autonomousController.requiresApproval(activeRisk) ? "edit" : "auto"; if (replanApprovalMode === "edit" && activeRisk) { const approvalDecision = await autonomousController.requestApproval(args.taskId, activeUsage.iterations, activeRisk, activeUsage); await emit(args.taskId, { type: "execution.decision", decision: approvalDecision }); } const approval = await (options.approval ?? defaultApproval)({ proposal, plan, mode: replanApprovalMode }); if (approval !== "approved") { cancellationRequested = true; const paused = await pauseAtBoundary(args.taskId, args.request, args.createdAt, checkpoint); return { taskId: args.taskId, state: "paused", checkpoint: paused!, plan, proposal, impact: activeImpact }; }
              checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "mutating"); continue;
            }
          }
        }
        if (activeExecution && (activeUsage.repairs >= activeExecution.budget.maxRepairs || activeUsage.iterations >= activeExecution.budget.maxIterations)) return pauseForBudget([activeUsage.repairs >= activeExecution.budget.maxRepairs ? "repairs" : "iterations"]);
        await emit(args.taskId, { type: "repair.started", attempt: checkpoint.attempt + 1 }); if (activeExecution) { activeUsage = { ...activeUsage, repairs: activeUsage.repairs + 1, iterations: activeUsage.iterations + 1 }; activeExecution = await autonomousController.update(activeExecution, activeUsage); await emit(args.taskId, { type: "execution.iteration.started", iteration: activeUsage.iterations }); }
        proposal = activeDecision ? (await executeWithModelFallback(options.memory, activeDecision, (candidate) => mutationPlanner.propose(plan, context!, failure, candidate.model))).value : await mutationPlanner.propose(plan, context, failure); activeProposal = proposal; activeImpactExpanded = false;
        await options.memory.persistRepairAttempt({ id: `repair:${args.taskId}:${checkpoint.attempt + 1}`, taskId: args.taskId, attempt: checkpoint.attempt + 1, proposalId: proposal.id, verificationRunId: failure.id, status: "proposed" });
        checkpoint = await setState(args.taskId, args.request, args.createdAt, checkpoint, "mutating", { attempt: checkpoint.attempt + 1, proposalId: proposal.id, iteration: activeUsage.iterations, budgetUsage: activeUsage, impactPredictionId: activeImpact?.id, riskAssessment: activeRisk }); checkpoint.attempt += 0;
      }
    }
    return fail(args.taskId, args.request, args.createdAt, checkpoint, new Error("TASK_FAILED: repair attempts exhausted"));
  };

  const start = async (request: string, mode: TaskMode, identity?: { taskId: string; createdAt: string; checkpoint: TaskCheckpoint }, editorContext?: { activeFile?: string; selection?: unknown; cursor?: unknown; openFiles?: string[] }): Promise<TaskRunResult> => {
    if (running) throw new Error("TASK_RUNNER_BUSY"); running = true; cancellationRequested = false; sequence = 0;
    const taskId = identity?.taskId ?? randomUUID(), createdAt = identity?.createdAt ?? new Date().toISOString(); let checkpoint = identity?.checkpoint ?? await save(taskId, "created", 0, { mode });
    if (!identity) { await options.memory.upsertTask({ id: taskId, request, status: "created", createdAt }); await emit(taskId, { type: "task.started", taskId }); if (editorContext) await options.memory.recordObservation({ id: `editor-context:${taskId}`, type: "decision", taskId, content: { source: "ide", ...editorContext }, timestamp: new Date().toISOString(), relatedFiles: [...new Set([editorContext.activeFile, ...(editorContext.openFiles ?? [])].filter((item): item is string => Boolean(item)).map((item) => `file:${item}`))] }); }
    if (mode === "auto" && !identity) { activeExecution = await autonomousController.start(taskId); activeUsage = { ...activeExecution.usage, iterations: 1 }; activeBaseWallClockMs = 0; activeRunStartedAt = Date.now(); activeExecution = await autonomousController.update(activeExecution, activeUsage); checkpoint = await save(taskId, checkpoint.state, checkpoint.attempt, { ...checkpoint, executionId: activeExecution.id, iteration: 1, autonomyMode: activeExecution.mode, budgetUsage: activeUsage }); await emit(taskId, { type: "execution.started", executionId: activeExecution.id, mode: activeExecution.mode }); await emit(taskId, { type: "execution.iteration.started", iteration: 1 }); }
    try {
      checkpoint = await ensureSandbox(taskId, mode, checkpoint);
      if (checkpoint.state === "created") checkpoint = await setState(taskId, request, createdAt, checkpoint, "contextualizing", { mode });
      await emit(taskId, { type: "context.started" });
      const context = await contextEngine.build({ request }); activeContext = context; await emit(taskId, { type: "context.completed", metrics: context.metrics });
      const contextPause = await pauseAtBoundary(taskId, request, createdAt, checkpoint); if (contextPause) return { taskId, state: "paused", checkpoint: contextPause, context };
      const project = await options.memory.getProject(); activeProfile = await createTaskProfile(request, project, context);
      const projectFiles = await options.memory.listProjectFiles(), namedTargets = projectFiles.filter((file) => request.includes(file.path) || request.includes(file.path.split("/").at(-1) ?? file.path)).map((file) => file.path);
      const impactTargets = namedTargets.length ? namedTargets : context.files.slice(0, 3).map((file) => file.path);
      const impact = await changeIntelligence.analyzeChangeImpact({ files: impactTargets, taskType: activeProfile.taskType, taskId, persist: true }); activeImpact = impact;
      checkpoint = await save(taskId, checkpoint.state, checkpoint.attempt, { ...checkpoint, impactPredictionId: impact.id });
      await emit(taskId, { type: "impact.completed", predictionId: impact.id, affectedFiles: impact.affectedFiles.length, affectedTests: impact.affectedTests.length, confidence: impact.confidence });
      activeDecision = await selectRuntimeModel(options.memory, { taskId, request, profile: activeProfile, ...options.routing, models: options.routing?.models ?? (injectedModel ? [injectedModel] : undefined) });
      checkpoint = await save(taskId, checkpoint.state, checkpoint.attempt, { ...checkpoint, routingDecisionId: activeDecision.id });
      await emit(taskId, { type: "routing.completed", model: activeDecision.selectedModel, provider: activeDecision.selectedProvider, score: activeDecision.score, confidence: activeDecision.reason.confidence.level, reason: activeDecision.reason.summary, evidenceCount: activeDecision.reason.confidence.evidenceCount });
      if (mode === "ask") {
        const modelStartedAt = Date.now(), executed = await executeWithModelFallback(options.memory, activeDecision, (candidate) => options.askLlm ? options.askLlm({ request, context, model: candidate.model }) : invokeModel(`${request}\n\nContext: ${JSON.stringify(context)}`, { model: candidate.model })), answer = executed.value, metadata = answer && typeof answer === "object" ? answer as { model?: string; provider?: string; usage?: { inputTokens?: number; outputTokens?: number; estimatedCost?: number } } : {};
        await options.memory.recordModelExecution({ id: `model-execution:${taskId}:ask`, taskId, model: metadata.model ?? executed.candidate.model, provider: metadata.provider ?? executed.candidate.provider, inputTokens: metadata.usage?.inputTokens, outputTokens: metadata.usage?.outputTokens, estimatedCost: metadata.usage?.estimatedCost, latencyMs: Date.now() - modelStartedAt, phase: "context" });
        await options.memory.recordObservation({ type: "agent_analysis", taskId, content: answer, timestamp: new Date().toISOString(), relatedFiles: context.files.map((file) => file.id) });
        const result = await complete(taskId, request, createdAt, checkpoint, { status: "success", attempts: 0, filesChanged: 0, linesChanged: 0, testsPassed: 0, testsFailed: 0, verificationPassed: true, durationMs: Date.now() - Date.parse(createdAt) }); return { ...result, context, answer };
      }
      if (checkpoint.state !== "planning") checkpoint = await setState(taskId, request, createdAt, checkpoint, "planning", { contextSelectionId: `context-selection:${taskId}` });
      await emit(taskId, { type: "planning.started" });
      const recommendations = buildMemoryRecommendations(rankSuccessfulPatterns(await options.memory.listSuccessfulPatterns(), { taskType: activeProfile.taskType, subsystem: activeProfile.subsystem }), rankFailurePatterns(await options.memory.listFailurePatterns(), { taskType: activeProfile.taskType, subsystem: activeProfile.subsystem }));
      const planned = (await executeWithModelFallback(options.memory, activeDecision, (candidate) => planner.plan(request, { taskId, context, createdAt, model: candidate.model, historicalMemory: recommendations.prompt, impactAssessment: activeImpact?.assessment }))).value; activePlan = planned.plan; await emit(taskId, { type: "plan.created", planId: planned.plan.id });
      if (activeImpact && planned.plan.impactAssessment) { activeImpact = { ...activeImpact, assessment: planned.plan.impactAssessment }; await options.memory.persistImpactPrediction(activeImpact); }
      checkpoint = await save(taskId, checkpoint.state, checkpoint.attempt, { ...checkpoint, planId: planned.plan.id });
      const planningPause = await pauseAtBoundary(taskId, request, createdAt, checkpoint); if (planningPause) return { taskId, state: "paused", checkpoint: planningPause, context, plan: planned.plan };
      if (mode === "plan") { const result = await complete(taskId, request, createdAt, checkpoint, { status: "success", attempts: 1, filesChanged: 0, linesChanged: 0, testsPassed: 0, testsFailed: 0, verificationPassed: true, durationMs: Date.now() - Date.parse(createdAt) }); return { ...result, context, plan: planned.plan }; }
      const proposal = (await executeWithModelFallback(options.memory, activeDecision, (candidate) => mutationPlanner.propose(planned.plan, context, undefined, candidate.model))).value; activeProposal = proposal;
      const proposedLines = proposal.files.reduce((sum, file) => sum + file.patch.split("\n").filter((line) => /^[+-](?![+-])/.test(line)).length, 0);
      if (mode === "auto") { const comparable = (await options.memory.listOutcomeSignals()).filter((item) => item.taskType === activeProfile!.taskType && (!activeProfile!.subsystem || item.subsystem === activeProfile!.subsystem)), trusted = await detectVerificationCommands(project), trustedCount = proposal.verification.filter((step) => trusted.some((command) => command.command === step.command)).length; activeRisk = autonomousController.assessRisk({ profile: activeProfile, impact, files: proposal.files.length, lines: proposedLines, historicalFailureRate: comparable.length ? comparable.filter((item) => !item.success).length / comparable.length : 0, verificationCommands: trustedCount, dependencyCount: impact.affectedFiles.length }); await emit(taskId, { type: "execution.risk", risk: activeRisk }); }
      checkpoint = await setState(taskId, request, createdAt, checkpoint, "awaiting_approval", { planId: planned.plan.id, proposalId: proposal.id, riskAssessment: activeRisk, budgetUsage: activeUsage }); await emit(taskId, approvalEvent(proposal));
      const approvalMode = mode === "auto" && activeRisk && autonomousController.requiresApproval(activeRisk) ? "edit" : mode;
      if (approvalMode === "edit" && mode === "auto" && activeRisk) { const approvalDecision = await autonomousController.requestApproval(taskId, activeUsage.iterations, activeRisk, activeUsage); await emit(taskId, { type: "execution.decision", decision: approvalDecision }); }
      const decision = await (options.approval ?? defaultApproval)({ proposal, plan: planned.plan, mode: approvalMode });
      if (decision === "rejected") { const cancelled = await setState(taskId, request, createdAt, checkpoint, "cancelled"); if (activeSandbox) activeSandbox = await sandboxManager.finalize(activeSandbox.id, false); await emit(taskId, { type: "task.cancelled", taskId }); return { taskId, state: "cancelled", checkpoint: cancelled, context, plan: planned.plan, proposal }; }
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
      if (stored.sandboxId) { activeSandbox = await options.memory.getSandbox(stored.sandboxId); if (!activeSandbox) throw new Error(`SANDBOX_NOT_FOUND: ${stored.sandboxId}`); activeSandbox = await sandboxManager.resume(activeSandbox.id); await bindSandboxWorkspace(activeSandbox); }
      if (["completed", "cancelled"].includes(stored.state)) return { taskId, state: stored.state, checkpoint: stored, outcome: await options.memory.getTaskOutcome(taskId) };
      if (stored.state === "failed") {
        const execution = await options.memory.getAutonomousExecution(taskId); if (!execution || execution.usage.iterations >= execution.budget.maxIterations) return { taskId, state: "failed", checkpoint: stored, outcome: await options.memory.getTaskOutcome(taskId) };
        autonomousController = createAutonomousController({ memory: options.memory, mode: execution.mode, budget: execution.budget }); activeExecution = execution; activeUsage = { ...execution.usage, iterations: execution.usage.iterations + 1 }; activeBaseWallClockMs = execution.usage.wallClockMs; activeRunStartedAt = Date.now(); activeExecution = await autonomousController.update(execution, activeUsage, "running"); const recovered = await setState(taskId, task.task.request, task.task.createdAt, stored, "contextualizing", { iteration: activeUsage.iterations, budgetUsage: activeUsage, mode: "auto" }); running = false; return start(task.task.request, "auto", { taskId, createdAt: task.task.createdAt, checkpoint: recovered });
      }
      const createdAt = task.task.createdAt, request = task.task.request; let checkpoint = stored;
      activeDecision = await options.memory.getRoutingDecision(taskId); activeProfile = activeDecision?.profile; activeImpact = checkpoint.impactPredictionId ? await options.memory.getImpactPredictionById(checkpoint.impactPredictionId) : await options.memory.getImpactPrediction(taskId);
      activeExecution = await options.memory.getAutonomousExecution(taskId); if (activeExecution) autonomousController = createAutonomousController({ memory: options.memory, mode: activeExecution.mode, budget: activeExecution.budget }); activeUsage = checkpoint.budgetUsage ?? activeExecution?.usage ?? emptyBudgetUsage(); activeBaseWallClockMs = activeUsage.wallClockMs; activeRunStartedAt = Date.now(); activeRisk = checkpoint.riskAssessment;
      if (checkpoint.state === "paused") { const target = checkpoint.resumeState ?? "contextualizing"; checkpoint = await setState(taskId, request, createdAt, checkpoint, target); }
      if (checkpoint.state === "reviewing") checkpoint = await setState(taskId, request, createdAt, checkpoint, "verifying");
      if (checkpoint.state === "replanning") checkpoint = await setState(taskId, request, createdAt, checkpoint, "repairing");
      let plan: AgentPlan | undefined, proposal: MutationProposal | undefined;
      if (checkpoint.state === "planning" && checkpoint.planId) {
        plan = await options.memory.getPlan(checkpoint.planId); if (!plan) throw new Error("RESUME_DATA_MISSING: plan");
        const context = await contextEngine.build({ request }); activeContext = context; proposal = activeDecision ? (await executeWithModelFallback(options.memory, activeDecision, (candidate) => mutationPlanner.propose(plan!, context, undefined, candidate.model))).value : await mutationPlanner.propose(plan, context); activeProposal = proposal;
        checkpoint = await setState(taskId, request, createdAt, checkpoint, "awaiting_approval", { proposalId: proposal.id }); await emit(taskId, approvalEvent(proposal));
      } else if (["created", "contextualizing", "planning"].includes(checkpoint.state)) { running = false; return start(request, checkpoint.mode ?? "ask", { taskId, createdAt, checkpoint }); }
      plan ??= checkpoint.planId ? await options.memory.getPlan(checkpoint.planId) : await options.memory.findPlanForTask(taskId);
      proposal ??= checkpoint.proposalId ? await options.memory.getMutationProposal(checkpoint.proposalId) : plan ? await options.memory.findMutationForPlan(plan.id) : undefined;
      activePlan = plan; activeProposal = proposal;
      if (!plan || !proposal) throw new Error("RESUME_DATA_MISSING: plan or proposal");
      if (checkpoint.state === "awaiting_approval") {
        const resumeMode = checkpoint.mode === "auto" && activeRisk && autonomousController.requiresApproval(activeRisk) ? "edit" : checkpoint.mode ?? "edit";
        await emit(taskId, approvalEvent(proposal)); const decision = await (options.approval ?? defaultApproval)({ proposal, plan, mode: resumeMode });
        if (decision !== "approved") { cancellationRequested = true; const paused = await pauseAtBoundary(taskId, request, createdAt, checkpoint); return { taskId, state: "paused", checkpoint: paused!, plan, proposal }; }
        checkpoint = await setState(taskId, request, createdAt, checkpoint, "mutating");
      }
      const transaction = checkpoint.transactionId ? (await options.memory.getMutationTransactions(taskId)).find((item) => item.id === checkpoint.transactionId) : undefined;
      return executeFromMutation({ taskId, request, createdAt, checkpoint, plan, proposal, transaction, snapshot: checkpoint.snapshot });
    } catch (error) {
      const checkpoint = await options.memory.getTaskCheckpoint(taskId); const task = await options.memory.getTask(taskId); if (!checkpoint || !task) throw error; return fail(taskId, task.task.request, task.task.createdAt, checkpoint, error);
    } finally { running = false; }
  };

  return { run: (input: { request: string; mode?: TaskMode; editorContext?: { activeFile?: string; selection?: unknown; cursor?: unknown; openFiles?: string[] } }) => start(input.request, input.mode ?? "ask", undefined, input.editorContext), resume,
    cancel: () => { cancellationRequested = true; }, subscribe(listener: (event: RuntimeEvent) => void) { subscribers.add(listener); return () => subscribers.delete(listener); } };
};
