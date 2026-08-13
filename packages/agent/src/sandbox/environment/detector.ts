import { execFile } from "node:child_process";
import { cpus, totalmem, arch, platform } from "node:os";
import { promisify } from "node:util";
import type { SandboxEnvironment } from "../core/sandbox-types.js";
const exec = promisify(execFile);
const version = async (tool: string, args = ["--version"]): Promise<string | undefined> => { try { const result = await exec(tool, args, { timeout: 3_000, maxBuffer: 20_000, encoding: "utf8" }); return `${result.stdout || result.stderr}`.trim().split("\n")[0]; } catch { return undefined; } };
export const detectSandboxEnvironment = async (workspace: string, languages: string[] = [], frameworks: string[] = []): Promise<SandboxEnvironment> => {
  const requested: [string, string, string[]?][] = [["node", "node"], ["python", "python3"], ["rust", "rustc"], ["cargo", "cargo"], ["go", "go"], ["java", "java"], ["npm", "npm"], ["pnpm", "pnpm"], ["yarn", "yarn"], ["bun", "bun"]];
  const detected = await Promise.all(requested.map(async ([name, tool, args]) => [name, await version(tool, args)] as const));
  const values: Record<string, string> = Object.fromEntries(detected.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
  const packageManagers = Object.fromEntries(["npm", "pnpm", "yarn", "bun", "cargo"].filter((name) => values[name]).map((name) => [name, values[name]]));
  const runtimeVersions = Object.fromEntries(["node", "python", "rust", "go", "java"].filter((name) => values[name]).map((name) => [name, values[name]]));
  return { os: platform(), architecture: arch(), cpuCount: cpus().length, memoryBytes: totalmem(), runtimeVersions, packageManagers, tools: values, languages: [...new Set(languages)].sort(), frameworks: [...new Set(frameworks)].sort() };
};
