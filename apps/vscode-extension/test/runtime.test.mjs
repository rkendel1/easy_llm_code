import test from "node:test";
import assert from "node:assert/strict";
import { parseRuntimeConnection, runtimeClientOptions } from "../dist/runtime.js";
test("parses the authenticated runtime handshake amid startup output", () => { assert.deepEqual(parseRuntimeConnection("indexed\nURL: http://127.0.0.1:4123\nSession: abc\nToken: secret\n"), { url: "http://127.0.0.1:4123", token: "secret" }); assert.equal(parseRuntimeConnection("URL: http://127.0.0.1:1\n"), undefined); });
test("maps the CLI URL to RuntimeClient's baseUrl contract", () => { assert.deepEqual(runtimeClientOptions({ url: "http://127.0.0.1:4123", token: "secret" }), { baseUrl: "http://127.0.0.1:4123", token: "secret", pollIntervalMs: 200 }); });
