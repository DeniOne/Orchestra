import type { GSDPhase } from '@orchestra/domain';

/**
 * Карта переходов FSM. Источник: docs/Architecture.md §9 state diagram.
 * null = терминал (exit). Iteration → Specification — единственный возврат.
 */
export const TRANSITION_MAP: Record<GSDPhase, GSDPhase | null> = {
  Discover: 'Goal',
  Goal: 'Specification',
  Specification: 'Architecture',
  Architecture: 'Implementation',
  Implementation: 'Review',
  Review: 'Consensus',
  Consensus: null,
  Iteration: 'Specification',
};

/** Фазы с обязательным human-approve (GSD Integration.md §4). */
export const HARD_GATES: readonly GSDPhase[] = ['Architecture', 'Consensus'] as const;

export function isTerminal(phase: GSDPhase): boolean {
  return TRANSITION_MAP[phase] === null;
}

export function nextPhase(phase: GSDPhase): GSDPhase | null {
  return TRANSITION_MAP[phase];
}

export function isHardGate(phase: GSDPhase): boolean {
  return HARD_GATES.includes(phase);
}

export function canTransition(phase: GSDPhase): boolean {
  return !isTerminal(phase);
}
