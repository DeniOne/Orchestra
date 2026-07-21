import { Module } from '@nestjs/common';
import { KgModule } from './kg/kg.module.js';
import { ContextModule } from './context/context.module.js';
import { RolesModule } from './roles/roles.module.js';
import { ConsensusModule } from './consensus/consensus.module.js';
import { GsdModule } from './gsd/gsd.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { EventsModule } from './events/events.module.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule, GsdModule, SessionsModule, EventsModule],
})
export class AppModule {}
