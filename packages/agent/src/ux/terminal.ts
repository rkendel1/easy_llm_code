import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { ApprovalHandler } from "../policy/approval.js";
import { patchLineCounts } from "../mutation/patch.js";

export const createTerminalApproval = (): ApprovalHandler => async ({ proposal, plan }) => {
  const counts = proposal.files.reduce((total, file) => { const value = patchLineCounts(file.patch); return { additions: total.additions + value.additions, deletions: total.deletions + value.deletions }; }, { additions: 0, deletions: 0 });
  stdout.write(`Changes ready\n${proposal.files.map((file) => ` ${file.operation === "create" ? "A" : file.operation === "delete" ? "D" : "M"} ${file.path}`).join("\n")}\n+${counts.additions} / -${counts.deletions}\n`);
  const rl = createInterface({ input: stdin, output: stdout });
  try { for (;;) { const answer = (await rl.question("Apply changes? [Y]es [n]o [d]iff [p]lan ")).trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") return "approved"; if (answer === "n" || answer === "no") return "rejected";
    if (answer === "d" || answer === "diff") stdout.write(`${proposal.files.map((file) => file.patch).join("\n")}\n`);
    if (answer === "p" || answer === "plan") stdout.write(`${plan.steps.map((step) => `${step.order}. ${step.description}`).join("\n")}\n`);
  } } finally { rl.close(); }
};
