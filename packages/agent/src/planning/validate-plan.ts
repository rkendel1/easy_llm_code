import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { AgentPlan } from "./types.js";

export interface PlanValidationIssue { code: "INVALID_STRUCTURE" | "INVALID_DEPENDENCY" | "DEPENDENCY_CYCLE" | "PATH_OUTSIDE_REPOSITORY" | "TARGET_NOT_FOUND" | "UNAVAILABLE_CAPABILITY" | "INVALID_EVIDENCE"; message: string; stepId?: string }
export interface ProjectState { root: string; files: string[]; evidenceIds: string[] }
export interface PlanValidationResult { valid: boolean; issues: PlanValidationIssue[] }

const isInside = (root: string, value: string): boolean => { const rel = relative(root, resolve(root, value)); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };
const pathLike = (value: string): boolean => value.includes("/") || /\.[a-z0-9]+$/i.test(value);

export const validatePlan = (plan: AgentPlan, state: ProjectState): PlanValidationResult => {
  const issues: PlanValidationIssue[] = [];
  const actions = new Set(["inspect", "search", "analyze", "modify", "test", "verify"]);
  if (!plan?.objective?.trim() || !plan.id || !plan.taskId || !Array.isArray(plan.steps)) issues.push({ code: "INVALID_STRUCTURE", message: "Plan identity, objective, and steps are required" });
  const ids = new Set<string>();
  for (const step of plan.steps ?? []) {
    if (!step.id || ids.has(step.id)) issues.push({ code: "INVALID_STRUCTURE", message: `Duplicate or missing step ID ${step.id}`, stepId: step.id }); ids.add(step.id);
    if (!Number.isInteger(step.order) || step.order < 1 || !step.description?.trim()) issues.push({ code: "INVALID_STRUCTURE", message: "Step order and description are required", stepId: step.id });
    if (!actions.has(step.action)) issues.push({ code: "INVALID_STRUCTURE", message: `Unknown action ${step.action}`, stepId: step.id });
  }
  const orders = (plan.steps ?? []).map((step) => step.order);
  if (new Set(orders).size !== orders.length || orders.some((order, index) => order !== index + 1)) issues.push({ code: "INVALID_STRUCTURE", message: "Steps must be uniquely and contiguously ordered" });
  for (const step of plan.steps ?? []) {
    for (const dependency of step.dependencies ?? []) if (!ids.has(dependency)) issues.push({ code: "INVALID_DEPENDENCY", message: `Unknown dependency ${dependency}`, stepId: step.id });
    if (step.action === "modify") issues.push({ code: "UNAVAILABLE_CAPABILITY", message: "Write capability is unavailable in PR4", stepId: step.id });
    if (step.target) {
      if (!isInside(state.root, step.target)) issues.push({ code: "PATH_OUTSIDE_REPOSITORY", message: `Target escapes repository: ${step.target}`, stepId: step.id });
      else if (pathLike(step.target)) { const target = normalize(step.target).replace(/\\/g, "/").replace(/\/$/, ""); if (!state.files.includes(target) && !state.files.some((file) => file.startsWith(`${target}/`))) issues.push({ code: "TARGET_NOT_FOUND", message: `Target does not exist: ${step.target}`, stepId: step.id }); }
    }
    if (!step.evidence?.length || step.evidence.some((id) => !state.evidenceIds.includes(id))) issues.push({ code: "INVALID_EVIDENCE", message: "Every step must cite valid evidence", stepId: step.id });
  }
  for (const risk of plan.risks ?? []) if (!risk.evidence?.length || risk.evidence.some((id) => !state.evidenceIds.includes(id))) issues.push({ code: "INVALID_EVIDENCE", message: `Risk ${risk.id} cites invalid evidence` });
  for (const verification of plan.verification ?? []) if (!verification.evidence?.length || verification.evidence.some((id) => !state.evidenceIds.includes(id))) issues.push({ code: "INVALID_EVIDENCE", message: `Verification ${verification.id} cites invalid evidence` });
  for (const path of plan.expectedFiles ?? []) if (!isInside(state.root, path)) issues.push({ code: "PATH_OUTSIDE_REPOSITORY", message: `Expected file escapes repository: ${path}` });
  for (const verification of plan.verification ?? []) if (verification.target && !isInside(state.root, verification.target)) issues.push({ code: "PATH_OUTSIDE_REPOSITORY", message: `Verification target escapes repository: ${verification.target}` });
  const visiting = new Set<string>(), visited = new Set<string>(), byId = new Map((plan.steps ?? []).map((step) => [step.id, step]));
  const visit = (id: string): void => { if (visiting.has(id)) { issues.push({ code: "DEPENDENCY_CYCLE", message: `Dependency cycle at ${id}`, stepId: id }); return; } if (visited.has(id)) return; visiting.add(id); for (const dependency of byId.get(id)?.dependencies ?? []) if (byId.has(dependency)) visit(dependency); visiting.delete(id); visited.add(id); };
  for (const id of ids) visit(id);
  return { valid: issues.length === 0, issues };
};
