import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { ContextModule } from '../context/context.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { EventBusModule } from '../event-bus/event-bus.module.js';
import { GsdEngineService } from './gsd-engine.service.js';
import { ObjectiveSeedService } from './objective-seed.service.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule, EventBusModule],
  // RoundOrchestratorGatingAdapter убран из providers: GsdEngineService создаёт его
  // через `new RoundOrchestratorGatingAdapter(...)` (gsd-engine.service.ts:23), а НЕ через
  // DI. Регистрация в providers была мёртвым кодом, который вдобавок ломал bootstrap —
  // NestJS пытался инстанцировать adapter, но его constructor имеет параметр
  // SessionStorePort (interface, type-only) на index [4], который emitDecoratorMetadata
  // стирает до Object → DI не может зарезолвить. Phase 8.03 — официальное санкционирование
  // этого удаления (Phase 8.02 сделал его без документации, что было anti-conflict нарушением).
  providers: [GsdEngineService, ObjectiveSeedService],
  exports: [GsdEngineService],
})
export class GsdModule {}
