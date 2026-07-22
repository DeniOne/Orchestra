import { Controller, Get, Query } from '@nestjs/common';
import type { DomainEvent } from '@orchestra/domain';
import { EventBuffer } from './event-buffer.js';
import { EventPersistenceService } from './event-persistence.service.js';

@Controller('events')
export class EventsController {
  constructor(
    private readonly persistence: EventPersistenceService,
    private readonly buffer: EventBuffer,
  ) {}

  @Get()
  async list(
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ events: DomainEvent[]; total: number }> {
    const parsedLimit = limit ? Number(limit) : undefined;
    const numericLimit = Number.isNaN(parsedLimit) ? undefined : parsedLimit;

    try {
      return await this.persistence.list({
        sessionId,
        limit: numericLimit,
      });
    } catch {
      const events = this.buffer.list({ sessionId, limit: numericLimit });
      return { events, total: this.buffer.size };
    }
  }
}
