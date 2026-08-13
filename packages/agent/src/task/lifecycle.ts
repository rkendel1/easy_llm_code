export type TaskMode = "ask" | "plan" | "edit" | "auto";
export type FailureClass = "context" | "planning" | "mutation" | "verification" | "environment" | "policy" | "conflict" | "model" | "unknown";

export const classifyTaskFailure = (error: unknown): FailureClass => {
  const message = (error as Error)?.message ?? String(error);
  if (/CONFLICTING_USER_CHANGES|STALE_PATCH/.test(message)) return "conflict";
  if (/POLICY|APPROVAL|UNPLANNED|PATH_OUTSIDE/.test(message)) return "policy";
  if (/INVALID_PLAN/.test(message)) return "planning";
  if (/MUTATION|PATCH/.test(message)) return "mutation";
  if (/verification|test|typecheck/i.test(message)) return "verification";
  if (/model|llm|structured output/i.test(message)) return "model";
  if (/ENOENT|spawn|timeout/i.test(message)) return "environment";
  return "unknown";
};
