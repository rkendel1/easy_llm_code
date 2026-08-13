import { readFile, readdir, stat } from "node:fs/promises";
import { relative } from "node:path";
import { resolveRepositoryPath } from "../path-security.js";
import type { AgentTool } from "../types.js";

interface SearchMatch { path: string; line: number; excerpt: string }
const IGNORE = new Set([".git", "node_modules", "dist", "coverage"]);
export const searchTool: AgentTool<{ query: string; path?: string }, { matches: SearchMatch[]; truncated: boolean }> = {
  name: "search", description: "Search repository text with bounded literal results", capability: "read",
  inputSchema: { type: "object", required: ["query"] }, outputSchema: { type: "object" },
  async execute(input, context) {
    if (!input?.query || typeof input.query !== "string") throw new Error("INVALID_INPUT");
    const base = await resolveRepositoryPath(context.root, input.path ?? "."); const matches: SearchMatch[] = []; let truncated = false;
    const walk = async (dir: string): Promise<void> => { for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (matches.length >= 100) { truncated = true; return; } if (IGNORE.has(entry.name)) continue;
      const full = `${dir}/${entry.name}`; if (entry.isDirectory()) { await walk(full); continue; } if (!entry.isFile()) continue;
      let content: string; try { if ((await stat(full)).size > 1_000_000) continue; content = await readFile(full, "utf8"); } catch { continue; } if (content.includes("\0")) continue;
      for (const [index, line] of content.split("\n").entries()) if (line.toLowerCase().includes(input.query.toLowerCase())) {
        matches.push({ path: relative(context.root, full), line: index + 1, excerpt: line.slice(0, 500) }); if (matches.length >= 100) { truncated = true; break; }
      }
    } };
    await walk(base); return { matches, truncated };
  }
};
