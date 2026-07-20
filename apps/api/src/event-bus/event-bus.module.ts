import { Module } from '@nestjs/common';
import { RedisEventPublisher } from './redis-event-publisher.js';
import { EventsGateway } from './events.gateway.js';

@Module({
  providers: [RedisEventPublisher, EventsGateway],
  exports: [RedisEventPublisher],
})
export class EventBusModule {}
