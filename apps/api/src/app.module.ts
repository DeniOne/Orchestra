import { Module } from '@nestjs/common';
import type { GSDPhase } from '@orchestra/domain';
import { KgModule } from './kg/kg.module.js';
import { ContextModule } from './context/context.module.js';
import { RolesModule } from './roles/roles.module.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule],
})
export class AppModule {}
