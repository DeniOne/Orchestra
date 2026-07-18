import { Injectable } from '@nestjs/common';
import { RoleRouter, type RouteRequest, type RouteResult } from '@orchestra/role-router';
import type { AIProvider } from '@orchestra/domain';
import type { ProviderRegistryPort } from '@orchestra/role-router';
import { ManifestLoaderAdapter } from './manifest-loader.adapter.js';
import { ProviderRegistryService } from '../providers/provider-registry.service.js';

class ProviderRegistryAdapter implements ProviderRegistryPort {
  constructor(private readonly svc: ProviderRegistryService) {}
  async get(providerId: string): Promise<AIProvider> {
    return this.svc.getProvider(providerId);
  }
  async list(): Promise<string[]> {
    return this.svc.listProviders();
  }
}

@Injectable()
export class RoleRouterService {
  private readonly router: RoleRouter;

  constructor(
    private readonly manifestLoader: ManifestLoaderAdapter,
    private readonly providerRegistry: ProviderRegistryService,
  ) {
    const providerAdapter = new ProviderRegistryAdapter(this.providerRegistry);
    this.router = new RoleRouter(this.manifestLoader, providerAdapter);
  }

  async route(req: RouteRequest): Promise<RouteResult> {
    return this.router.route(req);
  }
}
