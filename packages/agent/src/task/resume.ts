import type { createTaskRunner } from "./runner.js";
export const resumeTask = (runner: ReturnType<typeof createTaskRunner>, taskId: string) => runner.resume(taskId);
