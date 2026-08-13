import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), source = resolve(root, "apps/website/src"), output = resolve(root, "apps/website/dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await cp(resolve(root, "distribution/install.sh"), resolve(output, "install.sh"));
await cp(resolve(root, "distribution/install.ps1"), resolve(output, "install.ps1"));
console.log(`Built website at ${output}`);
