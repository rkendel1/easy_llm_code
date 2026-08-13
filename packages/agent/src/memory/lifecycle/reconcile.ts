import { discoverFiles } from "../../discovery/discover-files.js";
import { indexProjectIntoMemory, type IndexResult } from "../../indexing/index-project.js";
import type { ProjectMemory } from "../project-memory.js";
import type { Project } from "../types.js";

export interface ReconcileResult { changed: boolean; indexed?: IndexResult }
export const reconcileProjectMemory = async (root: string, project: Project, memory: ProjectMemory): Promise<ReconcileResult> => {
  const [known, current] = await Promise.all([memory.listProjectFiles(), discoverFiles(root)]);
  const knownHashes = new Map(known.map((file) => [file.path, file.hash]));
  const changed = known.length !== current.length || current.some((file) => knownHashes.get(file.path) !== file.hash);
  if (!changed) return { changed: false };
  if (known.length) await memory.reset("graph");
  return { changed: true, indexed: await indexProjectIntoMemory(root, project, memory) };
};
