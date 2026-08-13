import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectMemory } from "../memory/project-memory.js";
import type { Project } from "../memory/types.js";
import { initializeModelCX } from "../model/llm-cx.js";
import { createIDERegistry } from "../ide/registry.js";
import { LocalProcessSandboxProvider } from "../sandbox/providers/local/local-process-provider.js";
import { PRODUCT_VERSION, detectInstallKind } from "./version.js";
import { resolvePlatform } from "./platform.js";

export interface DoctorCheck { area: "Installation" | "Project" | "AI" | "Memory" | "Sandbox" | "IDE"; label: string; ok: boolean; detail?: string; optional?: boolean }
export interface DoctorReport { ready: boolean; version: string; platform: string; checks: DoctorCheck[] }
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };

export const diagnoseInstallation = async (project: Project, memory: ProjectMemory): Promise<DoctorReport> => {
  const [memoryStatus, ai, ides, git] = await Promise.all([memory.getStatus(), initializeModelCX(), createIDERegistry().detect(), exists(join(project.root, ".git"))]), detected = ides.filter((item) => item.detection.detected);
  const checks: DoctorCheck[] = [
    { area: "Installation", label: "Runtime", ok: true, detail: detectInstallKind() }, { area: "Installation", label: "Version", ok: true, detail: PRODUCT_VERSION },
    { area: "Project", label: "Repository detected", ok: true, detail: project.name }, { area: "Project", label: "Git", ok: git, optional: true, detail: git ? "connected" : "not detected" },
    { area: "AI", label: "@easy-llm/llm", ok: true, detail: "0.10.x" }, { area: "AI", label: "Automatic routing", ok: ai.ready, optional: true, detail: ai.ready ? `${ai.models.length} models` : "connect a provider when ready" }, { area: "AI", label: "Credentials", ok: ai.credentialSources.length > 0, optional: true, detail: ai.credentialSources.length ? ai.credentialSources.map((item) => `${item.provider}:${item.source}`).join(", ") : "not configured" },
    { area: "Memory", label: "Local project memory", ok: memoryStatus.integrity === "ok", detail: `${memoryStatus.provider}, schema v${memoryStatus.schemaVersion}` }, { area: "Memory", label: "Persistent", ok: memoryStatus.capabilities.persistent },
    { area: "Sandbox", label: "Available", ok: new LocalProcessSandboxProvider().name.length > 0, detail: "local restricted process" },
    { area: "IDE", label: "Integration", ok: detected.length > 0, optional: true, detail: detected.map((item) => item.adapter.name).join(", ") || "terminal available" }
  ];
  return { ready: checks.every((item) => item.ok || item.optional), version: PRODUCT_VERSION, platform: resolvePlatform(), checks };
};

export const renderDoctor = (report: DoctorReport): string => { const areas = [...new Set(report.checks.map((item) => item.area))]; return [`easy-llm-code ${report.version}`, `Platform  ${report.platform}`, ...areas.flatMap((area) => [area, ...report.checks.filter((item) => item.area === area).map((item) => `  ${item.ok ? "✓" : item.optional ? "○" : "✗"} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`)]), report.ready ? "Ready." : "Attention required."].join("\n"); };
