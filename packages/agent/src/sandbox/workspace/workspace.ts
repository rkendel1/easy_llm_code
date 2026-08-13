import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceOrigin } from "../core/sandbox-types.js";
const exec = promisify(execFile);
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const git = async (root: string, args: string[]): Promise<string> => { try { return (await exec("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 10_000_000 })).stdout; } catch { return ""; } };
export const detectWorkspaceOrigin = async (repositoryPath: string): Promise<WorkspaceOrigin> => {
  const [head, tracked, untracked, ignored] = await Promise.all([git(repositoryPath, ["rev-parse", "HEAD"]), git(repositoryPath, ["diff", "--binary", "HEAD"]), git(repositoryPath, ["ls-files", "--others", "--exclude-standard", "-z"]), git(repositoryPath, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])]);
  return { repositoryPath, gitHead: head.trim() || undefined, dirtyState: Boolean(tracked || untracked), trackedChangesHash: hash(tracked), untrackedFilesHash: hash(untracked), ignoredFilesHash: hash(ignored), capturedAt: new Date().toISOString() };
};
