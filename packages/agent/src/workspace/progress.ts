import type { RuntimeEvent } from "../task/events.js";
import type { WorkspaceProgress, WorkspaceStage } from "./types.js";

const template = (): WorkspaceStage[] => [
  { id: "understand", label: "Understanding the request", status: "pending" },
  { id: "context", label: "Reviewing relevant code and history", status: "pending" },
  { id: "impact", label: "Analyzing likely impact", status: "pending" },
  { id: "change", label: "Preparing change", status: "pending" },
  { id: "verify", label: "Running verification", status: "pending" },
  { id: "complete", label: "Remembering outcome", status: "pending" }
];

export const createProgressProjector = () => {
  const progress: WorkspaceProgress = { stages: template() };
  const activate = (id: string) => { const index = progress.stages.findIndex((stage) => stage.id === id); progress.stages.forEach((stage, item) => { if (item < index && stage.status !== "failed") stage.status = "complete"; else if (item === index) stage.status = "active"; }); };
  return {
    update(event: RuntimeEvent): WorkspaceProgress {
      if ("payload" in event && "sequence" in event) { progress.sandbox = { id: event.sandboxId, network: "restricted" }; return structuredClone(progress); }
      switch (event.type) {
        case "task.started": progress.taskId = event.taskId; activate("understand"); break;
        case "context.started": activate("context"); break;
        case "context.completed": progress.context = { items: event.metrics.selectedCount, estimatedTokens: event.metrics.estimatedTokens }; break;
        case "routing.completed": progress.model = { id: event.model, provider: event.provider, confidence: event.confidence, ...(event.reason ? { reason: event.reason } : {}), ...(event.evidenceCount !== undefined ? { evidenceCount: event.evidenceCount } : {}) }; break;
        case "impact.completed": activate("impact"); break;
        case "planning.started": case "mutation.started": activate("change"); break;
        case "verification.started": activate("verify"); break;
        case "verification.completed": if (!event.success) { const stage = progress.stages.find((item) => item.id === "verify")!; stage.label = "Verification found an issue; investigating repair"; stage.status = "active"; } break;
        case "repair.started": { const stage = progress.stages.find((item) => item.id === "change")!; stage.label = `Repairing the change (attempt ${event.attempt})`; activate("change"); break; }
        case "task.completed": progress.stages.forEach((stage) => stage.status = "complete"); break;
        case "task.failed": { progress.failure = event.reason; const active = progress.stages.find((stage) => stage.status === "active"); if (active) active.status = "failed"; break; }
      }
      return structuredClone(progress);
    },
    current: () => structuredClone(progress)
  };
};
