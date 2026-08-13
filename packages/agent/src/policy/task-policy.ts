import type { ExecutionPolicy } from "../verification/types.js";
import type { MutationPolicy } from "../mutation/types.js";
import { DEFAULT_MUTATION_POLICY } from "../mutation/types.js";
import { DEFAULT_EXECUTION_POLICY } from "../verification/types.js";

export interface TaskPolicy { mutation: MutationPolicy; execution: ExecutionPolicy; maxRepairAttempts: number }
export const DEFAULT_TASK_POLICY: TaskPolicy = { mutation: DEFAULT_MUTATION_POLICY, execution: DEFAULT_EXECUTION_POLICY, maxRepairAttempts: 2 };
