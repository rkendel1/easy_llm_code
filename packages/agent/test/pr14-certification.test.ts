import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyNativeUpdate, checkForUpdate, resolvePlatform, resolveUpdateArtifact, rollbackNativeUpdate, verifyArtifact, type UpdateManifest } from "../src/installation/index.js";
import { createSetupDeepLink, EXTENSION_DOWNLOAD_URL, installIDEIntegration, parseSetupDeepLink } from "../src/ide/setup.js";

const originalKind = process.env.EASY_LLM_CODE_INSTALL_KIND;
const originalUserConfig = process.env.EASY_LLM_CODE_USER_CONFIG;
afterEach(() => { if (originalKind === undefined) delete process.env.EASY_LLM_CODE_INSTALL_KIND; else process.env.EASY_LLM_CODE_INSTALL_KIND = originalKind; if (originalUserConfig === undefined) delete process.env.EASY_LLM_CODE_USER_CONFIG; else process.env.EASY_LLM_CODE_USER_CONFIG = originalUserConfig; });
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

describe("PR14 zero-friction installation certification", () => {
  it("publishes the canonical command with the compatibility alias and npm fallback", async () => {
    const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    expect(manifest.private).toBe(false);
    expect(manifest.bin).toEqual({ "easy-llm-code": "dist/cli/main.js", "llm-code": "dist/cli/main.js" });
    expect(manifest.engines.node).toBe(">=20");
  });

  it("resolves every certified release platform and rejects unknown targets", () => {
    expect(resolvePlatform("darwin", "arm64")).toBe("darwin-arm64"); expect(resolvePlatform("darwin", "x64")).toBe("darwin-x64");
    expect(resolvePlatform("linux", "arm64")).toBe("linux-arm64"); expect(resolvePlatform("linux", "x64")).toBe("linux-x64"); expect(resolvePlatform("win32", "x64")).toBe("win32-x64");
    expect(() => resolvePlatform("freebsd", "x64")).toThrow("UNSUPPORTED_PLATFORM");
  });

  it("selects versioned artifacts and refuses altered downloads", async () => {
    const content = new TextEncoder().encode("native-runtime"), artifact = { url: "https://release.invalid/runtime", sha256: digest(content), size: content.byteLength }, manifest: UpdateManifest = { schemaVersion: 1, version: "9.0.0", publishedAt: "2026-08-13T00:00:00.000Z", artifacts: { "linux-x64": artifact } };
    expect((await checkForUpdate(manifest)).status).toBe("available"); expect(resolveUpdateArtifact(manifest, "linux-x64")).toEqual(artifact); expect(verifyArtifact(content, artifact.sha256)).toBe(true); expect(verifyArtifact(new TextEncoder().encode("tampered"), artifact.sha256)).toBe(false);
  });

  it("activates a verified native update atomically and can roll back", async () => {
    process.env.EASY_LLM_CODE_INSTALL_KIND = "native"; const directory = await mkdtemp(join(tmpdir(), "pr14-update-")), executable = join(directory, "easy-llm-code"), oldRuntime = "old-runtime", nextRuntime = new TextEncoder().encode("new-runtime"); await writeFile(executable, oldRuntime); await chmod(executable, 0o755);
    const manifest: UpdateManifest = { schemaVersion: 1, version: "9.0.0", publishedAt: "2026-08-13T00:00:00.000Z", artifacts: { "linux-x64": { url: "https://release.invalid/runtime", sha256: digest(nextRuntime), size: nextRuntime.byteLength } } };
    const result = await applyNativeUpdate({ manifest, executable, platform: "linux-x64", fetcher: async () => new Response(nextRuntime) }); expect(result.status).toBe("updated"); expect(await readFile(executable, "utf8")).toBe("new-runtime"); if (process.platform !== "win32") expect((await stat(executable)).mode & 0o111).not.toBe(0);
    await rollbackNativeUpdate(executable); expect(await readFile(executable, "utf8")).toBe(oldRuntime);
  });

  it("keeps setup deep links runtime-agnostic and project-associated", () => {
    const link = createSetupDeepLink({ ide: "cursor", project: "/work/example" }); expect(parseSetupDeepLink(link)).toEqual({ action: "setup", ide: "cursor", project: "/work/example" }); expect(() => parseSetupDeepLink("https://example.com/setup")).toThrow("INVALID_SETUP_DEEP_LINK");
  });

  it("installs the release VSIX through the detected VS Code command", async () => {
    process.env.EASY_LLM_CODE_USER_CONFIG = join(await mkdtemp(join(tmpdir(), "pr14-ide-")), "user.json");
    const calls: Array<{ command: string; args: string[] }> = []; const result = await installIDEIntegration("vscode", async (command, args) => { calls.push({ command, args }); return { stdout: "", stderr: "" }; }, async (url) => { expect(url).toBe(EXTENSION_DOWNLOAD_URL); return new Response("vsix"); });
    expect(result.installed).toBe(true); expect(calls[0].command).toMatch(/(?:^|\/)code$/); expect(calls[0].args[0]).toBe("--install-extension"); expect(calls[0].args[1]).toMatch(/easy-llm-code-vscode\.vsix$/); expect(calls[0].args[2]).toBe("--force");
  });

  it("ships integrity-checking installers, uninstallers, release metadata, and Homebrew generation", async () => {
    const root = resolve("../.."), unix = await readFile(join(root, "distribution/install.sh"), "utf8"), windows = await readFile(join(root, "distribution/install.ps1"), "utf8"), manifest = await readFile(join(root, "distribution/release-manifest.json.template"), "utf8"), cask = await readFile(join(root, "distribution/homebrew/Casks/easy-llm-code.rb.template"), "utf8");
    expect(unix).toContain("sha256sum"); expect(unix).toContain("llm-code"); expect(windows).toContain("Get-FileHash"); expect(manifest).toContain("linux-arm64"); expect(manifest).toContain("win32-x64"); expect(cask).toContain('cask "easy-llm-code"');
    await expect(readFile(join(root, "distribution/uninstall.sh"), "utf8")).resolves.toContain("preserved"); await expect(readFile(join(root, "distribution/uninstall.ps1"), "utf8")).resolves.toContain("preserved");
  });
});
