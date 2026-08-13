import type { ProjectMemory } from "./project-memory.js";
import type { OutcomeSignal } from "../intelligence/outcome-model.js";
import type { TaskProfile } from "../intelligence/task-profile.js";

export interface ComparableOutcome extends OutcomeSignal { similarity: number }
export const retrieveComparableOutcomes = async (memory: ProjectMemory, profile: TaskProfile, limit = 50): Promise<ComparableOutcome[]> => {
  const signals = await memory.listOutcomeSignals();
  return signals.map((signal) => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const ageDays = Math.max(0, Math.floor((today - Date.parse(signal.timestamp)) / 86_400_000)), recency = Math.max(0.5, 1 - ageDays / 730);
    return ({ ...signal, similarity: recency * ((signal.taskType === profile.taskType ? 0.30 : 0) +
    (signal.languages.some((language) => profile.languages.includes(language)) ? 0.20 : 0) +
    (profile.subsystem && signal.subsystem === profile.subsystem ? 0.25 : 0) +
    (signal.complexity === profile.estimatedComplexity ? 0.15 : 0) +
    (signal.frameworks.some((framework) => profile.frameworks.includes(framework)) ? 0.10 : 0)) });
  }).filter((signal) => signal.similarity > 0).sort((a, b) => b.similarity - a.similarity || b.timestamp.localeCompare(a.timestamp) || a.taskId.localeCompare(b.taskId)).slice(0, limit);
};
