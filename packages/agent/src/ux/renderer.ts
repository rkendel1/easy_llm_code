import type { AgentEvent } from "../task/events.js";

export const renderAgentEvent = (event: AgentEvent): string => {
  switch (event.type) {
    case "task.started": return `┌─ easy-llm-code ──\nTask ${event.taskId}`;
    case "context.started": return "▸ Understanding repository";
    case "context.completed": return `  ✓ ${event.metrics.selectedCount} context items, ~${event.metrics.estimatedTokens.toLocaleString()} tokens, ${(event.metrics.compressionRatio * 100).toFixed(0)}% reduction`;
    case "routing.completed": return `  ✓ Routed to ${event.provider}/${event.model} (${event.confidence} confidence, ${event.score.toFixed(3)})`;
    case "impact.completed": return `  ✓ Predicted ${event.affectedFiles} affected files and ${event.affectedTests} tests (${Math.round(event.confidence * 100)}% confidence)`;
    case "execution.started": return `▸ Autonomous execution (${event.mode})`;
    case "execution.iteration.started": return `▸ Iteration ${event.iteration}`;
    case "assumption.checked": return `  Assumption ${event.assumptionId}: ${event.status}`;
    case "assumption.contradicted": return `  ✗ Assumption contradicted: ${event.assumptionId}`;
    case "impact.recalculated": return `  Impact recalculated: ${event.addedFiles.length} new file(s)`;
    case "context.refresh.started": return `▸ Refreshing context: ${event.reason}`;
    case "context.refresh.completed": return `  ✓ Refreshed ${event.metrics.selectedCount} context items`;
    case "routing.reconsidered": return `▸ Reconsidering routing for iteration ${event.iteration}`;
    case "model.switched": return `  Model switched ${event.from} → ${event.to}`;
    case "verification.escalated": return `  Verification escalated ${event.from} → ${event.to}`;
    case "execution.decision": return `  Decision: ${event.decision.action.toUpperCase()} — ${event.decision.reason}`;
    case "execution.replanned": return `  ✓ Replanned as ${event.planId}`;
    case "review.started": return "▸ Autonomous review";
    case "review.completed": return `  ${event.review.status === "pass" ? "✓" : "✗"} Review ${event.review.status}`;
    case "execution.risk": return `  Risk: ${event.risk.level.toUpperCase()} (${Math.round(event.risk.score * 100)}%)`;
    case "execution.budget.warning": return `  Budget warning: ${event.dimensions.join(", ")}`;
    case "execution.budget.exhausted": return `  Budget exhausted: ${event.dimensions.join(", ")}`;
    case "execution.completed": return "  ✓ Autonomous execution complete";
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
