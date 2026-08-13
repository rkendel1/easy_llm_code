import type { MemoryCapabilities, MemoryExport, MemoryStatus, SyncState } from "../types.js";

export interface MemoryProvider {
  readonly kind: "local" | "hosted" | "hybrid" | "ephemeral";
  capabilities(): MemoryCapabilities;
  persist(): Promise<void>;
  status(): Promise<MemoryStatus>;
  sync(): Promise<SyncState>;
  export(): Promise<MemoryExport>;
  import(snapshot: MemoryExport): Promise<void>;
}
