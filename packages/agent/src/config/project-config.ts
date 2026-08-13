import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NetworkMode } from "../sandbox/core/sandbox-types.js";
import { defaultMemoryBaseDirectory } from "../memory/core/memory-config.js";

export interface ProjectConfig {
  version: 1;
  initialized: boolean;
  memory: { provider: "local" | "hosted" | "hybrid"; sync: boolean };
  model: { mode: "automatic" | "explicit"; model?: string };
  routing: { mode: "automatic" };
  execution: { sandbox: boolean; networkPolicy: NetworkMode; riskPolicy: "safe" | "standard" | "aggressive" };
  verification: { enabled: boolean; repairAttempts: number };
  ide: { adapter?: string; automaticDetection: boolean };
  context: { automatic: boolean; gitHistory: boolean };
  telemetry: "local-project-memory-only";
  initializedAt?: string;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = { version: 1, initialized: false, memory: { provider: "local", sync: false }, model: { mode: "automatic" }, routing: { mode: "automatic" }, execution: { sandbox: true, networkPolicy: "none", riskPolicy: "standard" }, verification: { enabled: true, repairAttempts: 2 }, ide: { automaticDetection: true }, context: { automatic: true, gitHistory: true }, telemetry: "local-project-memory-only" };
export const projectConfigPath = (projectId: string): string => join(defaultMemoryBaseDirectory(), projectId.replace(/[^a-zA-Z0-9._-]/g, "_"), "project-config.json");
const merge = (value: Partial<ProjectConfig>): ProjectConfig => ({ ...DEFAULT_PROJECT_CONFIG, ...value, memory: { ...DEFAULT_PROJECT_CONFIG.memory, ...value.memory }, model: { ...DEFAULT_PROJECT_CONFIG.model, ...value.model }, routing: { ...DEFAULT_PROJECT_CONFIG.routing, ...value.routing }, execution: { ...DEFAULT_PROJECT_CONFIG.execution, ...value.execution }, verification: { ...DEFAULT_PROJECT_CONFIG.verification, ...value.verification }, ide: { ...DEFAULT_PROJECT_CONFIG.ide, ...value.ide }, context: { ...DEFAULT_PROJECT_CONFIG.context, ...value.context } });
export const readProjectConfig = async (projectId: string): Promise<ProjectConfig> => { try { return merge(JSON.parse(await readFile(projectConfigPath(projectId), "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return DEFAULT_PROJECT_CONFIG; } };
export const writeProjectConfig = async (projectId: string, config: ProjectConfig): Promise<void> => { const path = projectConfigPath(projectId), temporary = `${path}.${randomUUID()}.tmp`; await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); };
export const updateProjectSetting = async (projectId: string, key: string, raw: string): Promise<ProjectConfig> => { const config = structuredClone(await readProjectConfig(projectId)), boolean = () => { if (!/^(true|false)$/.test(raw)) throw new Error(`Invalid boolean: ${raw}`); return raw === "true"; }, integer = () => { const value = Number(raw); if (!Number.isInteger(value) || value < 0 || value > 10) throw new Error(`Invalid bounded integer: ${raw}`); return value; }; switch (key) { case "memory.provider": if (!["local", "hosted", "hybrid"].includes(raw)) throw new Error(`Invalid memory provider: ${raw}`); config.memory.provider = raw as ProjectConfig["memory"]["provider"]; break; case "memory.sync": config.memory.sync = boolean(); break; case "model.mode": if (!["automatic", "explicit"].includes(raw)) throw new Error(`Invalid model mode: ${raw}`); config.model.mode = raw as ProjectConfig["model"]["mode"]; break; case "model.model": config.model.model = raw; config.model.mode = "explicit"; break; case "execution.sandbox": config.execution.sandbox = boolean(); break; case "execution.networkPolicy": if (!["none", "allowlist", "full"].includes(raw)) throw new Error(`Invalid network policy: ${raw}`); config.execution.networkPolicy = raw as NetworkMode; break; case "execution.riskPolicy": if (!["safe", "standard", "aggressive"].includes(raw)) throw new Error(`Invalid risk policy: ${raw}`); config.execution.riskPolicy = raw as ProjectConfig["execution"]["riskPolicy"]; break; case "verification.enabled": config.verification.enabled = boolean(); break; case "verification.repairAttempts": config.verification.repairAttempts = integer(); break; case "ide.adapter": config.ide.adapter = raw; break; case "context.automatic": config.context.automatic = boolean(); break; case "context.gitHistory": config.context.gitHistory = boolean(); break; default: throw new Error(`Unknown or secret setting: ${key}`); } await writeProjectConfig(projectId, config); return config; };
