import type { GSDPhase, DecisionConfidence } from '@orchestra/domain';
import type { GatingPolicy } from '../types.js';

/**
 * Default gating thresholds from Consensus Protocol.md §6 / GSD Integration.md §3.
 * MVP: hardcoded table. Future (D-E4): pluggable strategy.
 */
const TRANSITION_THRESHOLDS: Record<string, Partial<DecisionConfidence> | undefined> = {
  Goal: { architecture: 70 },
  Specification: { researchCoverage: 75 },
  Architecture: { architecture: 85 },
  Implementation: { implementation: 80 },
  Review: { riskCoverage: 70 },
  Consensus: { overall: 80 },
  Discover: undefined,
  Iteration: undefined,
};

export class DefaultGatingPolicy implements GatingPolicy {
  thresholdsForTransitionFrom(phase: GSDPhase): Partial<DecisionConfidence> | undefined {
    return TRANSITION_THRESHOLDS[phase];
  }
}
