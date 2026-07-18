/** Фазы жизненного цикла GSD. См. docs/GSD Integration.md §1. */
export type GSDPhase =
  | 'Discover'
  | 'Goal'
  | 'Specification'
  | 'Architecture'
  | 'Implementation'
  | 'Review'
  | 'Consensus'
  | 'Iteration';

/** Статус фазы в рамках сессии. См. docs/Architecture.md §9. */
export type PhaseStatus =
  | 'not_started'
  | 'in_progress'
  | 'gated'
  | 'awaiting_approval'
  | 'completed';
