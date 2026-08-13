import type { TaskMode } from "../task/lifecycle.js";
const changeIntent = /\b(add|change|create|delete|fix|implement|modify|refactor|remove|rename|update|write|migrate|repair)\b/i;
const questionIntent = /^(why|what|whats|how|where|when|who|explain|investigate|look at|review|status|is |are |can you explain)\b/i;
export const inferWorkspaceTaskMode = (request: string): TaskMode => changeIntent.test(request) ? "auto" : questionIntent.test(request.trim()) || request.trim().endsWith("?") ? "ask" : "auto";

const exitIntents = new Set(["/exit", "/quit", "exit", "quit", "nothing", "nothing else", "no", "no thanks", "nevermind", "never mind"]);
export const isWorkspaceExitIntent = (request: string): boolean => exitIntents.has(request.trim().toLowerCase().replace(/[.!]+$/, ""));
