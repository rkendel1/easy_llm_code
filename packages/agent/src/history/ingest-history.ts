import type { ProjectMemory } from "../memory/project-memory.js";
import { getHead, listUnseenCommits, readCommit } from "./git.js";

export interface HistoryIngestResult { head?: string; indexedCommits: number; skipped: boolean }

export const ingestRepositoryHistory = async (root: string, memory: ProjectMemory): Promise<HistoryIngestResult> => {
  const [head, cursor] = await Promise.all([getHead(root), memory.getHistoryCursor()]);
  if (!head || head === cursor?.lastIndexedCommit) return { head, indexedCommits: 0, skipped: true };
  const shas = await listUnseenCommits(root, cursor?.lastIndexedCommit);
  let indexedCommits = 0;
  for (const sha of shas) {
    const parsed = await readCommit(root, sha);
    await memory.ingestCommit(parsed.commit, parsed.changes);
    await memory.setHistoryCursor({ repositoryId: (await memory.getProject()).id, lastIndexedCommit: sha });
    indexedCommits++;
  }
  return { head, indexedCommits, skipped: false };
};
