import type { MemoryExport } from "../types.js";
export const CURRENT_MEMORY_SCHEMA_VERSION = 2;
export const migrateMemoryExport = (snapshot: MemoryExport): MemoryExport => { if (snapshot.schemaVersion > CURRENT_MEMORY_SCHEMA_VERSION) throw new Error("MEMORY_SCHEMA_NEWER_THAN_RUNTIME"); return { ...snapshot, schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION }; };
