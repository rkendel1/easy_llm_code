import type { VerificationStep } from "../verification/types.js";

export type FileOperation = "create" | "modify" | "delete" | "rename";
export interface FilePatch {
  path: string; operation: FileOperation; oldPath?: string;
  beforeHash?: string; afterHash?: string; patch: string;
}
export interface MutationProposal {
  id: string; taskId: string; planId: string; files: FilePatch[];
  rationale: string; expectedChanges: string[]; verification: VerificationStep[];
}
export interface MutationPolicy {
  mode: "propose" | "approve" | "auto"; maxFiles: number; maxChangedLines: number;
  allowCreate: boolean; allowDelete: boolean; allowRename: boolean;
}
export const DEFAULT_MUTATION_POLICY: MutationPolicy = {
  mode: "approve", maxFiles: 10, maxChangedLines: 500,
  allowCreate: true, allowDelete: false, allowRename: false
};
export type MutationErrorCode = "PATH_OUTSIDE_REPOSITORY" | "SYMLINK_ESCAPE" | "STALE_PATCH" | "PATCH_REJECTED" |
  "UNPLANNED_MUTATION" | "POLICY_DENIED" | "PATCH_TOO_LARGE" | "TOO_MANY_FILES" | "TOO_MANY_CHANGED_LINES" |
  "CONFLICTING_USER_CHANGES" | "INVALID_OPERATION" | "GIT_REQUIRED";
export interface MutationIssue { code: MutationErrorCode; message: string; path?: string }
export interface WorkspaceFileState { path: string; existed: boolean; content?: string; hash?: string; mode?: number }
export interface WorkspaceSnapshot { files: WorkspaceFileState[] }
export interface MutationTransaction {
  id: string; taskId: string; proposalId: string; applied: FilePatch[]; inverse: FilePatch[];
  status: "prepared" | "applied" | "verified" | "rolled_back" | "failed";
  createdAt: string; completedAt?: string;
}
export interface ValidatedFilePatch { patch: FilePatch; before: WorkspaceFileState; afterContent?: string; changedLines: number }
export interface MutationValidation { valid: boolean; issues: MutationIssue[]; files: ValidatedFilePatch[]; changedLines: number }
export interface RepairAttempt { id: string; taskId: string; attempt: number; proposalId: string; verificationRunId?: string; status: "proposed" | "applied" | "passed" | "failed" }
export interface TaskOutcome {
  status: "success" | "failure" | "partial"; attempts: number; filesChanged: number; linesChanged: number;
  testsPassed: number; testsFailed: number; verificationPassed: boolean; cost?: number; durationMs?: number;
}
