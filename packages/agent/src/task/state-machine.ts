export type TaskState = "created" | "contextualizing" | "planning" | "awaiting_approval" | "mutating" | "verifying" | "reviewing" | "repairing" | "replanning" | "completed" | "failed" | "cancelled" | "paused";

const TRANSITIONS: Record<TaskState, TaskState[]> = {
  created: ["contextualizing", "cancelled"], contextualizing: ["planning", "completed", "failed", "paused", "cancelled"],
  planning: ["awaiting_approval", "completed", "failed", "paused", "cancelled"],
  awaiting_approval: ["mutating", "cancelled", "paused"], mutating: ["verifying", "failed", "paused", "cancelled"],
  verifying: ["reviewing", "completed", "repairing", "replanning", "failed", "paused", "cancelled"], reviewing: ["verifying", "completed", "repairing", "replanning", "failed", "paused", "cancelled"], repairing: ["mutating", "replanning", "failed", "paused", "cancelled"], replanning: ["repairing", "awaiting_approval", "mutating", "failed", "paused", "cancelled"],
  completed: [], failed: ["contextualizing"], cancelled: [], paused: ["contextualizing", "planning", "awaiting_approval", "mutating", "verifying", "reviewing", "repairing", "replanning", "cancelled"]
};
export const canTransition = (from: TaskState, to: TaskState): boolean => TRANSITIONS[from].includes(to);
export const transitionTaskState = (from: TaskState, to: TaskState): TaskState => { if (!canTransition(from, to)) throw new Error(`INVALID_TASK_TRANSITION: ${from} -> ${to}`); return to; };
export const allowedTaskTransitions = (state: TaskState): readonly TaskState[] => TRANSITIONS[state];
