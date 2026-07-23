import type {
  Session, SessionId, Round, RoundId, RoundResponse,
  GSDPhase, GatingVerdict, DomainEvent, ConsensusReport,
} from '@orchestra/domain';

export interface SessionStorePort {
  create(session: Session): Promise<void>;
  get(sessionId: SessionId): Promise<Session | null>;
  update(session: Session): Promise<void>;
  listRounds(sessionId: SessionId): Promise<Round[]>;
}

export interface GatingResult {
  verdict: GatingVerdict;
  gaps: string[];
  phase: GSDPhase;
  /** Per-role responses + consensus report для persist на round (D-9-6). Optional — может отсутствовать. */
  responses?: RoundResponse[];
  consensus?: ConsensusReport;
}

export interface GatingPort {
  evaluate(sessionId: SessionId, phase: GSDPhase): Promise<GatingResult>;
}

export interface AuditRecord {
  id: string;
  sessionId: SessionId;
  phase: GSDPhase;
  reason: string;
  occurredAt: string;
}

export interface AuditPort {
  record(entry: Omit<AuditRecord, 'id' | 'occurredAt'> & { id?: string }): Promise<AuditRecord>;
  list(sessionId: SessionId): Promise<AuditRecord[]>;
}

export interface EventPublisherPort {
  publish(event: DomainEvent): Promise<void>;
}

export interface GsdEngineOptions {
  store?: SessionStorePort;
  gating?: GatingPort;
  audit?: AuditPort;
  events?: EventPublisherPort;
}
