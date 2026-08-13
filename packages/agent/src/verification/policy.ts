import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "../memory/types.js";
import type { TrustedVerificationCommand } from "./types.js";

const TRUSTED_SCRIPTS = ["test", "typecheck", "lint", "build"] as const;
export const detectVerificationCommands = async (project: Project): Promise<TrustedVerificationCommand[]> => {
  let manifest: { scripts?: Record<string, string> };
  try { manifest = JSON.parse(await readFile(join(project.root, "package.json"), "utf8")); } catch { return []; }
  const manager = (["pnpm", "yarn", "bun", "npm"] as const).find((item) => project.packageManagers.includes(item)) ?? "npm";
  return TRUSTED_SCRIPTS.filter((name) => manifest.scripts?.[name]).map((name) => ({
    id: `verify:${name}`, command: manager === "npm" && name === "test" ? "npm test" : `${manager} run ${name}`,
    executable: manager, args: manager === "npm" && name === "test" ? ["test"] : ["run", name],
    purpose: `Run trusted package script: ${name}`, required: name === "test" || name === "typecheck", timeoutMs: 120_000
  }));
};

export const authorizeVerification = (requested: { command: string }, trusted: TrustedVerificationCommand[]): TrustedVerificationCommand | undefined =>
  trusted.find((command) => command.command === requested.command);
