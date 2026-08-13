import type { AgentEvent } from "../task/events.js";

export const renderAgentEvent = (event: AgentEvent): string => {
  switch (event.type) {
    case "task.started": return `┌─ easy-llm-code ──\nTask ${event.taskId}`;
    case "context.started": return "▸ Understanding repository";
    case "context.completed": return `  ✓ ${event.metrics.selectedCount} context items, ~${event.metrics.estimatedTokens.toLocaleString()} tokens, ${(event.metrics.compressionRatio * 100).toFixed(0)}% reduction`;
    case "planning.started": return "▸ Planning";
    case "plan.created": return `  ✓ Plan ${event.planId}`;
    case "approval.required": return "▸ Changes ready — approval required";
    case "mutation.started": return "▸ Applying approved mutation";
    case "mutation.completed": return `  ✓ ${event.files.join(", ")}`;
    case "verification.started": return `▸ Verifying: ${event.command}`;
    case "verification.completed": return `  ${event.success ? "✓" : "✗"} Verification ${event.success ? "passed" : "failed"}`;
    case "repair.started": return `▸ Repair attempt ${event.attempt}`;
    case "task.paused": return `Task paused safely.\nResume with: llm-code resume ${event.taskId}`;
    case "task.completed": return "✓ Task complete\n└────────────────────";
    case "task.failed": return `✗ Task failed: ${event.reason}\n└────────────────────`;
  }
};
