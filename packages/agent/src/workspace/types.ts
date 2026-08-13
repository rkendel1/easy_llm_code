import type { MemoryStatus } from "../memory/types.js";
import type { ProjectConfig } from "../config/project-config.js";
import type { ModelCXStatus } from "../model/llm-cx.js";
export interface OnboardingResult { firstRun: boolean; project: string; config: ProjectConfig; detectedIDEs: Array<{ id: string; name: string; detected: boolean }>; selectedIDE?: string; model: ModelCXStatus; steps: Array<{ id: string; label: string; status: "ready" | "attention"; detail?: string }> }
export interface WorkspaceStatus { state: "ready" | "attention-required"; project: { id: string; name: string; indexed: boolean }; memory: MemoryStatus; ai: ModelCXStatus; sandbox: { enabled: boolean; network: string }; ide: { selected?: string; detected: string[]; connected: boolean }; recentTasks: Array<{ id: string; request: string; status: string; createdAt: string }>; interruptedTask?: { id: string; request: string; status: string } }
export interface WorkspaceStage { id: string; label: string; status: "pending" | "active" | "complete" | "failed"; detail?: string }
export interface WorkspaceProgress { taskId?: string; stages: WorkspaceStage[]; model?: { id: string; provider: string; confidence: string; reason?: string[]; evidenceCount?: number }; context?: { items: number; estimatedTokens: number }; sandbox?: { id: string; network: string }; failure?: string }
