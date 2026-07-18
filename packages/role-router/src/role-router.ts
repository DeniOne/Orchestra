import type { ContextPacket, GSDPhase, RoleManifest, AIProvider } from '@orchestra/domain';
import type {
  RoleRegistryPort,
  ProviderRegistryPort,
  RouteRequest,
  RouteResult,
} from './types.js';
import {
  InvalidPacketError,
  RoleNotActiveInPhaseError,
  UnknownRoleError,
} from './types.js';

/**
 * Role Router — единая точка диспетчеризации (Agent Protocol.md §4).
 *
 * Добавление новой роли = добавление role-manifests/<id>.yaml.
 * Этот код НЕ меняется. Идентификация провайдера через manifest.provider → registry.
 */
export class RoleRouter {
  constructor(
    private readonly roles: RoleRegistryPort,
    private readonly providers: ProviderRegistryPort,
  ) {}

  async route(req: RouteRequest): Promise<RouteResult> {
    validatePacket(req.packet);

    const manifest = await this.requireManifest(req.packet.role.id);
    assertActivePhase(manifest, req.packet.phase);

    const provider = await this.providers.get(manifest.provider);
    const started = Date.now();
    const response = await provider.send(req.packet);

    return {
      response,
      providerId: manifest.provider,
      latencyMs: Date.now() - started,
    };
  }

  private async requireManifest(roleId: string): Promise<RoleManifest> {
    const manifest = await this.roles.get(roleId);
    if (!manifest) throw new UnknownRoleError(roleId);
    return manifest;
  }
}

function validatePacket(packet: ContextPacket): void {
  if (!packet.contentHash) throw new InvalidPacketError('contentHash');
  if (!packet.role?.id) throw new InvalidPacketError('role.id');
  if (!packet.modelTarget) throw new InvalidPacketError('modelTarget');
}

function assertActivePhase(manifest: RoleManifest, phase: GSDPhase): void {
  if (manifest.activePhases && manifest.activePhases.length > 0) {
    if (!manifest.activePhases.includes(phase)) {
      throw new RoleNotActiveInPhaseError(manifest.id, phase);
    }
  }
}
