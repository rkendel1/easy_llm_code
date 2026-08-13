import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PRODUCT_VERSION, detectInstallKind } from "./version.js";
import { resolvePlatform, type SupportedPlatform } from "./platform.js";
import { readUserConfig, writeUserConfig } from "../config/user-config.js";

export interface UpdateArtifact { url: string; sha256: string; size?: number }
export interface UpdateManifest { schemaVersion: 1; version: string; publishedAt: string; artifacts: Partial<Record<SupportedPlatform, UpdateArtifact>> }
export interface UpdateResult { status: "current" | "available" | "updated" | "unsupported"; currentVersion: string; latestVersion?: string; message?: string }

const compare = (left: string, right: string): number => { const a = left.replace(/^v/, "").split(".").map(Number), b = right.replace(/^v/, "").split(".").map(Number); for (let index = 0; index < 3; index++) { const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference) return difference; } return 0; };
export const verifyArtifact = (content: Uint8Array, expected: string): boolean => createHash("sha256").update(content).digest("hex") === expected.toLowerCase();
export const resolveUpdateArtifact = (manifest: UpdateManifest, platform = resolvePlatform()): UpdateArtifact => { const artifact = manifest.artifacts[platform]; if (!artifact) throw new Error(`UPDATE_ARTIFACT_MISSING: ${platform}`); return artifact; };

export const fetchUpdateManifest = async (url = process.env.EASY_LLM_CODE_UPDATE_MANIFEST ?? "https://github.com/rkendel1/easy_llm_code/releases/latest/download/latest.json"): Promise<UpdateManifest> => { const response = await fetch(url, { headers: { accept: "application/json", "user-agent": `easy-llm-code/${PRODUCT_VERSION}` }, signal: AbortSignal.timeout(5_000) }); if (!response.ok) throw new Error(`UPDATE_MANIFEST_HTTP_${response.status}`); const value = await response.json() as UpdateManifest; if (value.schemaVersion !== 1 || !value.version || !value.artifacts) throw new Error("UPDATE_MANIFEST_INVALID"); return value; };

export const checkForUpdate = async (manifest?: UpdateManifest): Promise<UpdateResult> => { const latest = manifest ?? await fetchUpdateManifest(); return compare(latest.version, PRODUCT_VERSION) > 0 ? { status: "available", currentVersion: PRODUCT_VERSION, latestVersion: latest.version } : { status: "current", currentVersion: PRODUCT_VERSION, latestVersion: latest.version }; };

export const applyNativeUpdate = async (input: { manifest?: UpdateManifest; executable?: string; platform?: SupportedPlatform; fetcher?: typeof fetch }): Promise<UpdateResult> => {
  const kind = detectInstallKind(), executable = input.executable ?? process.execPath;
  if (kind === "npm" || kind === "homebrew" || kind === "development") return { status: "unsupported", currentVersion: PRODUCT_VERSION, message: kind === "npm" ? "Update with: npm install -g @easy-llm/code-agent" : kind === "homebrew" ? "Update with: brew upgrade --cask easy-llm-code" : "Self-update is disabled in development builds." };
  const manifest = input.manifest ?? await fetchUpdateManifest(), available = await checkForUpdate(manifest); if (available.status === "current") return available;
  const artifact = resolveUpdateArtifact(manifest, input.platform), response = await (input.fetcher ?? fetch)(artifact.url); if (!response.ok) throw new Error(`UPDATE_ARTIFACT_HTTP_${response.status}`); const content = new Uint8Array(await response.arrayBuffer());
  if (artifact.size !== undefined && content.byteLength !== artifact.size) throw new Error("UPDATE_ARTIFACT_SIZE_MISMATCH"); if (!verifyArtifact(content, artifact.sha256)) throw new Error("UPDATE_ARTIFACT_INTEGRITY_FAILED");
  const directory = dirname(executable), staged = join(directory, `.easy-llm-code-${manifest.version}.new`), backup = join(directory, ".easy-llm-code.previous"); await mkdir(directory, { recursive: true }); await writeFile(staged, content, { mode: 0o755 }); await chmod(staged, 0o755);
  try { await rm(backup, { force: true }); await copyFile(executable, backup); await rename(staged, executable); } catch (error) { await rm(staged, { force: true }); try { await copyFile(backup, executable); } catch {} throw error; }
  return { status: "updated", currentVersion: PRODUCT_VERSION, latestVersion: manifest.version };
};

export const rollbackNativeUpdate = async (executable = process.execPath): Promise<void> => { const backup = join(dirname(executable), ".easy-llm-code.previous"); await readFile(backup); await copyFile(backup, executable); await chmod(executable, 0o755); };

export const applyAutomaticUpdate = async (now = new Date()): Promise<UpdateResult | undefined> => {
  if (detectInstallKind() !== "native" || process.env.EASY_LLM_CODE_DISABLE_AUTO_UPDATE === "1") return undefined;
  const user = await readUserConfig(), last = user.installation?.lastUpdateCheckAt; if (last && now.getTime() - Date.parse(last) < 86_400_000) return undefined;
  await writeUserConfig({ ...user, installation: { ...user.installation, kind: "native", lastUpdateCheckAt: now.toISOString() } });
  return applyNativeUpdate({});
};
