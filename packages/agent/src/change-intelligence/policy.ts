export interface ChangeIntelligencePolicy {
  weights: { structural: number; historical: number; coChange: number; taskHistory: number; outcome: number };
  contextBonus: number; highConfidence: number; mediumConfidence: number; minimumPrediction: number; samplePrior: number;
}
export const DEFAULT_CHANGE_INTELLIGENCE_POLICY: Readonly<ChangeIntelligencePolicy> = Object.freeze({
  weights: Object.freeze({ structural: 0.30, historical: 0.25, coChange: 0.20, taskHistory: 0.15, outcome: 0.10 }),
  contextBonus: 0.05, highConfidence: 0.75, mediumConfidence: 0.50, minimumPrediction: 0.12, samplePrior: 3
});
