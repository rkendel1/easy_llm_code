import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import { resolveRepositoryPath } from "../path-security.js";
import type { AgentTool } from "../types.js";

const IGNORE = new Set([".git", "node_modules", "dist", "coverage"]);
const patternRegex = (pattern?: string): RegExp | undefined => pattern ? new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`) : undefined;
export const listFilesTool: AgentTool<{ path?: string; pattern?: string }, { files: string[]; truncated: boolean }> = {
  name: "list_files", description: "List repository files with an optional wildcard pattern", capability: "read",
  inputSchema: { type: "object" }, outputSchema: { type: "object" },
  async execute(input = {}, context) {
    const base = await resolveRepositoryPath(context.root, input.path ?? "."); const matcher = patternRegex(input.pattern); const files: string[] = []; let truncated = false;
    const walk = async (dir: string): Promise<void> => { for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= 2_000) { truncated = true; return; } if (IGNORE.has(entry.name)) continue;
      const full = `${dir}/${entry.name}`; if (entry.isDirectory()) await walk(full); else if (entry.isFile()) { const path = relative(context.root, full); if (!matcher || matcher.test(path) || matcher.test(entry.name)) files.push(path); }
    } };
    await walk(base); return { files: files.sort(), truncated };
  }
};
