import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { EventPublisherPort } from '@orchestra/gsd-engine';
import type { DomainEvent } from '@orchestra/domain';
import { REDIS_CONNECTION, EVENT_QUEUE_NAME, EVENT_PUBSUB_CHANNEL } from './redis.config.js';

@Injectable()
export class RedisEventPublisher implements EventPublisherPort, OnModuleDestroy {
  private readonly queue: Queue<DomainEvent>;
  private readonly pubsub: Redis;
  private readonly logger = new Logger(RedisEventPublisher.name);

  constructor() {
    this.queue = new Queue<DomainEvent>(EVENT_QUEUE_NAME, {
      connection: REDIS_CONNECTION,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 3 },
    });
    this.pubsub = new Redis(REDIS_CONNECTION);
  }

  async publish(event: DomainEvent): Promise<void> {
    // Queue: persist для audit (Wave 8d) и future Worker (Wave 8c-3)
    try {
      await this.queue.add(event.type, event, { jobId: event.id });
    } catch (e) {
      this.logger.error(`Failed to publish event to Queue ${event.type}: ${(e as Error).message}`);
    }
    // Pub/sub: real-time fanout в EventsGateway → WS-клиенты
    try {
      await this.pubsub.publish(EVENT_PUBSUB_CHANNEL, JSON.stringify(event));
    } catch (e) {
      this.logger.error(`Failed to publish event to pub/sub ${event.type}: ${(e as Error).message}`);
    }
    this.logger.debug(`Published event: ${event.type} (${event.id}) session=${event.sessionId}`);
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.pubsub.quit();
  }
}
