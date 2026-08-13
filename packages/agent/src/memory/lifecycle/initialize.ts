import type { Project } from "../types.js";
import type { ProjectMemory } from "../project-memory.js";

export const initializeProjectMemory = async (memory: ProjectMemory, project: Project): Promise<{ existing: boolean }> => {
  await memory.initialize(project); const statistics = await memory.getGraphStatistics(); return { existing: statistics.nodes.files > 0 };
};
