import { Module } from '@nestjs/common';
import { EventBuffer } from './event-buffer.js';
import { EventConsumerService } from './event-consumer.service.js';
import { EventsController } from './events.controller.js';

@Module({
  providers: [EventBuffer, EventConsumerService],
  controllers: [EventsController],
  exports: [EventBuffer],
})
export class EventsModule {}
