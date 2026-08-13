import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { DetectionResult, Diagnostic, IDECapabilities, IDEConnection, IDEIntegration, IDEProtocolEvent, TaskDiff, Unsubscribe, WorkspaceContext } from "@easy-llm/code-ide";
import { IDEIntegrationError } from "../errors.js";
const exec = promisify(execFile);
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };
export abstract class CommandIDEAdapter implements IDEIntegration {
  private connection?: IDEConnection; private detectedPath?: string; private readonly listeners = new Set<(event: IDEProtocolEvent) => void>();
  abstract readonly id: string; abstract readonly name: string; abstract readonly capabilities: IDECapabilities; abstract readonly command: string; abstract readonly applicationPaths: string[]; readonly adapterVersion = "1";
  async detect(): Promise<DetectionResult> { try { const { stdout } = await exec("which", [this.command], { timeout: 2_000 }); const path = stdout.trim(), version = await this.version(); return { detected: true, path, version }; } catch { for (const path of this.applicationPaths) if (await exists(path)) return { detected: true, path }; return { detected: false, reason: `${this.name} command or application was not found` }; } }
  private async version(): Promise<string | undefined> { try { return (await exec(this.command, ["--version"], { timeout: 2_000, maxBuffer: 20_000 })).stdout.trim().split("\n")[0]; } catch { return undefined; } }
  async connect(): Promise<IDEConnection> { const detected = await this.detect(); if (!detected.detected) throw new IDEIntegrationError("IDE_NOT_DETECTED", this.id); this.detectedPath = detected.path; this.connection = { sessionId: randomUUID(), identity: { id: this.id, name: this.name, version: detected.version, adapterVersion: this.adapterVersion }, capabilities: this.capabilities, connectedAt: new Date().toISOString() }; return this.connection; }
  async disconnect(): Promise<void> { this.connection = undefined; }
  protected require(capability: keyof IDECapabilities): void { if (!this.capabilities[capability]) throw new IDEIntegrationError("IDE_CAPABILITY_UNSUPPORTED", `${this.id}.${capability}`); }
  async openFile(input: { path: string; line?: number; column?: number }): Promise<void> { this.require("openFile"); if (!this.connection) throw new IDEIntegrationError("IDE_NOT_CONNECTED", this.id); const target = input.line ? `${input.path}:${input.line}${input.column ? `:${input.column}` : ""}` : input.path, application = this.detectedPath?.endsWith(".app") ? this.detectedPath : undefined, child = application ? spawn("open", ["-a", application, "--args", "--goto", target], { detached: true, stdio: "ignore" }) : spawn(this.command, ["--goto", target], { detached: true, stdio: "ignore" }); child.unref(); }
  async revealFile(input: { path: string; line?: number; column?: number }): Promise<void> { this.require("revealFile"); return this.openFile(input); }
  async applyWorkspaceChanges(_input: { workspace: WorkspaceContext; diff: TaskDiff }): Promise<void> { this.require("applyEdit"); throw new IDEIntegrationError("IDE_OPERATION_UNIMPLEMENTED", `${this.id}.applyWorkspaceChanges`); }
  async showTask(_input: { taskId: string }): Promise<void> { this.require("tasks"); }
  async showDiff(_input: { diff: TaskDiff }): Promise<void> { this.require("diff"); }
  async showDiagnostics(_input: { diagnostics: Diagnostic[] }): Promise<void> { this.require("diagnostics"); }
  subscribeToEvents(handler: (event: IDEProtocolEvent) => void): Unsubscribe { this.listeners.add(handler); return () => this.listeners.delete(handler); }
}
