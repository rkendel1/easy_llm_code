import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { promisify } from "node:util";
import type { AgentPlan } from "../planning/types.js";
import { resolveRepositoryPath } from "../tools/path-security.js";
import { applyUnifiedPatch } from "./patch.js";
import { DEFAULT_MUTATION_POLICY, type FilePatch, type MutationIssue, type MutationPolicy, type MutationProposal, type MutationValidation, type WorkspaceFileState } from "./types.js";

const exec = promisify(execFile);
export const hashContent = (content: string): string => createHash("sha256").update(content).digest("hex");
const cleanHeader = (value?: string): string | undefined => !value || value === "/dev/null" ? value : value.replace(/^[ab]\//, "");
const plannedFiles = (plan: AgentPlan): Set<string> => new Set([...plan.expectedFiles, ...plan.steps.map((step) => step.target).filter((value): value is string => Boolean(value))].map((path) => path.replace(/^\.\//, "")));

const resolvePatchPath = async (root: string, patch: FilePatch): Promise<{ target: string; source?: string }> => {
  if (patch.operation === "create") {
    await resolveRepositoryPath(root, dirname(patch.path));
    const target = await resolveRepositoryPath(root, patch.path, false);
    try { await resolveRepositoryPath(root, patch.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { target };
  }
  if (patch.operation === "rename") {
    if (!patch.oldPath) throw new Error("INVALID_OPERATION");
    await resolveRepositoryPath(root, dirname(patch.path));
    const target = await resolveRepositoryPath(root, patch.path, false);
    try { await resolveRepositoryPath(root, patch.path); throw new Error("INVALID_OPERATION"); } catch (error) { if ((error as Error).message === "INVALID_OPERATION") throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { target, source: await resolveRepositoryPath(root, patch.oldPath) };
  }
  return { target: await resolveRepositoryPath(root, patch.path) };
};
const workspaceState = async (root: string, absolute: string, path: string): Promise<WorkspaceFileState> => {
  try { const content = await readFile(absolute, "utf8"); if (content.includes("\0")) throw new Error("BINARY_PATCH_UNSUPPORTED"); const info = await stat(absolute); return { path, existed: true, content, hash: hashContent(content), mode: info.mode }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, existed: false }; throw error; }
};
const isDirty = async (root: string, absolute: string): Promise<boolean> => {
  try { await exec("git", ["-C", root, "rev-parse", "--show-toplevel"]); const { stdout } = await exec("git", ["-C", root, "status", "--porcelain=v1", "--", absolute], { maxBuffer: 100_000 }); return stdout.trim().length > 0; }
  catch { throw new Error("GIT_REQUIRED"); }
};

export const validateMutation = async (proposal: MutationProposal, plan: AgentPlan, root: string, policy: MutationPolicy = DEFAULT_MUTATION_POLICY): Promise<MutationValidation> => {
  const issues: MutationIssue[] = [], files: MutationValidation["files"] = []; let changedLines = 0;
  if (proposal.planId !== plan.id || proposal.taskId !== plan.taskId) issues.push({ code: "UNPLANNED_MUTATION", message: "Proposal does not belong to this plan" });
  if (proposal.files.length === 0) issues.push({ code: "INVALID_OPERATION", message: "Mutation proposal contains no files" });
  if (proposal.files.length > policy.maxFiles) issues.push({ code: "TOO_MANY_FILES", message: `Proposal has ${proposal.files.length} files; maximum is ${policy.maxFiles}` });
  const allowed = plannedFiles(plan);
  for (const file of proposal.files) {
    if (!allowed.has(file.path) || (file.oldPath && !allowed.has(file.oldPath))) { issues.push({ code: "UNPLANNED_MUTATION", message: `File is outside planned scope: ${file.path}`, path: file.path }); continue; }
    if (file.patch.length > 250_000) { issues.push({ code: "PATCH_TOO_LARGE", message: "Patch exceeds 250,000 characters", path: file.path }); continue; }
    if (file.operation === "create" && !policy.allowCreate || file.operation === "delete" && !policy.allowDelete || file.operation === "rename" && !policy.allowRename) { issues.push({ code: "POLICY_DENIED", message: `Operation ${file.operation} is denied`, path: file.path }); continue; }
    try {
      const resolved = await resolvePatchPath(root, file); const statePath = file.operation === "rename" ? file.oldPath! : file.path;
      const before = await workspaceState(root, resolved.source ?? resolved.target, statePath);
      if (file.operation === "create" && before.existed || file.operation !== "create" && !before.existed) { issues.push({ code: "INVALID_OPERATION", message: `Operation ${file.operation} does not match file state`, path: file.path }); continue; }
      if (file.operation !== "create" && (!file.beforeHash || file.beforeHash !== before.hash)) { issues.push({ code: "STALE_PATCH", message: "Current file hash differs from proposal", path: file.path }); continue; }
      if (await isDirty(root, resolved.source ?? resolved.target) || (resolved.source && await isDirty(root, resolved.target))) { issues.push({ code: "CONFLICTING_USER_CHANGES", message: "Target has existing user changes", path: file.path }); continue; }
      const parsed = applyUnifiedPatch(before.content ?? "", file.patch); const oldHeader = cleanHeader(parsed.oldHeader), newHeader = cleanHeader(parsed.newHeader);
      const expectedOld = file.operation === "create" ? "/dev/null" : (file.oldPath ?? file.path); const expectedNew = file.operation === "delete" ? "/dev/null" : file.path;
      if (oldHeader !== expectedOld || newHeader !== expectedNew) { issues.push({ code: "PATCH_REJECTED", message: "Patch headers do not match declared paths", path: file.path }); continue; }
      if (file.operation === "delete" && parsed.content !== "") { issues.push({ code: "PATCH_REJECTED", message: "Delete patch must produce an empty file", path: file.path }); continue; }
      if (file.operation !== "delete" && (!file.afterHash || file.afterHash !== hashContent(parsed.content))) { issues.push({ code: "PATCH_REJECTED", message: "Result hash differs from proposal", path: file.path }); continue; }
      const lineCount = parsed.additions + parsed.deletions; changedLines += lineCount; files.push({ patch: file, before, afterContent: file.operation === "delete" ? undefined : parsed.content, changedLines: lineCount });
    } catch (error) {
      const message = (error as Error).message; const code = message === "PATH_OUTSIDE_REPOSITORY" ? "PATH_OUTSIDE_REPOSITORY" : message === "GIT_REQUIRED" ? "GIT_REQUIRED" : message === "PATCH_TOO_LARGE" ? "PATCH_TOO_LARGE" : "PATCH_REJECTED";
      issues.push({ code, message, path: file.path });
    }
  }
  if (changedLines > policy.maxChangedLines) issues.push({ code: "TOO_MANY_CHANGED_LINES", message: `Proposal changes ${changedLines} lines; maximum is ${policy.maxChangedLines}` });
  return { valid: issues.length === 0 && files.length === proposal.files.length, issues, files, changedLines };
};
