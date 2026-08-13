export interface RoutingWeights { capability: number; historicalSuccess: number; complexityFit: number; cost: number; latency: number }
export interface AdaptiveRoutingPolicy { weights: RoutingWeights; lowConfidenceEvidence: number; highConfidenceEvidence: number; neutralHistoricalSuccess: number }
export const DEFAULT_ROUTING_POLICY: AdaptiveRoutingPolicy = {
  weights: { capability: 0.30, historicalSuccess: 0.30, complexityFit: 0.20, cost: 0.10, latency: 0.10 },
  lowConfidenceEvidence: 3, highConfidenceEvidence: 10, neutralHistoricalSuccess: 0.5
};
