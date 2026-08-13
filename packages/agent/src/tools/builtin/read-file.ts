import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { resolveRepositoryPath } from "../path-security.js";
import type { AgentTool } from "../types.js";

const MAX_FILE_SIZE = 1_000_000;
export const readFileTool: AgentTool<{ path: string }, { path: string; content: string; size: number; hash: string }> = {
  name: "read_file", description: "Read one bounded text file inside the repository", capability: "read",
  inputSchema: { type: "object", required: ["path"] }, outputSchema: { type: "object" },
  async execute(input, context) {
    if (!input || typeof input.path !== "string") throw new Error("INVALID_INPUT");
    const path = await resolveRepositoryPath(context.root, input.path);
    const info = await stat(path); if (!info.isFile()) throw new Error("NOT_A_FILE");
    if (info.size > MAX_FILE_SIZE) throw new Error("FILE_TOO_LARGE");
    const bytes = await readFile(path); const content = bytes.toString("utf8");
    return { path: relative(context.root, path), content, size: info.size, hash: createHash("sha256").update(bytes).digest("hex") };
  }
};
