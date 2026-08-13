import type { AgentEvent } from "../task/events.js";
export interface TaskProgress { context: boolean; plan: boolean; mutation: boolean; verification: boolean; repairs: number; terminal?: "completed" | "failed" | "paused" }
export const createTaskProgress = () => {
  const value: TaskProgress = { context: false, plan: false, mutation: false, verification: false, repairs: 0 };
  return { value, update(event: AgentEvent) { if (event.type === "context.completed") value.context = true; if (event.type === "plan.created") value.plan = true; if (event.type === "mutation.completed") value.mutation = true; if (event.type === "verification.completed") value.verification = event.success; if (event.type === "repair.started") value.repairs = event.attempt; if (event.type === "task.completed") value.terminal = "completed"; if (event.type === "task.failed") value.terminal = "failed"; if (event.type === "task.paused") value.terminal = "paused"; return value; } };
};
