import { Module } from '@nestjs/common';
import type { GSDPhase } from '@orchestra/domain';
import { KgModule } from './kg/kg.module.js';

@Module({
  imports: [KgModule],
})
export class AppModule {}
