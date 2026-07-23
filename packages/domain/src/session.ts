import type { GSDPhase } from './gsd.js';
import type { ISO8601, RoleRef } from './decision.js';
import type { Response } from './agent.js';
import type { ConsensusReport } from './consensus.js';

export type SessionId = string;
export type RoundId = string;

export type RoundStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** Per-role LLM response, persisted на Round для audit trail (D-9-6). */
export interface RoundResponse {
  role: RoleRef;
  response: Response;
}

export interface Round {
  id: RoundId;
  sessionId: SessionId;
  number: number;
  phase: GSDPhase;
  status: RoundStatus;
  startedAt: ISO8601;
  completedAt?: ISO8601;
  /** Per-role LLM responses, сохранённые после advance (D-9-6). Optional — старые rounds без поля. */
  responses?: RoundResponse[];
  /** Full ConsensusReport с confidence метриками, сохранённый после advance. Optional. */
  consensus?: ConsensusReport;
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
