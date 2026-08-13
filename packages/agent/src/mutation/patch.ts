export interface ParsedPatch { content: string; additions: number; deletions: number; oldHeader?: string; newHeader?: string }
interface Hunk { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] }

const contentLines = (content: string): { lines: string[]; newline: boolean } => ({
  lines: content === "" ? [] : content.replace(/\n$/, "").split("\n"), newline: content.endsWith("\n")
});
export const patchLineCounts = (patch: string): { additions: number; deletions: number } => {
  let additions = 0, deletions = 0;
  for (const line of patch.split("\n")) { if (line.startsWith("+") && !line.startsWith("+++")) additions++; if (line.startsWith("-") && !line.startsWith("---")) deletions++; }
  return { additions, deletions };
};

export const applyUnifiedPatch = (before: string, patch: string): ParsedPatch => {
  if (patch.length > 250_000) throw new Error("PATCH_TOO_LARGE");
  const patchLines = patch.replace(/\r\n/g, "\n").split("\n");
  const oldHeader = patchLines.find((line) => line.startsWith("--- "))?.slice(4).split("\t")[0];
  const newHeader = patchLines.find((line) => line.startsWith("+++ "))?.slice(4).split("\t")[0];
  const hunks: Hunk[] = []; let current: Hunk | undefined;
  for (const line of patchLines) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (match) { current = { oldStart: Number(match[1]), oldCount: Number(match[2] ?? 1), newStart: Number(match[3]), newCount: Number(match[4] ?? 1), lines: [] }; hunks.push(current); continue; }
    if (current && (/^[ +\-\\]/.test(line))) current.lines.push(line);
  }
  if (!hunks.length) throw new Error("PATCH_REJECTED");
  const newNoNewline = patchLines.some((line, index) => line === "\\ No newline at end of file" && patchLines[index - 1]?.startsWith("+") && !patchLines[index - 1]?.startsWith("+++"));
  const original = contentLines(before), result: string[] = []; let cursor = 0, additions = 0, deletions = 0;
  for (const hunk of hunks) {
    const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (start < cursor || start > original.lines.length) throw new Error("PATCH_REJECTED");
    result.push(...original.lines.slice(cursor, start)); cursor = start; let consumed = 0, produced = 0;
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) continue;
      const value = line.slice(1);
      if (line.startsWith(" ")) { if (original.lines[cursor] !== value) throw new Error("PATCH_REJECTED"); result.push(value); cursor++; consumed++; produced++; }
      else if (line.startsWith("-")) { if (original.lines[cursor] !== value) throw new Error("PATCH_REJECTED"); cursor++; consumed++; deletions++; }
      else if (line.startsWith("+")) { result.push(value); produced++; additions++; }
    }
    if (consumed !== hunk.oldCount || produced !== hunk.newCount) throw new Error("PATCH_REJECTED");
  }
  result.push(...original.lines.slice(cursor));
  const newline = result.length > 0 && newHeader !== "/dev/null" && !newNoNewline;
  return { content: result.join("\n") + (newline ? "\n" : ""), additions, deletions, oldHeader, newHeader };
};

const prefixed = (content: string, prefix: string): string[] => content === "" ? [] : content.replace(/\n$/, "").split("\n").map((line) => `${prefix}${line}`);
export const createUnifiedPatch = (path: string, before: string, after: string): string => {
  const oldLines = before === "" ? 0 : before.replace(/\n$/, "").split("\n").length;
  const newLines = after === "" ? 0 : after.replace(/\n$/, "").split("\n").length;
  const lines = [`--- ${before === "" ? "/dev/null" : `a/${path}`}`, `+++ ${after === "" ? "/dev/null" : `b/${path}`}`,
    `@@ -${oldLines ? 1 : 0},${oldLines} +${newLines ? 1 : 0},${newLines} @@`, ...prefixed(before, "-")];
  if (before !== "" && !before.endsWith("\n")) lines.push("\\ No newline at end of file");
  lines.push(...prefixed(after, "+"));
  if (after !== "" && !after.endsWith("\n")) lines.push("\\ No newline at end of file");
  lines.push(""); return lines.join("\n");
};
