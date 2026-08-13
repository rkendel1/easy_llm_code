import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ProjectFile } from "../memory/types.js";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "target"
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".py": "python",
  ".go": "go",
  ".rs": "rust"
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXTENSION));

const extension = (path: string): string => {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index) : "";
};

const hashFile = async (path: string): Promise<string> => {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
};

const shouldInclude = (path: string): boolean => {
  const ext = extension(path);
  const basename = path.split("/").pop() ?? "";
  return ALLOWED_EXTENSIONS.has(ext) || basename === "Dockerfile";
};

export const discoverFiles = async (root: string): Promise<ProjectFile[]> => {
  const files: ProjectFile[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        await walk(absolute);
        continue;
      }
      if (!entry.isFile() || !shouldInclude(absolute)) {
        continue;
      }
      const info = await stat(absolute);
      const rel = relative(root, absolute);
      const ext = extension(rel);
      files.push({
        id: `file:${rel}`,
        path: rel,
        language: LANGUAGE_BY_EXTENSION[ext],
        size: info.size,
        hash: await hashFile(absolute)
      });
    }
  };

  await walk(root);
  return files;
};
