import type { IDECapabilities, IDEProtocolEvent, RuntimeCapabilities, RuntimeTask, SandboxView, TaskCreateInput, TaskDiff, Unsubscribe } from "./types.js";
import { LocalHTTPRuntimeTransport, type RuntimeTransport } from "./transport.js";

export interface RuntimeClientOptions { baseUrl?: string; token?: string; fetch?: typeof globalThis.fetch; pollIntervalMs?: number; transport?: RuntimeTransport }
export class RuntimeClient {
  private readonly transport: RuntimeTransport; private readonly listeners = new Set<(event: IDEProtocolEvent) => void>(); private cursor = -1; private polling?: ReturnType<typeof setTimeout>; private connected = false;
  constructor(private readonly options: RuntimeClientOptions) { if (!options.transport && (!options.baseUrl || !options.token)) throw new Error("RuntimeClient requires a transport or baseUrl/token"); this.transport = options.transport ?? new LocalHTTPRuntimeTransport({ baseUrl: options.baseUrl!, token: options.token!, fetch: options.fetch }); }
  private request<T>(path: string, init: RequestInit = {}): Promise<T> { return this.transport.request(path, init); }
  async connect(input?: { identity: { id: string; name: string; version?: string; adapterVersion: string }; capabilities: IDECapabilities }) { await this.transport.connect(); const connection = await this.request<{ sessionId: string; capabilities: IDECapabilities }>("/v1/connect", { method: "POST", body: JSON.stringify(input ?? {}) }); this.connected = true; return connection; }
  async disconnect(): Promise<void> { this.connected = false; if (this.polling) clearTimeout(this.polling); await this.request("/v1/disconnect", { method: "POST" }); await this.transport.disconnect(); }
  getCapabilities(): Promise<RuntimeCapabilities> { return this.request("/v1/capabilities"); }
  createTask(input: TaskCreateInput): Promise<RuntimeTask> { return this.request("/v1/tasks", { method: "POST", body: JSON.stringify(input) }); }
  getTask(taskId: string): Promise<RuntimeTask> { return this.request(`/v1/tasks/${encodeURIComponent(taskId)}`); }
  pauseTask(taskId: string): Promise<RuntimeTask> { return this.control(taskId, "pause"); }
  resumeTask(taskId: string): Promise<RuntimeTask> { return this.control(taskId, "resume"); }
  cancelTask(taskId: string): Promise<RuntimeTask> { return this.control(taskId, "cancel"); }
  approveTask(taskId: string, decision: "approve" | "reject" | "approve-and-continue"): Promise<RuntimeTask> { return this.control(taskId, decision); }
  private control(taskId: string, action: string): Promise<RuntimeTask> { return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/${action}`, { method: "POST" }); }
  getDiff(taskId: string): Promise<TaskDiff> { return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/diff`); }
  getSandbox(taskId: string): Promise<SandboxView> { return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/sandbox`); }
  getDiagnostics(taskId: string): Promise<{ diagnostics: unknown[] }> { return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/diagnostics`); }
  subscribeToEvents(handler: (event: IDEProtocolEvent) => void): Unsubscribe { this.listeners.add(handler); if (!this.polling) void this.poll(); return () => { this.listeners.delete(handler); if (!this.listeners.size && this.polling) { clearTimeout(this.polling); this.polling = undefined; } }; }
  private async poll(): Promise<void> { if (!this.connected || !this.listeners.size) { this.polling = undefined; return; } try { const response = await this.request<{ events: IDEProtocolEvent[]; cursor: number }>(`/v1/events?after=${this.cursor}`); for (const event of response.events) for (const listener of this.listeners) listener(event); this.cursor = Math.max(this.cursor, response.cursor); } catch { /* A local runtime may disappear between polls; reconnect remains client-controlled. */ } finally { if (this.connected && this.listeners.size) this.polling = setTimeout(() => void this.poll(), this.options.pollIntervalMs ?? 250); else this.polling = undefined; } }
}
