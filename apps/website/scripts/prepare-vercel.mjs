import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const website = resolve(import.meta.dirname, ".."), output = resolve(website, ".vercel/output"), staticDirectory = resolve(output, "static");
await rm(output, { recursive: true, force: true });
await mkdir(staticDirectory, { recursive: true });
await cp(resolve(website, "dist"), staticDirectory, { recursive: true });
await rm(resolve(staticDirectory, "vercel.json"), { force: true });
const security = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" };
await writeFile(resolve(output, "config.json"), `${JSON.stringify({ version: 3, routes: [
  { src: "^/$", dest: "/index.html", headers: security },
  { src: "^/install/?$", dest: "/install/index.html", headers: security },
  { src: "^/install\\.sh$", dest: "/install.sh", headers: { ...security, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" } },
  { src: "^/install\\.ps1$", dest: "/install.ps1", headers: { ...security, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" } },
  { src: "^/(.*)$", headers: security, continue: true }, { handle: "filesystem" }
] }, null, 2)}\n`);
console.log(`Prepared Vercel Build Output at ${output}`);
