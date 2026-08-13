import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export interface UserConfig { version: 1; selectedIDEInstallations: Record<string, string>; preferredIDE?: string; vaultConfigured: boolean }
export const DEFAULT_USER_CONFIG: UserConfig = { version: 1, selectedIDEInstallations: {}, vaultConfigured: false };
export const userConfigPath = (): string => process.env.EASY_LLM_CODE_USER_CONFIG ?? join(homedir(), ".config", "easy-llm-code", "user.json");
export const readUserConfig = async (): Promise<UserConfig> => { try { return { ...DEFAULT_USER_CONFIG, ...JSON.parse(await readFile(userConfigPath(), "utf8")) }; } catch { return DEFAULT_USER_CONFIG; } };
export const writeUserConfig = async (value: UserConfig): Promise<void> => { const path = userConfigPath(), temporary = `${path}.${randomUUID()}.tmp`; await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); };
