export interface SyncConflict { factId: string; localGeneration: number; remoteGeneration: number; resolution: "latest-provenance" | "manual" }
export const resolveSyncConflict = (conflict: SyncConflict): "local" | "remote" => conflict.localGeneration >= conflict.remoteGeneration ? "local" : "remote";
