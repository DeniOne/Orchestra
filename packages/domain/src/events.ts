import type { SessionId, RoundId } from './session.js';
import type { GSDPhase } from './gsd.js';
import type { ISO8601 } from './decision.js';

export interface DomainEvent {
  id: string;
  type: string;
  sessionId: SessionId;
  occurredAt: ISO8601;
}

export interface RoundStarted extends DomainEvent {
  type: 'RoundStarted';
  roundId: RoundId;
  phase: GSDPhase;
}

export interface PhaseChanged extends DomainEvent {
  type: 'PhaseChanged';
  from: GSDPhase;
  to: GSDPhase;
  gatingVerdict: 'pass' | 'fail' | 'overridden';
}

export interface OwnerOverrideApplied extends DomainEvent {
  type: 'OwnerOverrideApplied';
  phase: GSDPhase;
  reason: string;
}
