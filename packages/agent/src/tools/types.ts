export type ToolCapability = "read" | "write" | "execute";
export interface ToolContext { root: string; maxOutputCharacters?: number }
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  capability: ToolCapability;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}
export interface ToolPolicy {
  allowedCapabilities: ToolCapability[];
  allowedTools?: string[];
  deniedTools?: string[];
}
export interface ToolInvocation { tool: string; input: unknown }
export interface ToolExecutionResult { allowed: boolean; output?: unknown; error?: string }
