import type { ProjectMemory } from "../memory/project-memory.js";
import type { Project } from "../memory/types.js";
import { ingestRepositoryHistory } from "../history/ingest-history.js";
import { reconcileProjectMemory } from "../memory/lifecycle/reconcile.js";
import { createIDERegistry } from "../ide/registry.js";
import { writeIDEConfiguration } from "../ide/config.js";
import { initializeModelCX } from "../model/llm-cx.js";
import { readProjectConfig, writeProjectConfig } from "../config/project-config.js";
import { readUserConfig, writeUserConfig } from "../config/user-config.js";
import type { OnboardingResult } from "./types.js";

export const onboardProject = async (input: { project: Project; memory: ProjectMemory; selectIDE?: (choices: Array<{ id: string; name: string }>) => Promise<string | undefined> }): Promise<OnboardingResult> => {
  const prior = await readProjectConfig(input.project.id), registry = createIDERegistry(), detection = await registry.detect(), detected = detection.filter((item) => item.detection.detected), model = await initializeModelCX();
  let selectedIDE = prior.ide.adapter; if (!selectedIDE && detected.length === 1) selectedIDE = detected[0].adapter.id; else if (!selectedIDE && detected.length > 1) selectedIDE = await input.selectIDE?.(detected.map((item) => ({ id: item.adapter.id, name: item.adapter.name }))) ?? detected[0].adapter.id;
  const config = { ...prior, initialized: true, memory: { provider: prior.memory.provider ?? "local", sync: prior.memory.sync ?? false }, model: { mode: prior.model.mode ?? "automatic", ...(prior.model.model ? { model: prior.model.model } : {}) }, ide: { ...prior.ide, ...(selectedIDE ? { adapter: selectedIDE } : {}) }, initializedAt: prior.initializedAt ?? new Date().toISOString() } as const;
  await writeProjectConfig(input.project.id, config); if (selectedIDE) { const user = await readUserConfig(); await writeUserConfig({ ...user, preferredIDE: selectedIDE }); await writeIDEConfiguration({ selectedIDE }); }
  const reconciliation = await reconcileProjectMemory(input.project.root, input.project, input.memory), history = config.context.gitHistory ? await ingestRepositoryHistory(input.project.root, input.memory) : { indexedCommits: 0, skipped: true }; await input.memory.persist();
  const statistics = await input.memory.getGraphStatistics();
  return { firstRun: !prior.initialized, project: input.project.name, config, detectedIDEs: detection.map((item) => ({ id: item.adapter.id, name: item.adapter.name, detected: item.detection.detected })), ...(selectedIDE ? { selectedIDE } : {}), model, steps: [
    { id: "project", label: "Project identified", status: "ready", detail: input.project.name },
    { id: "memory", label: "Local memory initialized", status: "ready" },
    { id: "index", label: "Repository indexed", status: "ready", detail: reconciliation.changed ? `${reconciliation.indexed?.files.length ?? 0} files reconciled` : `${statistics.nodes.files ?? 0} files already current` },
    { id: "history", label: "Git history connected", status: "ready", detail: `${history.indexedCommits} new commits` },
    { id: "routing", label: "Model routing ready", status: model.ready ? "ready" : "attention", detail: model.ready ? "Automatic" : "Continue without AI" },
    { id: "sandbox", label: "Sandbox ready", status: config.execution.sandbox ? "ready" : "attention" },
    { id: "ide", label: selectedIDE ? "IDE connected" : "Terminal ready", status: "ready", detail: selectedIDE ?? "terminal" }
  ] };
};
