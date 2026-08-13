export type ToolEvent =
  | { type: "tool.started"; tool: string; input: unknown }
  | { type: "tool.completed"; tool: string; output: unknown }
  | { type: "tool.failed"; tool: string; error: string }
  | { type: "tool.denied"; tool: string; reason: string };
