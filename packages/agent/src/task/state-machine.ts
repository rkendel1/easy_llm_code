export type TaskState = "created" | "contextualizing" | "planning" | "awaiting_approval" | "mutating" | "verifying" | "repairing" | "completed" | "failed" | "cancelled" | "paused";

const TRANSITIONS: Record<TaskState, TaskState[]> = {
  created: ["contextualizing", "cancelled"], contextualizing: ["planning", "completed", "failed", "paused", "cancelled"],
  planning: ["awaiting_approval", "completed", "failed", "paused", "cancelled"],
  awaiting_approval: ["mutating", "cancelled", "paused"], mutating: ["verifying", "failed", "paused", "cancelled"],
  verifying: ["completed", "repairing", "failed", "paused", "cancelled"], repairing: ["mutating", "failed", "paused", "cancelled"],
  completed: [], failed: [], cancelled: [], paused: ["contextualizing", "planning", "awaiting_approval", "mutating", "verifying", "repairing", "cancelled"]
};
export const canTransition = (from: TaskState, to: TaskState): boolean => TRANSITIONS[from].includes(to);
export const transitionTaskState = (from: TaskState, to: TaskState): TaskState => { if (!canTransition(from, to)) throw new Error(`INVALID_TASK_TRANSITION: ${from} -> ${to}`); return to; };
export const allowedTaskTransitions = (state: TaskState): readonly TaskState[] => TRANSITIONS[state];
