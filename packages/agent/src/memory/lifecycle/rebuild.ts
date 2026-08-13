import { indexProjectIntoMemory } from "../../indexing/index-project.js";
import { ingestRepositoryHistory } from "../../history/ingest-history.js";
import type { ProjectMemory } from "../project-memory.js";
import type { Project } from "../types.js";

export const rebuildProjectMemory = async (root: string, project: Project, memory: ProjectMemory) => { const reset = await memory.prepareRebuild(); const indexed = await indexProjectIntoMemory(root, project, memory); const history = await ingestRepositoryHistory(root, memory); await memory.persist(); return { reset, indexed, history }; };
