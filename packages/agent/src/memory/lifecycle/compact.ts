import type { ProjectMemory } from "../project-memory.js";
import type { MemoryCompactionPolicy } from "../types.js";
export const compactProjectMemory = (memory: ProjectMemory, policy?: Partial<MemoryCompactionPolicy>) => memory.compact(policy);
