import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { REDIS_CONNECTION, EVENT_PUBSUB_CHANNEL } from './redis.config.js';
import type { DomainEvent } from '@orchestra/domain';

@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
@Injectable()
export class EventsGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly subscriber: Redis;
  private readonly logger = new Logger(EventsGateway.name);

  constructor() {
    this.subscriber = new Redis(REDIS_CONNECTION);
  }

  async onModuleInit() {
    await this.subscriber.subscribe(EVENT_PUBSUB_CHANNEL);
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event: DomainEvent = JSON.parse(message);
        this.server.emit('orchestra:event', event);
        this.logger.debug(`Broadcast event to WS clients: ${event.type} (${event.id})`);
      } catch (e) {
        this.logger.error(`Failed to parse/broadcast event: ${(e as Error).message}`);
      }
    });
    this.logger.log(`Subscribed to ${EVENT_PUBSUB_CHANNEL}, broadcasting to WS clients`);
  }

  async onModuleDestroy() {
    await this.subscriber.unsubscribe();
    await this.subscriber.quit();
  }
}
