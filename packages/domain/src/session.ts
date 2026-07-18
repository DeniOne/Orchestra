import type { GSDPhase } from './gsd.js';
import type { ISO8601 } from './decision.js';

export type SessionId = string;
export type RoundId = string;

export type RoundStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Round {
  id: RoundId;
  sessionId: SessionId;
  number: number;
  phase: GSDPhase;
  status: RoundStatus;
  startedAt: ISO8601;
  completedAt?: ISO8601;
}

export interface Session {
  id: SessionId;
  name: string;
  projectId: string;
  currentPhase: GSDPhase;
  rounds: Round[];
  createdAt: ISO8601;
  updatedAt: ISO8601;
}
