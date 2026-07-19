import type { GSDPhase } from '@orchestra/domain';

export type AdvancePhaseResult =
  | { status: 'transitioned'; from: GSDPhase; to: GSDPhase }
  | { status: 'gated'; phase: GSDPhase; gaps: string[] }
  | { status: 'awaiting_approval'; phase: GSDPhase }
  | { status: 'terminal'; phase: GSDPhase }
  | { status: 'iteration'; from: GSDPhase; to: 'Iteration'; gaps: string[] };
