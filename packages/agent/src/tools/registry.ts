import { gitDiffTool } from "./builtin/git-diff.js";
import { gitStatusTool } from "./builtin/git-status.js";
import { listFilesTool } from "./builtin/list-files.js";
import { readFileTool } from "./builtin/read-file.js";
import { searchTool } from "./builtin/search.js";
import type { AgentTool } from "./types.js";

export interface ToolRegistry {
  register(tool: AgentTool): void;
  get(name: string): AgentTool | undefined;
  list(): AgentTool[];
}
export const createToolRegistry = (): ToolRegistry => {
  const tools = new Map<string, AgentTool>();
  return { register(tool) { if (tools.has(tool.name)) throw new Error(`Tool ${tool.name} already registered`); tools.set(tool.name, tool); },
    get: (name) => tools.get(name), list: () => [...tools.values()].sort((a, b) => a.name.localeCompare(b.name)) };
};
export const createBuiltinToolRegistry = (): ToolRegistry => {
  const registry = createToolRegistry();
  for (const tool of [readFileTool, listFilesTool, searchTool, gitStatusTool, gitDiffTool]) registry.register(tool);
  return registry;
};
