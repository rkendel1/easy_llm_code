import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IntelligentContextBundle } from "../context/types.js";
import type { Project } from "../memory/types.js";

export type TaskType = "question" | "investigation" | "planning" | "bugfix" | "refactor" | "feature" | "test" | "documentation";
export interface TaskProfile {
  taskType: TaskType; languages: string[]; frameworks: string[]; estimatedComplexity: "low" | "medium" | "high";
  requiresReasoning: boolean; requiresVision: boolean; requiresTools: boolean; expectedFiles: number; expectedChanges: number; contextSize: number;
  subsystem?: string;
}
const classifyType = (request: string): TaskType => {
  const value = request.toLowerCase();
  if (/\b(fix|bug|broken|regression|race|error|failure)\b/.test(value)) return "bugfix";
  if (/\b(refactor|restructure|extract|migrate|rename)\b/.test(value)) return "refactor";
  if (/\b(test|coverage|spec)\b/.test(value)) return "test";
  if (/\b(document|docs|readme|comment)\b/.test(value)) return "documentation";
  if (/\b(add|create|implement|feature|support)\b/.test(value)) return "feature";
  if (/\b(plan|design|approach)\b/.test(value)) return "planning";
  if (/\b(investigate|trace|diagnose|why)\b/.test(value)) return "investigation";
  return "question";
};
const subsystemFrom = (request: string, context: IntelligentContextBundle): string | undefined => {
  const known = ["authentication", "auth", "billing", "checkout", "users", "database", "api", "session", "payments"];
  const requestMatch = known.find((item) => request.toLowerCase().includes(item)); if (requestMatch) return requestMatch === "authentication" ? "auth" : requestMatch;
  const path = context.files[0]?.path.split("/").filter(Boolean); return path && path.length > 1 ? path.at(-2) : undefined;
};
export const createTaskProfile = async (request: string, project: Project, context: IntelligentContextBundle): Promise<TaskProfile> => {
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { manifest = JSON.parse(await readFile(join(project.root, "package.json"), "utf8")); } catch { /* non-Node project */ }
  const dependencies = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
  const frameworks = ["react", "next", "express", "@nestjs/core", "vue", "svelte", "angular", "fastify"].filter((item) => dependencies.has(item));
  const taskType = classifyType(request), expectedFiles = Math.max(1, context.files.length), highSignal = /\b(race|concurr|security|architecture|migration|distributed|cross-cutting)\b/i.test(request);
  const mutating = ["bugfix", "refactor", "feature", "test"].includes(taskType);
  const estimatedComplexity = highSignal || (mutating && expectedFiles >= 8) ? "high" : mutating || ["planning", "investigation"].includes(taskType) ? "medium" : "low";
  const languages = [...new Set([...project.detectedLanguages, ...context.files.map((file) => file.language).filter((value): value is string => Boolean(value))])].sort();
  return { taskType, languages, frameworks, estimatedComplexity,
    requiresReasoning: estimatedComplexity !== "low" || ["investigation", "planning", "bugfix", "refactor"].includes(taskType),
    requiresVision: /\b(image|screenshot|visual|pixel|ui mockup)\b/i.test(request),
    requiresTools: !["question", "documentation"].includes(taskType), expectedFiles,
    expectedChanges: ["question", "investigation", "planning"].includes(taskType) ? 0 : Math.max(1, Math.ceil(expectedFiles / 2)),
    contextSize: context.estimatedTokens, subsystem: subsystemFrom(request, context) };
};
