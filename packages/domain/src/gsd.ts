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
