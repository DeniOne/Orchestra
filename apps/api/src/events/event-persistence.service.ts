import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent } from '@orchestra/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class EventPersistenceService {
  private readonly logger = new Logger(EventPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async persist(event: DomainEvent): Promise<void> {
    try {
      await this.prisma.domainEventRecord.upsert({
        where: { id: event.id },
        create: {
          id: event.id,
          type: event.type,
          sessionId: event.sessionId,
          occurredAt: new Date(event.occurredAt),
          payload: event as unknown as Prisma.InputJsonValue,
        },
        update: {},
      });
    } catch (e) {
      this.logger.error(`Failed to persist event ${event.type}/${event.id}: ${(e as Error).message}`);
    }
  }

  async list(options?: {
    sessionId?: string;
    limit?: number;
  }): Promise<{ events: DomainEvent[]; total: number }> {
    const limit = Math.min(options?.limit ?? 100, 1000);
    const where: Prisma.DomainEventRecordWhereInput = options?.sessionId
      ? { sessionId: options.sessionId }
      : {};

    const [records, total] = await Promise.all([
      this.prisma.domainEventRecord.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: limit,
      }),
      this.prisma.domainEventRecord.count({ where }),
    ]);

    return {
      events: records.map((r) => r.payload as unknown as DomainEvent),
      total,
    };
  }
}
