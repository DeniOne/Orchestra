import { Injectable } from '@nestjs/common';
import type { DomainEvent } from '@orchestra/domain';

const MAX_BUFFER_SIZE = 1000;

@Injectable()
export class EventBuffer {
  private readonly events: DomainEvent[] = [];

  append(event: DomainEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_BUFFER_SIZE) {
      this.events.shift();
    }
  }

  list(options?: { sessionId?: string; limit?: number }): DomainEvent[] {
    const limit = Math.min(options?.limit ?? 100, MAX_BUFFER_SIZE);
    let result = this.events;
    if (options?.sessionId) {
      result = result.filter((e) => e.sessionId === options.sessionId);
    }
    return result.slice(-limit).reverse();
  }

  clear(): void {
    this.events.length = 0;
  }

  get size(): number {
    return this.events.length;
  }
}
