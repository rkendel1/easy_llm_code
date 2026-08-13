export const PRODUCT_NAME = "easy-llm-code";
export const PRODUCT_VERSION = "0.2.4";
export const COMPATIBILITY_COMMAND = "llm-code";

export type InstallKind = "native" | "homebrew" | "npm" | "development" | "unknown";

export const detectInstallKind = (environment: NodeJS.ProcessEnv = process.env, executable = process.argv[1] ?? ""): InstallKind => {
  const explicit = environment.EASY_LLM_CODE_INSTALL_KIND;
  if (explicit && ["native", "homebrew", "npm", "development"].includes(explicit)) return explicit as InstallKind;
  if (executable.includes("Cellar") || executable.includes("Caskroom") || executable.includes("homebrew")) return "homebrew";
  if (executable.includes("node_modules") || executable.includes("npm")) return "npm";
  if (executable.includes("/src/") || executable.endsWith(".ts")) return "development";
  return executable ? "native" : "unknown";
};
