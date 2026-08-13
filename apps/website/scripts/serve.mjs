import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url))), port = Number(process.env.PORT ?? 4173), types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".sh": "text/plain; charset=utf-8", ".ps1": "text/plain; charset=utf-8" };
const server = createServer(async (request, response) => { try { const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname), safe = normalize(pathname).replace(/^(\.\.[/\\])+/, ""), initial = join(root, safe), path = (await stat(initial).catch(() => undefined))?.isDirectory() ? join(initial, "index.html") : initial; if (path !== root && !path.startsWith(`${root}/`)) throw new Error("path escape"); const content = await readFile(path); response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "cache-control": extname(path) === ".html" ? "no-cache" : "public, max-age=3600" }); response.end(content); } catch { response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); response.end("Not found"); } });
server.listen(port, "127.0.0.1", () => console.log(`easy-llm-code website: http://127.0.0.1:${port}`));
