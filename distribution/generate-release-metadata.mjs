import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [directoryArg, version, baseURL = "https://easy-llm.dev/releases"] = process.argv.slice(2);
if (!directoryArg || !version) throw new Error("Usage: node generate-release-metadata.mjs <artifact-directory> <version> [base-url]");
const directory = resolve(directoryArg), targets = { DARWIN_ARM64: "easy-llm-code-darwin-arm64", DARWIN_X64: "easy-llm-code-darwin-x64", LINUX_ARM64: "easy-llm-code-linux-arm64", LINUX_X64: "easy-llm-code-linux-x64", WIN32_X64: "easy-llm-code-win32-x64.exe" };
const values = { VERSION: version.replace(/^v/, ""), BASE_URL: baseURL.replace(/\/$/, ""), PUBLISHED_AT: new Date().toISOString() };
for (const [key, filename] of Object.entries(targets)) { const path = join(directory, filename), content = await readFile(path); values[`${key}_SHA256`] = createHash("sha256").update(content).digest("hex"); values[`${key}_SIZE`] = String((await stat(path)).size); await writeFile(`${path}.sha256`, `${values[`${key}_SHA256`]}  ${filename}\n`); }
const render = async (source, target) => { let content = await readFile(source, "utf8"); for (const [key, value] of Object.entries(values)) content = content.replaceAll(`__${key}__`, value); if (/__[A-Z0-9_]+__/.test(content)) throw new Error(`Unresolved release placeholder in ${source}`); await writeFile(target, content); };
await render(new URL("./release-manifest.json.template", import.meta.url), join(directory, "latest.json"));
await render(new URL("./homebrew/Casks/easy-llm-code.rb.template", import.meta.url), join(directory, "easy-llm-code.rb"));
