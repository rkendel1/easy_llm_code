import type { MutationProposal } from "../mutation/types.js";
import type { AgentPlan } from "../planning/types.js";
import type { TaskMode } from "../task/lifecycle.js";

export type ApprovalDecision = "approved" | "rejected" | "paused";
export type ApprovalHandler = (input: { proposal: MutationProposal; plan: AgentPlan; mode: TaskMode }) => Promise<ApprovalDecision>;
export const defaultApproval: ApprovalHandler = async ({ mode }) => mode === "auto" ? "approved" : "paused";
