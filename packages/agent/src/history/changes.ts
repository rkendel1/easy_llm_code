import type { FileChangeRecord } from "./history-types.js";

export const coChangePairs = (changes: FileChangeRecord[]): [string, string][] => {
  const ids = [...new Set(changes.map((change) => change.fileId))].sort();
  const pairs: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
  return pairs;
};

export const revertedSha = (message: string): string | undefined =>
  message.match(/This reverts commit ([0-9a-f]{7,40})/i)?.[1] ?? message.match(/revert[\s:\"]+([0-9a-f]{7,40})/i)?.[1];
