import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvironmentFingerprint, NetworkPolicy, ResourceLimits, SandboxEnvironment } from "../core/sandbox-types.js";
import { hashFilesystemState, scanFilesystem } from "../filesystem/observer.js";
const hashFile = async (path: string): Promise<string | undefined> => { try { return createHash("sha256").update(await readFile(path)).digest("hex"); } catch { return undefined; } };
export const createEnvironmentFingerprint = async (input: { workspace: string; environment: SandboxEnvironment; provider: string; providerVersion: string; networkPolicy: NetworkPolicy; limits: ResourceLimits }): Promise<EnvironmentFingerprint> => {
  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "Cargo.lock", "go.sum"], manifests = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt"];
  const pairs = async (names: string[]): Promise<Record<string, string>> => Object.fromEntries((await Promise.all(names.map(async (name) => [name, await hashFile(join(input.workspace, name))] as const))).filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
  const lockfileHashes = await pairs(lockfiles), dependencyHashes = await pairs(manifests), repositoryHash = hashFilesystemState(await scanFilesystem(input.workspace));
  const base = { os: input.environment.os, architecture: input.environment.architecture, runtimeVersions: input.environment.runtimeVersions, packageManagers: input.environment.packageManagers, toolVersions: input.environment.tools, lockfileHashes, dependencyHashes, repositoryHash, sandboxProvider: input.provider, sandboxProviderVersion: input.providerVersion, networkPolicy: input.networkPolicy, resourceLimits: input.limits };
  return { ...base, fingerprint: createHash("sha256").update(JSON.stringify(base)).digest("hex") };
};
