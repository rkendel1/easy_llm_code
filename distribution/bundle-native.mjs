import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const [rootArg, outfile] = process.argv.slice(2);
if (!rootArg || !outfile) throw new Error("Usage: bundle-native.mjs <repository-root> <outfile>");
const root = resolve(rootArg), registry = JSON.parse(await readFile(resolve(root, "node_modules/@easy-llm/llm/registry/snapshots/current.json"), "utf8"));
const embeddedRegistryPlugin = {
  name: "embedded-easy-llm-registry",
  setup(builder) {
    builder.onLoad({ filter: /canonical-loader\.js$/ }, async (args) => {
      if (!args.path.includes("@easy-llm/llm")) return undefined;
      return { loader: "js", contents: `
        import { readFile } from "node:fs/promises";
        import { resolve } from "node:path";
        const embedded = ${JSON.stringify(registry)};
        let cached;
        export async function resolveRegistry(options = {}) {
          if (options.registry) return structuredClone(options.registry);
          if (options.localPath) return JSON.parse(await readFile(resolve(options.localPath), "utf8"));
          if (!cached) cached = embedded;
          return cached;
        }
        export const loadCanonicalRegistry = resolveRegistry;
        export function clearCanonicalRegistryCache() { cached = undefined; }
      ` };
    });
  }
};

await build({ entryPoints: [resolve(root, "packages/agent/src/cli/main.ts")], bundle: true, platform: "node", format: "cjs", target: "node20", outfile, plugins: [embeddedRegistryPlugin], logLevel: "info" });
