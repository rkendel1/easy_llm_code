export interface VerificationStep { id: string; command: string; purpose: string; required: boolean; timeoutMs: number }
export interface TrustedVerificationCommand extends VerificationStep { executable: string; args: string[] }
export interface ExecutionPolicy { timeoutMs: number; maxOutputBytes: number; allowNetwork: boolean }
export interface VerificationResult {
  stepId: string; command: string; status: "passed" | "failed" | "timed_out" | "denied";
  exitCode?: number; stdout: string; stderr: string; durationMs: number; classification?: string;
}
export interface VerificationRun { id: string; taskId: string; proposalId: string; results: VerificationResult[]; passed: boolean; startedAt: string; completedAt: string }
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = { timeoutMs: 120_000, maxOutputBytes: 1_000_000, allowNetwork: false };
