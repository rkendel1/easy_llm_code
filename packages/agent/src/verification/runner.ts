import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Project } from "../memory/types.js";
import { classifyVerificationFailure } from "./classify.js";
import { authorizeVerification, detectVerificationCommands } from "./policy.js";
import { DEFAULT_EXECUTION_POLICY, type ExecutionPolicy, type VerificationRun, type VerificationStep, type VerificationResult } from "./types.js";

const execute = (command: { executable: string; args: string[]; command: string }, root: string, policy: ExecutionPolicy, timeoutMs: number): Promise<VerificationResult> => new Promise((resolve) => {
  const started = Date.now(); let stdout = "", stderr = "", done = false, exceeded = false;
  const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH, CI: "1", NO_COLOR: "1", npm_config_offline: policy.allowNetwork ? "false" : "true",
    HTTP_PROXY: policy.allowNetwork ? process.env.HTTP_PROXY : "http://127.0.0.1:9", HTTPS_PROXY: policy.allowNetwork ? process.env.HTTPS_PROXY : "http://127.0.0.1:9", NO_PROXY: policy.allowNetwork ? process.env.NO_PROXY : "*" };
  const child = spawn(command.executable, command.args, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  const stop = (): void => { if (child.pid && process.platform !== "win32") { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } } else child.kill("SIGKILL"); };
  const append = (target: "stdout" | "stderr", chunk: Buffer): void => { const text = chunk.toString("utf8"); if (target === "stdout") stdout += text; else stderr += text; if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > policy.maxOutputBytes) { exceeded = true; stop(); } };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk)); child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  const timer = setTimeout(() => { if (!done) stop(); }, Math.min(timeoutMs, policy.timeoutMs));
  child.on("error", (error) => { if (done) return; done = true; clearTimeout(timer); resolve({ stepId: "", command: command.command, status: "failed", stdout, stderr: `${stderr}${error.message}`, durationMs: Date.now() - started, classification: "command_failure" }); });
  child.on("close", (code, signal) => { if (done) return; done = true; clearTimeout(timer); const timedOut = signal === "SIGKILL" && !exceeded && Date.now() - started >= Math.min(timeoutMs, policy.timeoutMs); const status = timedOut ? "timed_out" : code === 0 && !exceeded ? "passed" : "failed";
    const result: VerificationResult = { stepId: "", command: command.command, status, exitCode: code ?? undefined, stdout: stdout.slice(0, policy.maxOutputBytes), stderr: stderr.slice(0, policy.maxOutputBytes), durationMs: Date.now() - started };
    if (status !== "passed") result.classification = exceeded ? "output_limit" : classifyVerificationFailure(result); resolve(result); });
});

export interface VerificationCommandExecutor {
  execute(command: { executable: string; args: string[]; command: string; timeoutMs: number }): Promise<VerificationResult>;
}

export const runVerification = async (project: Project, taskId: string, proposalId: string, requested: VerificationStep[], policy: ExecutionPolicy = DEFAULT_EXECUTION_POLICY, executor?: VerificationCommandExecutor): Promise<VerificationRun> => {
  const startedAt = new Date().toISOString(), trusted = await detectVerificationCommands(project), results: VerificationResult[] = [];
  for (const step of requested) {
    const command = authorizeVerification(step, trusted);
    if (!command) { results.push({ stepId: step.id, command: step.command, status: "denied", stdout: "", stderr: "Command is not a detected trusted package script", durationMs: 0, classification: "untrusted_command" }); continue; }
    const result = executor ? await executor.execute({ ...command, timeoutMs: step.timeoutMs }) : await execute(command, project.root, policy, step.timeoutMs); result.stepId = step.id; results.push(result);
  }
  const passed = requested.length > 0 && results.every((result, index) => result.status === "passed" || !requested[index]?.required);
  return { id: `verification:${randomUUID()}`, taskId, proposalId, results, passed, startedAt, completedAt: new Date().toISOString() };
};
