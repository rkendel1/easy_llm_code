import type { ChangeRecord } from "../memory/types.js";
import type { ChangePattern } from "./types.js";

const pathOf = (value: string): string => value.startsWith("file:") ? value.slice(5) : value;
export const mineChangePatterns = (repositoryId: string, changes: ChangeRecord[], generatedAt: string): ChangePattern[] => {
  const occurrences = new Map<string, number>(), pairs = new Map<string, Map<string, number>>();
  for (const change of changes) {
    const paths = [...new Set(change.files.map((file) => pathOf(file.fileId)))].sort();
    for (const target of paths) {
      occurrences.set(target, (occurrences.get(target) ?? 0) + 1); const related = pairs.get(target) ?? new Map<string, number>();
      for (const candidate of paths) if (candidate !== target) related.set(candidate, (related.get(candidate) ?? 0) + 1);
      pairs.set(target, related);
    }
  }
  return [...pairs].map(([target, related]) => { const sampleSize = occurrences.get(target) ?? 0; return { id: `change-pattern:${target}`, repositoryId, target, sampleSize, generatedAt,
    usuallyChanges: [...related].map(([path, observations]) => ({ path, observations, confidence: observations / (sampleSize + 3) })).sort((a, b) => b.confidence - a.confidence || a.path.localeCompare(b.path)) }; })
    .filter((item) => item.usuallyChanges.length > 0).sort((a, b) => a.target.localeCompare(b.target));
};
