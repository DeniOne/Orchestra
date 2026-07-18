import { Injectable } from '@nestjs/common';
import {
  GsdEngine,
  InMemorySessionStore,
  StubGating,
  InMemoryAuditLog,
} from '@orchestra/gsd-engine';
import type { AdvancePhaseResult } from '@orchestra/gsd-engine';
import type { Session, Round, SessionId } from '@orchestra/domain';

@Injectable()
export class GsdEngineService {
  private readonly engine = new GsdEngine({
    store: new InMemorySessionStore(),
    gating: new StubGating(),
    audit: new InMemoryAuditLog(),
  });

  async startSession(name: string, projectId: string): Promise<Session> {
    return this.engine.startSession({ name, projectId });
  }

  async startRound(sessionId: SessionId): Promise<Round> {
    return this.engine.startRound(sessionId);
  }

  async advancePhase(sessionId: SessionId): Promise<AdvancePhaseResult> {
    return this.engine.advancePhase(sessionId);
  }

  async approveTransition(sessionId: SessionId): Promise<Session> {
    return this.engine.approveTransition(sessionId);
  }

  async overrideGate(sessionId: SessionId, reason: string): Promise<Session> {
    return this.engine.overrideGate(sessionId, reason);
  }

  async getSession(sessionId: SessionId): Promise<Session | null> {
    return this.engine.getSession(sessionId);
  }

  async listRounds(sessionId: SessionId): Promise<Round[]> {
    return this.engine.listRounds(sessionId);
  }
}
