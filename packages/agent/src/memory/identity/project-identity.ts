import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { basename, dirname, parse, relative, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const git = async (cwd: string, args: string[]): Promise<string | undefined> => {
  try { return (await exec("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout.trim() || undefined; }
  catch { return undefined; }
};
const canonicalRemote = (remote: string): string => remote.trim().replace(/\.git$/, "").replace(/^git@([^:]+):/, "ssh://$1/").toLowerCase();
const digest = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 24);
const PROJECT_MARKERS = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml"];
const hasProjectMarker = async (directory: string): Promise<boolean> => { for (const marker of PROJECT_MARKERS) try { await access(resolve(directory, marker)); return true; } catch {} return false; };
const nearestProjectRoot = async (start: string, boundary: string, fallback: string): Promise<string> => { let current = start; while (true) { if (await hasProjectMarker(current)) return current; if (current === boundary || dirname(current) === current) return fallback; current = dirname(current); } };

export interface ProjectIdentity {
  id: string;
  root: string;
  name: string;
  repositoryIdentity: string;
  git: boolean;
  worktreeCommonDirectory?: string;
  remote?: string;
}

export const resolveProjectIdentity = async (start: string): Promise<ProjectIdentity> => {
  const canonicalStart = await realpath(resolve(start));
  const gitRoot = await git(canonicalStart, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = await realpath(gitRoot ?? canonicalStart), root = await realpath(await nearestProjectRoot(canonicalStart, gitRoot ? repositoryRoot : parse(canonicalStart).root, gitRoot ? repositoryRoot : canonicalStart));
  const common = gitRoot ? await git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) : undefined;
  const remote = gitRoot ? await git(repositoryRoot, ["remote", "get-url", "origin"]) : undefined;
  const baseIdentity = remote ? `git:${canonicalRemote(remote)}` : common ? `gitdir:${await realpath(common)}` : `path:${root}`, subproject = gitRoot ? relative(repositoryRoot, root) : "";
  const repositoryIdentity = subproject ? `${baseIdentity}#${subproject}` : baseIdentity;
  return { id: `project:${digest(repositoryIdentity)}`, root, name: basename(root), repositoryIdentity, git: Boolean(gitRoot), ...(common ? { worktreeCommonDirectory: await realpath(common) } : {}), ...(remote ? { remote: canonicalRemote(remote) } : {}) };
};
