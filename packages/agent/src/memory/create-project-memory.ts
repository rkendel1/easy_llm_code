import type { Project } from "./types.js";
import { projectMemoryPath, readMemoryConfig, type MemoryConfig } from "./core/memory-config.js";
import { createFeltDBProjectMemory } from "./feltdb-project-memory.js";
import { MemoryConfigurationError } from "./core/memory-errors.js";

export const createProjectMemory = async (project: Project, override?: MemoryConfig) => {
  const config = override ?? await readMemoryConfig(), namespace = `code-agent:${project.id}`, storagePath = process.env.EASY_LLM_CODE_MEMORY_PATH ?? projectMemoryPath(config, project.id);
  if ((config.mode === "hosted" || config.mode === "hybrid") && !config.hosted) throw new MemoryConfigurationError(`${config.mode} project memory needs FELTDB_URL and FELTDB_TOKEN; use local memory or configure the endpoint`);
  const memory = config.mode === "hosted"
    ? createFeltDBProjectMemory({ root: project.root, namespace, server: config.hosted! })
    : config.mode === "hybrid"
      ? createFeltDBProjectMemory({ root: project.root, namespace, storagePath, hybrid: config.hosted! })
      : createFeltDBProjectMemory({ root: project.root, namespace, storagePath, ephemeral: config.mode === "ephemeral" });
  await memory.initialize(project); return memory;
};
