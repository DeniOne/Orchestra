import { Module } from '@nestjs/common';
import { GsdEngineService } from './gsd-engine.service.js';
import { ContextModule } from '../context/context.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';

@Module({
  imports: [ContextModule, RolesModule, ConsensusModule],
  providers: [GsdEngineService],
  exports: [GsdEngineService],
})
export class GsdModule {}
