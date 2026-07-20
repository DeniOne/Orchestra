import { Module } from '@nestjs/common';
import { RedisEventPublisher } from './redis-event-publisher.js';

@Module({
  providers: [RedisEventPublisher],
  exports: [RedisEventPublisher],
})
export class EventBusModule {}
