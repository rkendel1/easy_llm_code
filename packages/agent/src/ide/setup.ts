import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createIDERegistry } from "./registry.js";
import { readUserConfig, writeUserConfig } from "../config/user-config.js";
const exec = promisify(execFile);
export const EXTENSION_ID = "easy-llm.easy-llm-code";

export interface SetupDeepLink { action: "setup"; ide?: string; project?: string }
export const parseSetupDeepLink = (value: string): SetupDeepLink => { const url = new URL(value); if (url.protocol !== "easy-llm-code:" || url.hostname !== "setup") throw new Error("INVALID_SETUP_DEEP_LINK"); return { action: "setup", ...(url.searchParams.get("ide") ? { ide: url.searchParams.get("ide")! } : {}), ...(url.searchParams.get("project") ? { project: url.searchParams.get("project")! } : {}) }; };
export const createSetupDeepLink = (input: Omit<SetupDeepLink, "action"> = {}): string => { const url = new URL("easy-llm-code://setup"); if (input.ide) url.searchParams.set("ide", input.ide); if (input.project) url.searchParams.set("project", input.project); return url.toString(); };

export const installIDEIntegration = async (id: string, runner: typeof exec = exec): Promise<{ id: string; installed: boolean; detail: string }> => {
  const adapter = createIDERegistry().get(id), command = ({ cursor: "cursor", vscode: "code" } as Record<string, string>)[id]; if (id === "zed") return { id, installed: false, detail: `Open Zed Extensions and install ${EXTENSION_ID}; then run easy-llm-code ide use zed.` };
  if (!command) throw new Error(`IDE_EXTENSION_INSTALL_UNSUPPORTED: ${id}`);
  await runner(command, ["--install-extension", EXTENSION_ID, "--force"], { timeout: 60_000 }); const user = await readUserConfig(); await writeUserConfig({ ...user, selectedIDEInstallations: { ...user.selectedIDEInstallations, [id]: EXTENSION_ID }, preferredIDE: id });
  return { id, installed: true, detail: `${adapter.name} integration installed.` };
};
