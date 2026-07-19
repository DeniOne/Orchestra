import { Injectable } from '@nestjs/common';
import { GsdEngine, InMemorySessionStore, InMemoryAuditLog } from '@orchestra/gsd-engine';
import type { AdvancePhaseResult, SessionStorePort } from '@orchestra/gsd-engine';
import type { Session, Round, SessionId } from '@orchestra/domain';
import { ContextService } from '../context/context.service.js';
import { RoleRouterService } from '../roles/role-router.service.js';
import { ConsensusService } from '../consensus/consensus.service.js';
import { ManifestLoaderAdapter } from '../roles/manifest-loader.adapter.js';
import { RoundOrchestratorGatingAdapter } from './round-orchestrator-gating.adapter.js';

@Injectable()
export class GsdEngineService {
  private readonly store: SessionStorePort = new InMemorySessionStore();
  private readonly audit = new InMemoryAuditLog();
  private readonly engine: GsdEngine;
  private readonly knownSessionIds = new Set<SessionId>();

  constructor(
    private readonly context: ContextService,
    private readonly router: RoleRouterService,
    private readonly consensus: ConsensusService,
    private readonly roles: ManifestLoaderAdapter,
  ) {
    const gating = new RoundOrchestratorGatingAdapter(context, router, consensus, roles, this.store);
    this.engine = new GsdEngine({ store: this.store, gating, audit: this.audit });
  }

  async startSession(name: string, projectId: string): Promise<Session> {
    const session = await this.engine.startSession({ name, projectId });
    this.knownSessionIds.add(session.id);
    return session;
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
    const sessions = await Promise.all(
      [...this.knownSessionIds].map((id) => this.engine.getSession(id)),
    );
    return sessions.filter((s): s is Session => s !== null);
  }
}
