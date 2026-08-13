import type { OnboardingResult, WorkspaceProgress, WorkspaceStatus } from "./types.js";
import type { TaskRunResult } from "../task/runner.js";
import type { ProjectMemory } from "../memory/project-memory.js";

export const renderWelcome = (result: OnboardingResult): string => result.firstRun ? `┌──────────────────────────────────────────────┐
│              easy-llm-code                   │
│     Your coding agent for this project.      │
└──────────────────────────────────────────────┘

Project
  ${result.project}
Project memory
  ● Local — private, persistent, and offline
Model
  ● Automatic
AI Access
${result.model.credentialSources.length ? result.model.credentialSources.map((item) => `  ✓ ${item.provider} credentials available`).join("\n") : result.model.vaultConfigured ? "  ○ Encrypted vault configured; unlock it through @easy-llm/llm" : "  ○ No cloud credentials configured; continuing without AI"}
Coding environment
${result.detectedIDEs.filter((item) => item.detected).map((item) => `  ${item.id === result.selectedIDE ? "●" : "○"} ${item.name}`).join("\n") || "  Terminal (connect an IDE later)"}

Preparing your project…
${result.steps.map((step) => `${step.status === "ready" ? "✓" : "⚠"} ${step.label}${step.detail ? ` — ${step.detail}` : ""}`).join("\n")}
You're ready.` : `Welcome back to ${result.project}.`;

export const renderWorkspaceStatus = (status: WorkspaceStatus): string => `${status.state === "ready" ? "● Ready" : "⚠ Attention required"}
Project  ${status.project.name} ${status.project.indexed ? "✓ indexed" : "○ indexing needed"}
Memory   ${status.memory.capabilities.persistent ? "✓" : "⚠"} ${status.memory.provider}
AI       ${status.ai.ready ? "✓ Automatic routing" : "○ Continue without AI"}
Sandbox  ${status.sandbox.enabled ? `✓ ${status.sandbox.network} network` : "○ disabled"}
IDE      ${status.ide.selected ? `✓ ${status.ide.selected}` : "○ terminal"}`;

export const renderContinuation = (status: WorkspaceStatus): string => status.interruptedTask ? `
You have an unfinished task.
"${status.interruptedTask.request}"
Paused during ${status.interruptedTask.status}.
Resume with: /resume ${status.interruptedTask.id}` : status.recentTasks[0] ? `
Last task:
"${status.recentTasks[0].request}"
${status.recentTasks[0].status === "completed" ? "✓" : "•"} ${status.recentTasks[0].status}` : "";

export const renderProgress = (progress: WorkspaceProgress): string => { const active = progress.stages.find((stage) => stage.status === "active" || stage.status === "failed"); if (!active) return ""; const prefix = active.status === "failed" ? "✗" : "●"; const details = [progress.context ? `${progress.context.items} context items` : undefined, progress.model ? `${progress.model.provider}/${progress.model.id} (${progress.model.confidence}${progress.model.evidenceCount ? `, ${progress.model.evidenceCount} comparable tasks` : ""})` : undefined, progress.sandbox ? `sandbox ${progress.sandbox.id}, network ${progress.sandbox.network}` : undefined].filter(Boolean); return `${prefix} ${active.label}${details.length ? `\n  ${details.join(" · ")}` : ""}`; };

export const renderCompletion = async (result: TaskRunResult, memory: ProjectMemory): Promise<string> => { const [outcome, models, verifications] = await Promise.all([memory.getTaskOutcome(result.taskId), memory.getModelExecutions(result.taskId), memory.getVerificationRuns(result.taskId)]), files = result.proposal?.files.map((file) => file.path) ?? []; if (result.state !== "completed") return `${result.state === "paused" ? "○" : "✗"} ${result.state}\nTask ${result.taskId}`; return `✓ Done
${outcome?.status === "success" ? "Task completed successfully." : "Request answered."}
${files.length ? `Changed:\n${files.map((file) => `  ${file}`).join("\n")}\n` : ""}Verification:
${verifications.flatMap((run) => run.results).map((item) => `  ${item.status === "passed" ? "✓" : "✗"} ${item.command}`).join("\n") || "  not required"}
Model:
  Automatic → ${models.at(-1)?.provider ?? "automatic"}/${models.at(-1)?.model ?? "automatic"}
Task ${result.taskId}\n[ Review changes ]  [ Continue ]`; };
