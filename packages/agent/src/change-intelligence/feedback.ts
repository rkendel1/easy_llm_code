import type { ProjectMemory } from "../memory/project-memory.js";
import type { ActualChange, ImpactPrediction, PredictionOutcome } from "./types.js";

export const recordImpactFeedback = async (memory: ProjectMemory, prediction: ImpactPrediction, files: string[], verificationPassed: boolean, certain = true): Promise<PredictionOutcome[]> => {
  const timestamp = new Date().toISOString(), actual = [...new Set(files)].sort(), predicted = new Map(prediction.affectedFiles.map((item) => [item.path, item.confidence]));
  const change: ActualChange = { id: `actual-change:${prediction.taskId}`, taskId: prediction.taskId!, predictionId: prediction.id, files: actual, verificationPassed, timestamp };
  await memory.persistActualChange(change);
  const actualCandidates = actual.filter((file) => !prediction.targets.includes(file));
  const all = [...new Set([...predicted.keys(), ...actualCandidates])].sort();
  const outcomes: PredictionOutcome[] = all.map((file) => ({ id: `prediction-outcome:${prediction.taskId}:${file}`, taskId: prediction.taskId!, predictionId: prediction.id, file,
    classification: !certain ? "uncertain" : predicted.has(file) && actualCandidates.includes(file) ? "confirmed" : predicted.has(file) ? "false_positive" : "false_negative", confidence: predicted.get(file), timestamp }));
  for (const outcome of outcomes) await memory.persistPredictionOutcome(outcome);
  return outcomes;
};
