import type { ProjectMemory } from "../project-memory.js";
export class MemorySyncManager { constructor(private readonly memory: ProjectMemory) {} sync() { return this.memory.sync(); } }
