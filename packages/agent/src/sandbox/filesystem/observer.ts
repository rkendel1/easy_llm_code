import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { FilesystemChange } from "../core/sandbox-types.js";
import { SandboxError } from "../core/sandbox-errors.js";

export interface FileState { hash: string; size: number }
export type FilesystemState = Map<string, FileState>;
const ignored = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".easy-llm-sandbox"]);
const inside = (root: string, target: string): boolean => target === root || target.startsWith(`${root}${sep}`);
export const assertSafeRepositorySymlinks = async (root: string): Promise<void> => {
  const absoluteRoot = resolve(root); const walk = async (directory: string): Promise<void> => { for (const entry of await readdir(directory, { withFileTypes: true })) { if (ignored.has(entry.name)) continue; const path = join(directory, entry.name); if (entry.isSymbolicLink()) { const target = await readlink(path); if (target.startsWith("/") || !inside(absoluteRoot, resolve(directory, target))) throw new SandboxError("SANDBOX_SYMLINK_ESCAPE", relative(absoluteRoot, path)); } else if (entry.isDirectory()) await walk(path); } }; await walk(absoluteRoot);
};
export const scanFilesystem = async (root: string): Promise<FilesystemState> => {
  const state: FilesystemState = new Map(); const walk = async (directory: string): Promise<void> => { for (const entry of await readdir(directory, { withFileTypes: true })) { if (ignored.has(entry.name)) continue; const path = join(directory, entry.name), rel = relative(root, path).replace(/\\/g, "/"); if (entry.isDirectory()) await walk(path); else if (entry.isFile()) { const bytes = await readFile(path); state.set(rel, { hash: createHash("sha256").update(bytes).digest("hex"), size: bytes.length }); } } }; await walk(root); return state;
};
export const hashFilesystemState = (state: FilesystemState): string => createHash("sha256").update(JSON.stringify([...state].sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
export const classifyFilesystemChanges = (before: FilesystemState, after: FilesystemState, association: { sandboxId: string; taskId: string }): FilesystemChange[] => {
  const timestamp = new Date().toISOString(), changes: FilesystemChange[] = [];
  const deleted = [...before].filter(([path]) => !after.has(path)).sort(([a], [b]) => a.localeCompare(b)), created = [...after].filter(([path]) => !before.has(path)).sort(([a], [b]) => a.localeCompare(b)), consumed = new Set<string>();
  for (const [oldPath, prior] of deleted) { const renamed = created.find(([path, next]) => !consumed.has(path) && next.hash === prior.hash); if (!renamed) continue; const [path, next] = renamed; consumed.add(oldPath); consumed.add(path); changes.push({ id: `filesystem-change:${association.sandboxId}:${createHash("sha256").update(`${oldPath}->${path}`).digest("hex").slice(0, 12)}:${next.hash.slice(0, 8)}`, ...association, path, oldPath, operation: "renamed", beforeHash: prior.hash, afterHash: next.hash, sizeBefore: prior.size, sizeAfter: next.size, timestamp }); }
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) { if (consumed.has(path)) continue; const prior = before.get(path), next = after.get(path); if (prior?.hash === next?.hash) continue; changes.push({ id: `filesystem-change:${association.sandboxId}:${createHash("sha256").update(path).digest("hex").slice(0, 12)}:${next ? next.hash.slice(0, 8) : "deleted"}`, ...association, path, operation: !prior ? "created" : !next ? "deleted" : "modified", beforeHash: prior?.hash, afterHash: next?.hash, sizeBefore: prior?.size, sizeAfter: next?.size, timestamp }); }
  return changes;
};
