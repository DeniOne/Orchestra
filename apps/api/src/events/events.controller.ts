import { Controller, Get, Query } from '@nestjs/common';
import type { DomainEvent } from '@orchestra/domain';
import { EventBuffer } from './event-buffer.js';

@Controller('events')
export class EventsController {
  constructor(private readonly buffer: EventBuffer) {}

  @Get()
  async list(
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ events: DomainEvent[]; total: number }> {
    const parsedLimit = limit ? Number(limit) : undefined;
    const events = this.buffer.list({
      sessionId,
      limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit,
    });
    return {
      events,
      total: this.buffer.size,
    };
  }
}
