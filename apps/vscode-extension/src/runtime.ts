import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { RuntimeClient, type IDECapabilities, type IDEProtocolEvent, type RuntimeTask, type TaskCreateInput, type WorkspaceRuntimeStatus } from "@easy-llm/code-ide";

const capabilities: IDECapabilities = { workspace: true, openFile: true, revealFile: true, applyEdit: false, diff: true, diagnostics: true, terminal: true, tasks: true, notifications: true, progress: true, webview: true, events: true, selection: true, cursor: true, editorTabs: true, debugging: false };
export interface RuntimeSnapshot { status?: WorkspaceRuntimeStatus; tasks: RuntimeTask[]; currentTaskIds: string[]; connected: boolean; error?: string }
export const parseRuntimeConnection = (output: string): { url: string; token: string } | undefined => { const url = output.match(/^URL:\s*(.+)$/m)?.[1]?.trim(), token = output.match(/^Token:\s*(.+)$/m)?.[1]?.trim(); return url && token ? { url, token } : undefined; };
export const runtimeClientOptions = (connection: { url: string; token: string }) => ({ baseUrl: connection.url, token: connection.token, pollIntervalMs: 200 });

export class ExtensionRuntime {
  private process?: ChildProcessWithoutNullStreams; private client?: RuntimeClient; private unsubscribe?: () => void; private root = ""; private currentTaskIds = new Set<string>(); private snapshot: RuntimeSnapshot = { tasks: [], currentTaskIds: [], connected: false };
  constructor(private readonly executable: () => string, private readonly publish: (value: RuntimeSnapshot) => void, private readonly event: (value: IDEProtocolEvent) => void, private readonly log: (value: string) => void) {}
  current(): RuntimeSnapshot { return this.snapshot; }
  private update(value: Partial<RuntimeSnapshot>) { this.snapshot = { ...this.snapshot, ...value }; this.publish(this.snapshot); }
  async start(workspaceRoot: string, vaultPassword?: string): Promise<void> {
    await this.stop(); this.root = await realpath(workspaceRoot); this.currentTaskIds.clear(); this.update({ connected: false, error: undefined, tasks: [], currentTaskIds: [] });
    const child = spawn(this.executable(), ["serve", `--root=${this.root}`, "--port=0"], { cwd: this.root, env: { ...process.env, ...(vaultPassword ? { LLM_VAULT_PASSWORD: vaultPassword } : {}) }, stdio: ["pipe", "pipe", "pipe"] }); this.process = child;
    const connection = await new Promise<{ url: string; token: string }>((resolve, reject) => { let stdout = "", stderr = ""; const timeout = setTimeout(() => reject(new Error(`Runtime did not become ready.${stderr ? ` ${stderr.trim()}` : ""}`)), 30_000); const inspect = () => { const value = parseRuntimeConnection(stdout); if (value) { clearTimeout(timeout); resolve(value); } }; child.stdout.on("data", (chunk) => { const text = chunk.toString(); stdout += text; this.log(text.trim()); inspect(); }); child.stderr.on("data", (chunk) => { const text = chunk.toString(); stderr += text; this.log(text.trim()); }); child.once("error", (error) => { clearTimeout(timeout); reject(error); }); child.once("exit", (code) => { if (!this.client) { clearTimeout(timeout); reject(new Error(stderr.trim() || `Runtime exited with code ${code}`)); } else this.update({ connected: false, error: `Runtime stopped (${code ?? "signal"})` }); }); });
    const client = new RuntimeClient(runtimeClientOptions(connection)); this.client = client; await client.connect({ identity: { id: "vscode", name: "Visual Studio Code", adapterVersion: "0.2.2" }, capabilities }); this.unsubscribe = client.subscribeToEvents((value) => { this.event(value); void this.refresh(); }); await this.refresh();
  }
  async refresh(): Promise<void> { if (!this.client) return; try { const [status, tasks] = await Promise.all([this.client.getWorkspaceStatus(), this.client.listTasks()]); this.update({ status, tasks, currentTaskIds: [...this.currentTaskIds], connected: true, error: undefined }); } catch (error) { this.update({ connected: false, error: error instanceof Error ? error.message : String(error) }); } }
  newSession(): void { this.currentTaskIds.clear(); this.update({ currentTaskIds: [] }); }
  async createTask(request: string, mode: TaskCreateInput["mode"], model = "auto", editorContext?: TaskCreateInput["editorContext"]): Promise<RuntimeTask> { if (!this.client) throw new Error("Runtime is not connected"); const id = `workspace:${createHash("sha256").update(this.root).digest("hex").slice(0, 20)}`; const task = await this.client.createTask({ request, mode, policy: { model }, workspace: { workspacePath: this.root, repositoryRoot: this.root, workspaceId: id }, editorContext, ide: { id: "vscode", adapterVersion: "0.2.2", capabilities } }); this.currentTaskIds.add(task.id); await this.refresh(); return task; }
  async approve(taskId: string, approved: boolean): Promise<void> { if (!this.client) throw new Error("Runtime is not connected"); await this.client.approveTask(taskId, approved ? "approve" : "reject"); await this.refresh(); }
  async getDiff(taskId: string) { if (!this.client) throw new Error("Runtime is not connected"); return this.client.getDiff(taskId); }
  async stop(): Promise<void> { this.unsubscribe?.(); this.unsubscribe = undefined; if (this.client) await this.client.disconnect().catch(() => undefined); this.client = undefined; if (this.process && !this.process.killed) this.process.kill(); this.process = undefined; this.snapshot = { tasks: [], currentTaskIds: [], connected: false }; }
}
