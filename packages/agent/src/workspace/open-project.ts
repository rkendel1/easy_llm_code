import type { Project } from "../memory/types.js";
import { createProjectMemory } from "../memory/create-project-memory.js";
import { DEFAULT_MEMORY_RETENTION, defaultMemoryBaseDirectory, readMemoryConfig, type MemoryConfig } from "../memory/core/memory-config.js";
import { readProjectConfig } from "../config/project-config.js";

export const openProjectMemory = async (project: Project) => {
  const projectConfig = await readProjectConfig(project.id); let machine: MemoryConfig;
  try { machine = await readMemoryConfig(); } catch (error) { if (projectConfig.initialized) throw error; machine = { mode: "local", baseDirectory: defaultMemoryBaseDirectory(), retention: DEFAULT_MEMORY_RETENTION }; }
  const mode = projectConfig.initialized ? projectConfig.memory.provider : "local";
  const config: MemoryConfig = { ...machine, mode, ...(mode === "local" ? { hosted: undefined } : {}) };
  return { projectConfig, memory: await createProjectMemory(project, config) };
};
