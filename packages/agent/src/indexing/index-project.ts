import { discoverFiles } from "../discovery/discover-files.js";
import type { ProjectMemory } from "../memory/project-memory.js";
import type { Project, ProjectEdge, ProjectFile, ProjectSymbol } from "../memory/types.js";
import { extractSymbolsAndRelationships } from "./extract-symbols.js";

export interface IndexResult {
  files: ProjectFile[];
  symbols: ProjectSymbol[];
  relationships: ProjectEdge[];
}

export const indexProjectIntoMemory = async (
  root: string,
  project: Project,
  memory: ProjectMemory
): Promise<IndexResult> => {
  return memory.batch(async () => {
  const files = await discoverFiles(root);

  for (const file of files) {
    await memory.upsertFile(file);
    await memory.addRelationship({
      id: `edge:project-contains:${project.id}->${file.id}`,
      from: project.id,
      to: file.id,
      relation: "CONTAINS",
      confidence: 1,
      source: "filesystem"
    });
  }

  const { symbols, edges } = await extractSymbolsAndRelationships(root, files);

  for (const symbol of symbols) {
    await memory.upsertSymbol(symbol);
  }

  for (const edge of edges) {
    await memory.addRelationship(edge);
  }

  return {
    files,
    symbols,
    relationships: edges
  };
  });
};
