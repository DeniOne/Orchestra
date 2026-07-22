import { Injectable } from '@nestjs/common';
import { GsdEngine, InMemoryAuditLog } from '@orchestra/gsd-engine';
import type { AdvancePhaseResult, SessionStorePort } from '@orchestra/gsd-engine';
import type { Session, Round, SessionId } from '@orchestra/domain';
import { ContextService } from '../context/context.service.js';
import { RoleRouterService } from '../roles/role-router.service.js';
import { ConsensusService } from '../consensus/consensus.service.js';
import { ManifestLoaderAdapter } from '../roles/manifest-loader.adapter.js';
import { RoundOrchestratorGatingAdapter } from './round-orchestrator-gating.adapter.js';
import { RedisEventPublisher } from '../event-bus/redis-event-publisher.js';
import { PrismaSessionStore } from './prisma-session-store.js';

@Injectable()
export class GsdEngineService {
  private readonly audit = new InMemoryAuditLog();
  private readonly engine: GsdEngine;

  constructor(
    private readonly context: ContextService,
    private readonly router: RoleRouterService,
    private readonly consensus: ConsensusService,
    private readonly roles: ManifestLoaderAdapter,
    private readonly publisher: RedisEventPublisher,
    private readonly store: PrismaSessionStore,
  ) {
    const gating = new RoundOrchestratorGatingAdapter(context, router, consensus, roles, this.store);
    this.engine = new GsdEngine({
      store: this.store,
      gating,
      audit: this.audit,
      events: this.publisher,
    });
  }

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

  async listSessions(): Promise<Session[]> {
    return this.store.list();
  }
}
