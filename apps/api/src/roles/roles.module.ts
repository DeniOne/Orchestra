import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { ManifestLoaderAdapter } from './manifest-loader.adapter.js';
import { RoleRouterService } from './role-router.service.js';

@Module({
  imports: [ProvidersModule],
  providers: [ManifestLoaderAdapter, RoleRouterService],
  exports: [RoleRouterService],
})
export class RolesModule {}
