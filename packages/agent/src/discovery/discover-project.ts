import { access, readFile } from "node:fs/promises";
import type { Project } from "../memory/types.js";
import { resolveProjectIdentity } from "../memory/identity/project-identity.js";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const discoverProject = async (requestedRoot: string): Promise<Project> => {
  const identity = await resolveProjectIdentity(requestedRoot), root = identity.root;
  const checks = await Promise.all([
    exists(`${root}/package.json`),
    exists(`${root}/pnpm-lock.yaml`),
    exists(`${root}/yarn.lock`),
    exists(`${root}/package-lock.json`),
    exists(`${root}/bun.lock`),
    exists(`${root}/tsconfig.json`),
    exists(`${root}/Cargo.toml`),
    exists(`${root}/go.mod`),
    exists(`${root}/pyproject.toml`),
    exists(`${root}/requirements.txt`)
  ]);

  const packageManagers: string[] = [];
  if (checks[1]) packageManagers.push("pnpm");
  if (checks[2]) packageManagers.push("yarn");
  if (checks[3]) packageManagers.push("npm");
  if (checks[4]) packageManagers.push("bun");
  if (packageManagers.length === 0 && checks[0]) {
    packageManagers.push("npm");
  }

  const detectedLanguages = new Set<string>();
  if (checks[0]) detectedLanguages.add("javascript");
  if (checks[5]) detectedLanguages.add("typescript");
  if (checks[6]) detectedLanguages.add("rust");
  if (checks[7]) detectedLanguages.add("go");
  if (checks[8] || checks[9]) detectedLanguages.add("python");
  let projectName = identity.name; if (checks[0]) try { const manifest = JSON.parse(await readFile(`${root}/package.json`, "utf8")) as { name?: string }; if (manifest.name) projectName = manifest.name; } catch {}

  return {
    id: identity.id,
    root,
    name: projectName,
    detectedLanguages: [...detectedLanguages],
    packageManagers
  };
};
