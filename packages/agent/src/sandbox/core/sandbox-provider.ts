import type { ExecutionResult, SandboxCommand, SandboxCreateInput, SandboxHandle, SandboxInspection, SandboxSnapshot } from "./sandbox-types.js";
export interface SandboxProvider {
  readonly name: string; readonly version: string;
  create(input: SandboxCreateInput): Promise<SandboxHandle>;
  prepare(handle: SandboxHandle, input: SandboxCreateInput): Promise<void>;
  execute(handle: SandboxHandle, command: SandboxCommand): Promise<ExecutionResult>;
  snapshot(handle: SandboxHandle, input: { id: string; label: string; environmentFingerprint: string; origin: import("./sandbox-types.js").WorkspaceOrigin; policy: import("./sandbox-types.js").SandboxPolicy; limits: import("./sandbox-types.js").ResourceLimits }): Promise<SandboxSnapshot>;
  restore(handle: SandboxHandle, snapshot: SandboxSnapshot): Promise<void>;
  destroy(handle: SandboxHandle): Promise<void>;
  inspect(handle: SandboxHandle): Promise<SandboxInspection>;
}
