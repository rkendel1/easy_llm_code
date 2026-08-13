import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { MemoryConfigurationError } from "./memory-errors.js";

export type MemoryStorageMode = "local" | "hosted" | "hybrid" | "ephemeral";
export interface MemoryRetentionPolicy { taskHistory: "indefinite" | number; executionEvents: number; commandOutput: number; sandboxMetadata: number; derivedPatterns: "indefinite" | number }
export interface MemoryConfig { mode: MemoryStorageMode; baseDirectory: string; hosted?: { url: string; token: string }; retention: MemoryRetentionPolicy }
export const DEFAULT_MEMORY_RETENTION: MemoryRetentionPolicy = { taskHistory: "indefinite", executionEvents: 10_000, commandOutput: 4_000, sandboxMetadata: 2_000, derivedPatterns: "indefinite" };
export const defaultMemoryBaseDirectory = (): string => process.env.EASY_LLM_CODE_MEMORY_HOME ?? join(homedir(), ".easy-llm", "projects");
export const memoryConfigPath = (): string => process.env.EASY_LLM_CODE_MEMORY_CONFIG ?? join(homedir(), ".easy-llm", "memory.json");

export const readMemoryConfig = async (): Promise<MemoryConfig> => {
  let stored: Partial<MemoryConfig> = {};
  try { stored = JSON.parse(await readFile(memoryConfigPath(), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const envMode = process.env.EASY_LLM_CODE_EPHEMERAL_MEMORY === "1" ? "ephemeral" : undefined;
  const mode = envMode ?? stored.mode ?? "local", url = process.env.FELTDB_URL ?? stored.hosted?.url, token = process.env.FELTDB_TOKEN ?? stored.hosted?.token;
  if ((mode === "hosted" || mode === "hybrid") && (!url || !token)) throw new MemoryConfigurationError(`${mode} memory requires FELTDB_URL and FELTDB_TOKEN`);
  return { mode, baseDirectory: process.env.EASY_LLM_CODE_MEMORY_HOME ?? stored.baseDirectory ?? defaultMemoryBaseDirectory(), retention: { ...DEFAULT_MEMORY_RETENTION, ...stored.retention }, ...(url && token ? { hosted: { url, token } } : {}) };
};

export const writeMemoryConfig = async (config: Pick<MemoryConfig, "mode"> & Partial<MemoryConfig>): Promise<void> => {
  const path = memoryConfigPath(), safe = { mode: config.mode, baseDirectory: config.baseDirectory ?? defaultMemoryBaseDirectory(), retention: { ...DEFAULT_MEMORY_RETENTION, ...config.retention }, ...(config.hosted?.url ? { hosted: { url: config.hosted.url } } : {}) };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path);
};

export const projectMemoryPath = (config: Pick<MemoryConfig, "baseDirectory">, projectId: string): string => join(config.baseDirectory, projectId.replace(/[^a-zA-Z0-9._-]/g, "_"), "memory", "project.json");
