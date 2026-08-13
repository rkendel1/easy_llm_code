import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommitRecord, FileChangeRecord, ParsedCommit } from "./history-types.js";

const exec = promisify(execFile);
const runGit = async (root: string, args: string[]): Promise<string> =>
  (await exec("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 })).stdout.trim();

export const getHead = async (root: string): Promise<string | undefined> => {
  try { return await runGit(root, ["rev-parse", "HEAD"]); } catch { return undefined; }
};

export const listUnseenCommits = async (root: string, cursor?: string): Promise<string[]> => {
  const range = cursor ? `${cursor}..HEAD` : "HEAD";
  try {
    const output = await runGit(root, ["log", "--reverse", "--format=%H", range]);
    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    const output = await runGit(root, ["log", "--reverse", "--format=%H", "HEAD"]);
    return output ? output.split("\n").filter(Boolean) : [];
  }
};

const changeType = (status: string): FileChangeRecord["changeType"] =>
  status.startsWith("A") ? "added" : status.startsWith("D") ? "deleted" :
  status.startsWith("R") ? "renamed" : status.startsWith("C") ? "copied" : "modified";

export const readCommit = async (root: string, sha: string): Promise<ParsedCommit> => {
  const meta = await runGit(root, ["show", "-s", "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%B", sha]);
  const [actualSha, parents, author, timestamp, ...message] = meta.split("\x1f");
  const commit: CommitRecord = {
    id: `commit:${actualSha}`, sha: actualSha, parentShas: parents ? parents.split(" ") : [],
    author: author || undefined, timestamp, message: message.join("\x1f").trim()
  };
  const [statuses, stats] = await Promise.all([
    runGit(root, ["diff-tree", "--root", "--no-commit-id", "-r", "-M", "-C", "--name-status", sha]),
    runGit(root, ["diff-tree", "--root", "--no-commit-id", "-r", "-M", "-C", "--numstat", sha])
  ]);
  const statByPath = new Map<string, [number, number]>();
  for (const line of stats.split("\n").filter(Boolean)) {
    const [a, d, ...pathParts] = line.split("\t");
    const path = pathParts.at(-1) ?? "";
    statByPath.set(path, [a === "-" ? 0 : Number(a), d === "-" ? 0 : Number(d)]);
  }
  const changes = statuses.split("\n").filter(Boolean).map((line, index): FileChangeRecord => {
    const [status, first, second] = line.split("\t");
    const kind = changeType(status);
    const oldPath = kind === "renamed" || kind === "copied" || kind === "deleted" ? first : undefined;
    const newPath = kind === "renamed" || kind === "copied" ? second : kind === "deleted" ? undefined : first;
    const path = newPath ?? oldPath ?? first;
    const [additions, deletions] = statByPath.get(path) ?? [0, 0];
    return { id: `change:${actualSha}:${index}`, commitId: commit.id, fileId: `file:${path}`,
      changeType: kind, oldPath, newPath, additions, deletions };
  });
  return { commit, changes };
};
