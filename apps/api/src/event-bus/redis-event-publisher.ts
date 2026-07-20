import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { EventPublisherPort } from '@orchestra/gsd-engine';
import type { DomainEvent } from '@orchestra/domain';
import { REDIS_CONNECTION, EVENT_QUEUE_NAME } from './redis.config.js';

@Injectable()
export class RedisEventPublisher implements EventPublisherPort, OnModuleDestroy {
  private readonly queue: Queue<DomainEvent>;
  private readonly logger = new Logger(RedisEventPublisher.name);

  constructor() {
    this.queue = new Queue<DomainEvent>(EVENT_QUEUE_NAME, {
      connection: REDIS_CONNECTION,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
      },
    });
  }

  async publish(event: DomainEvent): Promise<void> {
    try {
      await this.queue.add(event.type, event, { jobId: event.id });
      this.logger.debug(`Published event: ${event.type} (${event.id}) session=${event.sessionId}`);
    } catch (e) {
      this.logger.error(`Failed to publish event ${event.type}: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
