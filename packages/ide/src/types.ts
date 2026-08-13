export type Unsubscribe = () => void;
export type IDECapability = "workspace" | "openFile" | "revealFile" | "applyEdit" | "diff" | "diagnostics" | "terminal" | "tasks" | "notifications" | "progress" | "webview" | "events" | "selection" | "cursor" | "editorTabs" | "debugging";
export type IDECapabilities = Readonly<Record<IDECapability, boolean | "limited">>;
export interface DetectionResult { detected: boolean; path?: string; version?: string; reason?: string }
export interface IDEIdentity { id: string; name: string; version?: string; adapterVersion: string }
export interface IDEConnection { sessionId: string; identity: IDEIdentity; capabilities: IDECapabilities; connectedAt: string }
export interface WorkspaceContext { workspacePath: string; workspaceId: string; repositoryRoot: string }
export interface EditorSelectionContext { activeFile?: string; selection?: { startLine: number; startColumn: number; endLine: number; endColumn: number; text?: string }; cursor?: { line: number; column: number }; openFiles?: string[] }
export interface Diagnostic { file: string; line?: number; column?: number; severity: "error" | "warning" | "information" | "hint"; message: string; source: string; taskId: string }
export interface TaskDiffHunk { header: string; lines: string[] }
export interface TaskDiffFile { path: string; additions: number; deletions: number; beforeHash?: string; afterHash?: string; hunks: TaskDiffHunk[] }
export interface TaskDiff { taskId: string; files: TaskDiffFile[]; additions: number; deletions: number }
export interface ApprovalRequest { taskId: string; mutationId: string; risk?: unknown; files: string[]; impact?: unknown; verificationPlan: string[]; sandboxId?: string }
export interface IDEProtocolEvent { id: string; taskId: string; timestamp: string; sequence: number; type: string; payload: Record<string, unknown>; sandboxId?: string }
export interface TaskCreateInput { request: string; workspace: WorkspaceContext; mode: "ask" | "plan" | "edit" | "auto"; policy?: Record<string, unknown>; editorContext?: EditorSelectionContext; ide?: { id: string; adapterVersion: string; capabilities: IDECapabilities } }
export interface RuntimeCapabilities { protocolVersion: string; transports: string[]; operations: string[]; runtimeEvents: boolean; sandboxInspection: boolean; diagnostics: boolean }
export interface RuntimeTask { id: string; request: string; state: string; createdAt: string; result?: unknown; approval?: ApprovalRequest }
export interface SandboxView { sandbox: unknown; commands: unknown[]; processes: unknown[]; filesystemChanges: unknown[]; network: unknown[]; snapshots: unknown[]; events: unknown[] }
export interface WorkspaceRuntimeStatus { state: "ready" | "attention-required"; project: { id: string; name: string; indexed: boolean }; memory: unknown; ai: unknown; sandbox: { enabled: boolean; network: string }; ide: { selected?: string; detected: string[]; connected: boolean }; recentTasks: Array<{ id: string; request: string; status: string; createdAt: string }>; interruptedTask?: { id: string; request: string; status: string } }
export interface ProjectIntelligenceView { files: number; symbols: number; commits: number; tasks: number; patterns: number; failures: number; generation: number; lastIndexedAt?: string }
export interface IDEIntegration {
  readonly id: string; readonly name: string; readonly capabilities: IDECapabilities;
  detect(): Promise<DetectionResult>; connect(): Promise<IDEConnection>; disconnect(): Promise<void>;
  openFile(input: { path: string; line?: number; column?: number }): Promise<void>;
  revealFile(input: { path: string; line?: number; column?: number }): Promise<void>;
  applyWorkspaceChanges(input: { workspace: WorkspaceContext; diff: TaskDiff }): Promise<void>;
  showTask(input: { taskId: string }): Promise<void>; showDiff(input: { diff: TaskDiff }): Promise<void>;
  showDiagnostics(input: { diagnostics: Diagnostic[] }): Promise<void>;
  subscribeToEvents(handler: (event: IDEProtocolEvent) => void): Unsubscribe;
}
