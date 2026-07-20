// REDIS_PORT по умолчанию 6380 — orchestra-redis в docker-compose.yml слушает 6380,
// чтобы избежать конфликта с dmg-redis (проект DMG) на стандартном 6379.
export const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6380),
  password: process.env.REDIS_PASSWORD ?? undefined,
  db: Number(process.env.REDIS_DB ?? 0),
};

export const EVENT_QUEUE_NAME = 'orchestra.events';

// Redis pub/sub channel для real-time fanout в EventsGateway.
// Параллельно с BullMQ Queue (persist для audit) — pub/sub для low-latency push в WS.
export const EVENT_PUBSUB_CHANNEL = 'orchestra.events.pubsub';
