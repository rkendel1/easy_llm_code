import type { CommandPolicy, NetworkPolicy, ResourceLimits, SandboxCommand, SandboxPolicy } from "./sandbox-types.js";

export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({ maxCpuMs: 300_000, maxMemoryBytes: 1_073_741_824, maxWallTimeMs: 120_000, maxOutputBytes: 1_000_000, maxProcesses: 64, maxFilesystemChanges: 1_000 });
export const DEFAULT_COMMAND_POLICY: Readonly<CommandPolicy> = Object.freeze({ allowedExecutables: ["npm", "pnpm", "yarn", "bun", "cargo", "go", "git"], blockedExecutables: ["sudo", "su", "ssh", "scp", "shutdown", "reboot", "rm", "sh", "bash", "zsh", "fish"], requireApprovalExecutables: ["curl", "wget"] });
export const DEFAULT_SANDBOX_POLICY: Readonly<SandboxPolicy> = Object.freeze({ commands: DEFAULT_COMMAND_POLICY, network: Object.freeze({ mode: "none", hosts: [] }), retention: "retain-on-failure" });
export type CommandPolicyDecision = "allowed" | "blocked" | "requiresApproval";
const basename = (value: string): string => value.split(/[\\/]/).at(-1) ?? value;
export const authorizeSandboxCommand = (command: SandboxCommand, policy: SandboxPolicy): { decision: CommandPolicyDecision; reason: string } => {
  const executable = basename(command.executable);
  if (policy.commands.blockedExecutables.includes(executable)) return { decision: "blocked", reason: `${executable} is explicitly blocked` };
  if (policy.commands.requireApprovalExecutables.includes(executable)) return { decision: "requiresApproval", reason: `${executable} requires explicit approval and network policy authorization` };
  if (!policy.commands.allowedExecutables.includes(executable)) return { decision: "blocked", reason: `${executable} is not in the executable allowlist` };
  if (["npm", "pnpm", "yarn", "bun"].includes(executable)) { const action = command.args[0] ?? ""; if (!["test", "run", "exec"].includes(action)) return { decision: "blocked", reason: `package-manager action ${action || "<empty>"} is not authorized` }; }
  if (executable === "cargo" && !["test", "check", "clippy", "fmt"].includes(command.args[0] ?? "")) return { decision: "blocked", reason: "cargo action is not authorized" };
  if (executable === "go" && !["test", "vet"].includes(command.args[0] ?? "")) return { decision: "blocked", reason: "go action is not authorized" };
  if (executable === "git" && !["status", "diff", "rev-parse", "ls-files"].includes(command.args[0] ?? "")) return { decision: "blocked", reason: "git action is read-only" };
  return { decision: "allowed", reason: "deterministic command policy allowed the structured command" };
};
export const authorizeNetworkHost = (host: string, policy: NetworkPolicy): boolean => policy.mode === "full" || (policy.mode === "allowlist" && policy.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)));
