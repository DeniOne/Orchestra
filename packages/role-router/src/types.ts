import type { ContextPacket, Response, RoleManifest, AIProvider, GSDPhase } from '@orchestra/domain';

/** Реестр манифестов ролей (hexagonal port). */
export interface RoleRegistryPort {
  get(roleId: string): Promise<RoleManifest | null>;
  list(): Promise<string[]>;
}

/** Реестр AIProvider (hexagonal port). */
export interface ProviderRegistryPort {
  get(providerId: string): Promise<AIProvider>;
  list(): Promise<string[]>;
}

export interface RouteRequest {
  packet: ContextPacket;
  dependencies?: Response[];
}

export interface RouteResult {
  response: Response;
  providerId: string;
  latencyMs: number;
}

export class InvalidPacketError extends Error {
  constructor(field: string) {
    super(`Invalid ContextPacket: missing ${field}`);
    this.name = 'InvalidPacketError';
  }
}

export class RoleNotActiveInPhaseError extends Error {
  constructor(roleId: string, phase: GSDPhase) {
    super(`Role ${roleId} is not active in phase ${phase}`);
    this.name = 'RoleNotActiveInPhaseError';
  }
}

export class UnknownRoleError extends Error {
  constructor(roleId: string) {
    super(`Unknown role: ${roleId}`);
    this.name = 'UnknownRoleError';
  }
}
