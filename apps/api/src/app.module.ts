import { Module } from '@nestjs/common';
import { KgModule } from './kg/kg.module.js';
import { ContextModule } from './context/context.module.js';
import { RolesModule } from './roles/roles.module.js';
import { ConsensusModule } from './consensus/consensus.module.js';
import { GsdModule } from './gsd/gsd.module.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule, GsdModule],
})
export class AppModule {}
