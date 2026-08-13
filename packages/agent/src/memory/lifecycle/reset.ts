import type { ProjectMemory } from "../project-memory.js";
import type { MemoryResetScope } from "../types.js";
export const resetProjectMemory = (memory: ProjectMemory, scope: MemoryResetScope = "all") => memory.reset(scope);
