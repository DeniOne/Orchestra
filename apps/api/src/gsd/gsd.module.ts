import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { ContextModule } from '../context/context.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { GsdEngineService } from './gsd-engine.service.js';
import { RoundOrchestratorGatingAdapter } from './round-orchestrator-gating.adapter.js';
import { ObjectiveSeedService } from './objective-seed.service.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule],
  providers: [GsdEngineService, RoundOrchestratorGatingAdapter, ObjectiveSeedService],
  exports: [GsdEngineService],
})
export class GsdModule {}
