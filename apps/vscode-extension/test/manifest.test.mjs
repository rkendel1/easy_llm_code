import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
test("contributes the easy-llm-code chat sidebar and provider commands", () => { assert.equal(manifest.main, "./dist/extension.js"); assert.ok(manifest.contributes.views.easyLlmCode.some((view) => view.id === "easyLlmCode.chat" && view.type === "webview")); for (const command of ["easyLlmCode.setupProvider", "easyLlmCode.unlockProvider", "easyLlmCode.refresh"]) assert.ok(manifest.contributes.commands.some((item) => item.command === command)); });
test("uses the marketplace identifier expected by CLI installation", () => { assert.equal(`${manifest.publisher}.${manifest.name}`, "easy-llm.easy-llm-code"); });
