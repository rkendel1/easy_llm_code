import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createUnifiedPatch } from "../../mutation/patch.js";
import { classifyFilesystemChanges, scanFilesystem } from "../filesystem/observer.js";
export const createSandboxDiff = async (baseline: string, workspace: string, sandboxId: string, taskId: string, maxBytes = 100_000): Promise<string> => {
  const changes = classifyFilesystemChanges(await scanFilesystem(baseline), await scanFilesystem(workspace), { sandboxId, taskId }), output: string[] = [];
  for (const change of changes) { try { const before = change.operation === "created" ? "" : await readFile(join(baseline, change.path), "utf8"), after = change.operation === "deleted" ? "" : await readFile(join(workspace, change.path), "utf8"); if (before.includes("\0") || after.includes("\0")) output.push(`Binary file ${change.path} changed`); else output.push(createUnifiedPatch(change.path, before, after)); } catch { output.push(`${change.operation.toUpperCase()} ${change.path}`); } if (Buffer.byteLength(output.join("\n")) >= maxBytes) break; }
  return output.join("\n").slice(0, maxBytes);
};
