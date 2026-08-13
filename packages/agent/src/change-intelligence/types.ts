import type { TaskType } from "../intelligence/task-profile.js";

export type ImpactEvidenceType = "structural" | "historical" | "cochange" | "task" | "outcome" | "context" | "test";
export interface DerivedEvidence {
  source: ImpactEvidenceType; confidence: number; observations: string[]; sampleSize: number; generatedAt: string;
  scope?: "global" | "repository" | "subsystem" | "directory" | "file" | "symbol";
}
export interface ImpactEvidence extends DerivedEvidence { target: string; candidate: string; description: string }
export interface ImpactCandidate {
  path: string; confidence: number; evidenceCount: number; evidenceTypes: ImpactEvidenceType[];
  signals: { structural: number; historical: number; coChange: number; taskHistory: number; outcome: number; context: number };
  evidence: ImpactEvidence[];
}
export interface ImpactAssessment {
  expectedFiles: string[]; likelyAffectedFiles: string[]; expectedTests: string[]; riskAreas: string[];
  evidence: ImpactEvidence[];
  decisions: { path: string; decision: "included" | "not_modified"; reason: string }[];
}
export interface ChangeImpactAnalysis {
  id: string; taskId?: string; targets: string[]; affectedFiles: ImpactCandidate[]; affectedSymbols: string[];
  affectedTests: ImpactCandidate[]; relatedSubsystems: string[]; historicalChanges: string[];
  confidence: number; evidence: ImpactEvidence[]; assessment: ImpactAssessment; generatedAt: string;
}
export interface ImpactPrediction extends ChangeImpactAnalysis { repositoryId: string }
export interface ActualChange { id: string; taskId: string; predictionId: string; files: string[]; verificationPassed: boolean; timestamp: string }
export type PredictionOutcomeClassification = "confirmed" | "false_positive" | "false_negative" | "uncertain";
export interface PredictionOutcome { id: string; taskId: string; predictionId: string; file: string; classification: PredictionOutcomeClassification; confidence?: number; timestamp: string }
export interface ChangePattern { id: string; repositoryId: string; target: string; taskType?: TaskType; subsystem?: string; usuallyChanges: { path: string; observations: number; confidence: number }[]; sampleSize: number; generatedAt: string }

export interface AnalyzeChangeImpactInput { files: string[]; symbols?: string[]; taskType?: TaskType; proposedChanges?: string[]; taskId?: string; persist?: boolean }
