import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventBuffer } from './event-buffer.js';
import { EventPersistenceService } from './event-persistence.service.js';
import { EventConsumerService } from './event-consumer.service.js';
import { EventsController } from './events.controller.js';

@Module({
  providers: [PrismaService, EventBuffer, EventPersistenceService, EventConsumerService],
  controllers: [EventsController],
  exports: [EventBuffer, EventPersistenceService],
})
export class EventsModule {}
