import { Module } from '@nestjs/common';
import type { GSDPhase } from '@orchestra/domain';
import { KgModule } from './kg/kg.module.js';
import { ContextModule } from './context/context.module.js';

@Module({
  imports: [KgModule, ContextModule],
})
export class AppModule {}
