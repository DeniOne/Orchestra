import type {
  Session, SessionId, Round,
  GSDPhase, PhaseChanged, RoundStarted, OwnerOverrideApplied,
} from '@orchestra/domain';
import type {
  SessionStorePort, GatingPort, AuditPort, EventPublisherPort, GsdEngineOptions, GatingResult,
} from './types.js';
import { InMemorySessionStore } from './in-memory-store.js';
import { StubGating } from './stub-gating.js';
import { InMemoryAuditLog } from './audit-log.js';
import { isTerminal, nextPhase, isHardGate } from './phase-machine.js';

export type AdvancePhaseResult =
  | { status: 'transitioned'; from: GSDPhase; to: GSDPhase; event: PhaseChanged }
  | { status: 'gated'; phase: GSDPhase; gaps: string[] }
  | { status: 'awaiting_approval'; phase: GSDPhase }
  | { status: 'terminal'; phase: GSDPhase }
  | { status: 'iteration'; from: GSDPhase; to: 'Iteration'; gaps: string[] };

export class GsdEngine {
  private readonly store: SessionStorePort;
  private readonly gating: GatingPort;
  private readonly audit: AuditPort;
  private readonly events: EventPublisherPort;
  private eventCounter = 0;
  private readonly approvals = new Map<string, boolean>();

  constructor(options: GsdEngineOptions = {}) {
    this.store = options.store ?? new InMemorySessionStore();
    this.gating = options.gating ?? new StubGating();
    this.audit = options.audit ?? new InMemoryAuditLog();
    this.events = options.events ?? { publish: async () => {} };
  }

  private approvalKey(sessionId: SessionId, phase: GSDPhase): string {
    return `${sessionId}:${phase}`;
  }

  private isApproved(sessionId: SessionId, phase: GSDPhase): boolean {
    return this.approvals.get(this.approvalKey(sessionId, phase)) === true;
  }

  async startSession(input: { name: string; projectId: string; id?: SessionId }): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      id: input.id ?? `session-${input.projectId}-${Date.now()}`,
      name: input.name,
      projectId: input.projectId,
      currentPhase: 'Discover',
      rounds: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.store.create(session);
    return session;
  }

  async startRound(sessionId: SessionId): Promise<Round> {
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);

    const roundNumber = session.rounds.length + 1;
    const round: Round = {
      id: `round-${sessionId}-${roundNumber}`,
      sessionId,
      number: roundNumber,
      phase: session.currentPhase,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    };
    session.rounds.push(round);
    session.updatedAt = new Date().toISOString();
    await this.store.update(session);

    const event: RoundStarted = {
      id: `RoundStarted-${sessionId}-${this.eventCounter++}`,
      type: 'RoundStarted',
      sessionId,
      roundId: round.id,
      phase: session.currentPhase,
      occurredAt: new Date().toISOString(),
    };
    await this.events.publish(event);

    return round;
  }

  async advancePhase(sessionId: SessionId): Promise<AdvancePhaseResult> {
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);

    const phase = session.currentPhase;

    // Consensus is special: terminal on pass, Iteration on fail.
    // Check gating BEFORE the terminal check so fail path works.
    if (phase === 'Consensus') {
      const result = await this.gating.evaluate(sessionId, phase);
      if (result.verdict === 'fail') {
        this.persistRoundArtifacts(session, phase, result);
        session.currentPhase = 'Iteration';
        session.updatedAt = new Date().toISOString();
        await this.store.update(session);

        const event: PhaseChanged = {
          id: `PhaseChanged-${sessionId}-${this.eventCounter++}`,
          type: 'PhaseChanged',
          sessionId,
          from: phase,
          to: 'Iteration',
          gatingVerdict: 'fail',
          occurredAt: new Date().toISOString(),
        };
        await this.events.publish(event);

        return { status: 'iteration', from: phase, to: 'Iteration', gaps: result.gaps };
      }
      return { status: 'terminal', phase };
    }

    if (isTerminal(phase)) {
      return { status: 'terminal', phase };
    }

    const result = await this.gating.evaluate(sessionId, phase);

    if (result.verdict === 'fail') {
      return { status: 'gated', phase, gaps: result.gaps };
    }

    if (isHardGate(phase) && !this.isApproved(sessionId, phase)) {
      return { status: 'awaiting_approval', phase };
    }

    const target = nextPhase(phase);
    if (!target) {
      return { status: 'terminal', phase };
    }

    const from = phase;
    this.persistRoundArtifacts(session, phase, result);
    session.currentPhase = target;
    session.updatedAt = new Date().toISOString();
    this.approvals.delete(this.approvalKey(sessionId, from));
    await this.store.update(session);

    const event: PhaseChanged = {
      id: `PhaseChanged-${sessionId}-${this.eventCounter++}`,
      type: 'PhaseChanged',
      sessionId,
      from,
      to: target,
      gatingVerdict: 'pass',
      occurredAt: new Date().toISOString(),
    };
    await this.events.publish(event);

    return { status: 'transitioned', from, to: target, event };
  }

  /**
   * Persist per-role responses + consensus report на round для audit trail (D-9-6).
   * Mutates session.rounds (canonical object) before store.update. No-op if gating result
   * lacks artifacts (e.g. fail before consensus) или round не найден.
   */
  private persistRoundArtifacts(session: Session, phase: GSDPhase, result: GatingResult): void {
    if (!result.responses && !result.consensus) return;
    const round = session.rounds.find((r) => r.phase === phase && r.status !== 'completed');
    if (!round) return;
    if (result.responses) round.responses = result.responses;
    if (result.consensus) round.consensus = result.consensus;
    round.status = 'completed';
    round.completedAt = new Date().toISOString();
  }

  async approveTransition(sessionId: SessionId): Promise<Session> {
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);

    this.approvals.set(this.approvalKey(sessionId, session.currentPhase), true);
    session.updatedAt = new Date().toISOString();
    await this.store.update(session);
    return session;
  }

  async overrideGate(sessionId: SessionId, reason: string): Promise<Session> {
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);

    const phase = session.currentPhase;

    await this.audit.record({ sessionId, phase, reason });

    const target = nextPhase(phase);
    if (target) {
      session.currentPhase = target;
      session.updatedAt = new Date().toISOString();
      await this.store.update(session);

      const event: OwnerOverrideApplied = {
        id: `OwnerOverrideApplied-${sessionId}-${this.eventCounter++}`,
        type: 'OwnerOverrideApplied',
        sessionId,
        phase,
        reason,
        occurredAt: new Date().toISOString(),
      };
      await this.events.publish(event);
    }

    return session;
  }

  async getSession(sessionId: SessionId): Promise<Session | null> {
    return this.store.get(sessionId);
  }

  async listRounds(sessionId: SessionId): Promise<Round[]> {
    return this.store.listRounds(sessionId);
  }
}
