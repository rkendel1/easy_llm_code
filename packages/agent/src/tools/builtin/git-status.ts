import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTool } from "../types.js";

const exec = promisify(execFile);
export interface GitStatusOutput { modified: string[]; added: string[]; deleted: string[]; untracked: string[]; truncated: boolean }
export const gitStatusTool: AgentTool<Record<string, never>, GitStatusOutput> = {
  name: "git_status", description: "Read structured Git working-tree status", capability: "read",
  inputSchema: { type: "object" }, outputSchema: { type: "object" },
  async execute(_input, context) {
    const { stdout } = await exec("git", ["-C", context.root, "status", "--porcelain=v1", "--untracked-files=all"], { maxBuffer: 1_000_000 });
    const output: GitStatusOutput = { modified: [], added: [], deleted: [], untracked: [], truncated: false };
    for (const line of stdout.split("\n").filter(Boolean)) {
      if (output.modified.length + output.added.length + output.deleted.length + output.untracked.length >= 2_000) { output.truncated = true; break; }
      const status = line.slice(0, 2), path = line.slice(3).split(" -> ").at(-1)!;
      if (status === "??") output.untracked.push(path); else {
        if (status.includes("M")) output.modified.push(path);
        if (status.includes("A")) output.added.push(path);
        if (status.includes("D")) output.deleted.push(path);
      }
    }
    return output;
  }
};
