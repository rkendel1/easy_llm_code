import type { AgentTool, ToolPolicy } from "./types.js";

export const READ_ONLY_POLICY: ToolPolicy = { allowedCapabilities: ["read"] };

export const authorizeTool = (tool: AgentTool, policy: ToolPolicy): { allowed: boolean; reason?: string } => {
  if (policy.deniedTools?.includes(tool.name)) return { allowed: false, reason: `Tool ${tool.name} is explicitly denied` };
  if (policy.allowedTools && !policy.allowedTools.includes(tool.name)) return { allowed: false, reason: `Tool ${tool.name} is not allowlisted` };
  if (!policy.allowedCapabilities.includes(tool.capability)) return { allowed: false, reason: `Capability ${tool.capability} is not allowed` };
  return { allowed: true };
};
