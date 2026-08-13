import { randomUUID } from "node:crypto";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveRepositoryPath } from "../tools/path-security.js";
import { createUnifiedPatch } from "./patch.js";
import type { FilePatch, MutationProposal, MutationTransaction, MutationValidation, WorkspaceSnapshot } from "./types.js";

const atomicWrite = async (root: string, path: string, content: string, mode?: number): Promise<void> => {
  const target = await resolveRepositoryPath(root, path, false); await resolveRepositoryPath(root, dirname(path));
  const temporary = `${target}.easy-llm-${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { encoding: "utf8", mode }); if (mode !== undefined) await chmod(temporary, mode); await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
};
const remove = async (root: string, path: string): Promise<void> => { const target = await resolveRepositoryPath(root, path); await unlink(target); };
const inversePatch = (file: MutationValidation["files"][number]): FilePatch => {
  const before = file.before.content ?? "", after = file.afterContent ?? "";
  if (file.patch.operation === "create") return { path: file.patch.path, operation: "delete", beforeHash: file.patch.afterHash, patch: createUnifiedPatch(file.patch.path, after, "") };
  if (file.patch.operation === "delete") return { path: file.patch.path, operation: "create", afterHash: file.patch.beforeHash, patch: createUnifiedPatch(file.patch.path, "", before) };
  if (file.patch.operation === "rename") return { path: file.patch.oldPath!, oldPath: file.patch.path, operation: "rename", patch: createUnifiedPatch(file.patch.oldPath!, after, before) };
  return { path: file.patch.path, operation: "modify", beforeHash: file.patch.afterHash, afterHash: file.patch.beforeHash, patch: createUnifiedPatch(file.patch.path, after, before) };
};

export const applyValidatedMutation = async (root: string, proposal: MutationProposal, validation: MutationValidation): Promise<{ transaction: MutationTransaction; snapshot: WorkspaceSnapshot }> => {
  if (!validation.valid) throw new Error(`MUTATION_INVALID: ${validation.issues.map((issue) => issue.code).join(",")}`);
  const transaction: MutationTransaction = { id: `transaction:${randomUUID()}`, taskId: proposal.taskId, proposalId: proposal.id,
    applied: [], inverse: validation.files.map(inversePatch), status: "prepared", createdAt: new Date().toISOString() };
  const snapshot: WorkspaceSnapshot = { files: validation.files.map((file) => file.before) };
  try {
    for (const file of validation.files) {
      if (file.patch.operation === "delete") await remove(root, file.patch.path);
      else if (file.patch.operation === "rename") { await atomicWrite(root, file.patch.path, file.afterContent!, file.before.mode); await remove(root, file.patch.oldPath!); }
      else await atomicWrite(root, file.patch.path, file.afterContent!, file.before.mode);
      transaction.applied.push(file.patch);
    }
    transaction.status = "applied"; return { transaction, snapshot };
  } catch (error) {
    transaction.status = "failed";
    await restoreSnapshot(root, transaction, snapshot);
    throw error;
  }
};

export const restoreSnapshot = async (root: string, transaction: MutationTransaction, snapshot: WorkspaceSnapshot): Promise<void> => {
  for (let index = transaction.applied.length - 1; index >= 0; index--) {
    const patch = transaction.applied[index], state = snapshot.files[index];
    if (patch.operation === "rename") await unlink(await resolveRepositoryPath(root, patch.path, false)).catch(() => undefined);
    if (state.existed) await atomicWrite(root, state.path, state.content ?? "", state.mode);
    else await unlink(await resolveRepositoryPath(root, patch.path, false)).catch(() => undefined);
  }
  transaction.status = "rolled_back"; transaction.completedAt = new Date().toISOString();
};
