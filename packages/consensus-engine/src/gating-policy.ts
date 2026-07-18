import type { DecisionConfidence, GSDPhase, GatingVerdict } from '@orchestra/domain';
import type { GatingPolicy } from './types.js';
import { DefaultGatingPolicy } from './strategies/gating-thresholds.js';

/**
 * Evaluates gating verdict based on confidence metrics and phase thresholds.
 * 'pass' if all applicable metrics ≥ threshold (or no thresholds for phase).
 */
export function evaluateGating(
  confidence: DecisionConfidence,
  phase: GSDPhase,
  policy: GatingPolicy = new DefaultGatingPolicy(),
): { verdict: GatingVerdict; gaps: string[] } {
  const thresholds = policy.thresholdsForTransitionFrom(phase);

  if (!thresholds) {
    return { verdict: 'pass', gaps: [] };
  }

  const gaps: string[] = [];

  for (const [metric, threshold] of Object.entries(thresholds) as [keyof DecisionConfidence, number][]) {
    if (confidence[metric] < threshold) {
      gaps.push(`${metric}: ${confidence[metric]}% < ${threshold}%`);
    }
  }

  return {
    verdict: gaps.length > 0 ? 'fail' : 'pass',
    gaps,
  };
}

export function buildNextAction(verdict: GatingVerdict, phase: GSDPhase, gaps: string[]): string {
  if (verdict === 'pass') {
    return `transition from ${phase}`;
  }
  return `iterate: gaps in ${gaps.join('; ')}`;
}
