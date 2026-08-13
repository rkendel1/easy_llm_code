import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIDERegistry } from "./registry.js";
import { readUserConfig, writeUserConfig } from "../config/user-config.js";
const exec = promisify(execFile);
export const EXTENSION_ID = "easy-llm.easy-llm-code";
export const EXTENSION_DOWNLOAD_URL = "https://github.com/rkendel1/easy_llm_code/releases/latest/download/easy-llm-code-vscode.vsix";

export interface SetupDeepLink { action: "setup"; ide?: string; project?: string }
export const parseSetupDeepLink = (value: string): SetupDeepLink => { const url = new URL(value); if (url.protocol !== "easy-llm-code:" || url.hostname !== "setup") throw new Error("INVALID_SETUP_DEEP_LINK"); return { action: "setup", ...(url.searchParams.get("ide") ? { ide: url.searchParams.get("ide")! } : {}), ...(url.searchParams.get("project") ? { project: url.searchParams.get("project")! } : {}) }; };
export const createSetupDeepLink = (input: Omit<SetupDeepLink, "action"> = {}): string => { const url = new URL("easy-llm-code://setup"); if (input.ide) url.searchParams.set("ide", input.ide); if (input.project) url.searchParams.set("project", input.project); return url.toString(); };

export const installIDEIntegration = async (id: string, runner: typeof exec = exec, fetcher: typeof fetch = fetch): Promise<{ id: string; installed: boolean; detail: string }> => {
  const adapter = createIDERegistry().get(id), detection = await adapter.detect(); let command = ({ cursor: "cursor", vscode: "code" } as Record<string, string>)[id]; if (process.platform === "darwin" && detection.path?.endsWith(".app")) command = join(detection.path, "Contents", "Resources", "app", "bin", id === "cursor" ? "cursor" : "code"); if (id === "zed") return { id, installed: false, detail: `Open Zed Extensions and install ${EXTENSION_ID}; then run easy-llm-code ide use zed.` };
  if (!command) throw new Error(`IDE_EXTENSION_INSTALL_UNSUPPORTED: ${id}`);
  const response = await fetcher(EXTENSION_DOWNLOAD_URL, { headers: { accept: "application/octet-stream" }, signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`IDE_EXTENSION_DOWNLOAD_FAILED: HTTP ${response.status}`); const directory = await mkdtemp(join(tmpdir(), "easy-llm-code-extension-")), extension = join(directory, "easy-llm-code-vscode.vsix");
  try { await writeFile(extension, new Uint8Array(await response.arrayBuffer())); await runner(command, ["--install-extension", extension, "--force"], { timeout: 60_000 }); } finally { await rm(directory, { recursive: true, force: true }); }
  const user = await readUserConfig(); await writeUserConfig({ ...user, selectedIDEInstallations: { ...user.selectedIDEInstallations, [id]: EXTENSION_ID }, preferredIDE: id });
  return { id, installed: true, detail: `${adapter.name} integration installed.` };
};
