import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { relative } from "node:path";
import { resolveRepositoryPath } from "../path-security.js";
import type { AgentTool } from "../types.js";

const exec = promisify(execFile); const MAX_DIFF = 60_000;
export const gitDiffTool: AgentTool<{ path?: string; staged?: boolean }, { diff: string; truncated: boolean }> = {
  name: "git_diff", description: "Read a bounded Git diff", capability: "read",
  inputSchema: { type: "object" }, outputSchema: { type: "object" },
  async execute(input = {}, context) {
    const args = ["-C", context.root, "diff"]; if (input.staged) args.push("--cached");
    if (input.path) { const path = await resolveRepositoryPath(context.root, input.path); args.push("--", relative(context.root, path)); }
    const { stdout } = await exec("git", args, { maxBuffer: MAX_DIFF * 4 });
    return { diff: stdout.slice(0, MAX_DIFF), truncated: stdout.length > MAX_DIFF };
  }
};
