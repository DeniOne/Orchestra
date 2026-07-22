import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { DomainEvent } from '@orchestra/domain';
import { REDIS_CONNECTION, EVENT_QUEUE_NAME } from '../event-bus/redis.config.js';
import { EventBuffer } from './event-buffer.js';
import { EventPersistenceService } from './event-persistence.service.js';

@Injectable()
export class EventConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventConsumerService.name);
  private worker?: Worker;

  constructor(
    private readonly buffer: EventBuffer,
    private readonly persistence: EventPersistenceService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<DomainEvent>(
      EVENT_QUEUE_NAME,
      async (job: Job<DomainEvent>) => {
        const event = job.data;
        this.logger.log(
          JSON.stringify({
            type: event.type,
            id: event.id,
            sessionId: event.sessionId,
            occurredAt: event.occurredAt,
            ...this.extractPayload(event),
          }),
        );
        this.buffer.append(event);
        await this.persistence.persist(event);
      },
      {
        connection: REDIS_CONNECTION,
        concurrency: 5,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id ?? '?'} failed: ${err.message}`);
    });

    this.worker.on('error', (err) => {
      this.logger.error(`Worker error: ${err.message}`);
    });

    this.logger.log(`Worker started on queue '${EVENT_QUEUE_NAME}', concurrency=5`);
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private extractPayload(event: DomainEvent): Record<string, unknown> {
    const { id, type, sessionId, occurredAt, ...rest } = event;
    return rest;
  }
}
