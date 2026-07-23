import { Injectable } from '@nestjs/common';
import type { GatingPort, GatingResult, SessionStorePort } from '@orchestra/gsd-engine';
import type { GSDPhase, RoleRef, RoleManifest, Session, Round } from '@orchestra/domain';
import type { RoleResponse } from '@orchestra/consensus-engine';
import { ContextService } from '../context/context.service.js';
import { RoleRouterService } from '../roles/role-router.service.js';
import { ConsensusService } from '../consensus/consensus.service.js';
import { ManifestLoaderAdapter } from '../roles/manifest-loader.adapter.js';

@Injectable()
export class RoundOrchestratorGatingAdapter implements GatingPort {
  constructor(
    private readonly context: ContextService,
    private readonly router: RoleRouterService,
    private readonly consensus: ConsensusService,
    private readonly roles: ManifestLoaderAdapter,
    private readonly store: SessionStorePort,
  ) {}

  async evaluate(sessionId: string, phase: GSDPhase): Promise<GatingResult> {
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);

    const round = this.findCurrentRound(session, phase);
    if (!round) {
      return { verdict: 'fail', gaps: ['no active round for phase'], phase };
    }

    const activeRoles = await this.getActiveRoles(phase);

    const roleResponses: RoleResponse[] = [];
    for (const manifest of activeRoles) {
      const packet = await this.context.buildPacket({
        sessionId,
        projectId: session.projectId,
        roundId: round.id,
        roleId: manifest.id,
        objective: session.name,
        objectiveNodeId: 'stub-objective',
        phase,
        model: manifest.model,
      });
      const { response } = await this.router.route({ packet });
      const roleRef: RoleRef = {
        id: manifest.id,
        displayName: manifest.displayName,
        responsibilities: manifest.responsibilities,
      };
      roleResponses.push({ role: roleRef, response });
    }

    const report = await this.consensus.run({
      roundId: round.id,
      phase,
      responses: roleResponses,
    });

    return {
      verdict: report.gatingVerdict,
      gaps: extractGaps(report),
      phase,
    };
  }

  private findCurrentRound(session: Session, phase: GSDPhase): Round | null {
    const rounds = session.rounds.filter((r) => r.phase === phase);
    return rounds[rounds.length - 1] ?? null;
  }

  private async getActiveRoles(phase: GSDPhase): Promise<RoleManifest[]> {
    const roleIds = await this.roles.list();
    const manifests: RoleManifest[] = [];
    for (const id of roleIds) {
      const m = await this.roles.get(id);
      if (!m) continue;
      const active = !m.activePhases || m.activePhases.length === 0 || m.activePhases.includes(phase);
      if (active) manifests.push(m);
    }
    return manifests;
  }
}

function extractGaps(report: { disagreements: { id: string }[]; openQuestions: { id: string }[] }): string[] {
  const gaps: string[] = [];
  if (report.disagreements.length > 0) gaps.push(`${report.disagreements.length} disagreement(s)`);
  if (report.openQuestions.length > 0) gaps.push(`${report.openQuestions.length} open question(s)`);
  return gaps;
}
