---
phase: 8c.3
slug: 08c-event-bus
wave: B-8
title: "BullMQ Worker/consumer — потребляет DomainEvents из Queue, REST /events для просмотра (замыкает Event Bus трилогию)"
milestone: "Orchestra MVP — Wave 8c (Event Bus → consumer)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-20
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build) + runtime-gate (live test: trigger mutation → worker потребляет job → ring buffer содержит event → GET /events его возвращает, с УСИЛЕННЫМ evidence-rule §0.2) + regression-gate (Phase 5/6/7/8/8b/8c-1/8c-2 spec'и green)
baseline_before: "Phase 8c-2 PASS (commit 9cbd1cf): EventsGateway (pub/sub→WS) работает, UI real-time. Publisher публикует events в BullMQ Queue 'orchestra.events' (persist) И pub/sub (real-time). Queue накапливает jobs без обработчика. Wave 8c-3 = первый consumer, замыкает producer(8c-1)→transport(8c-2)→consumer(8c-3) трилогию."
depends_on:
  - "Phase 8c-1 (0b41520) — BullMQ Queue 'orchestra.events' + EVENT_QUEUE_NAME"
  - "Phase 8c-2 (9cbd1cf) — redis.config.ts, EVENT_PUBSUB_CHANNEL (не меняем)"
  - "@orchestra/domain events.ts — 3 типа DomainEvent"
closes_debts:
  - "D-8c-1 Event consumer (BullMQ Worker) — Wave 8c-3 закрывает. Queue теперь имеет обработчик, jobs не накапливаются бесконечно."
  - "Косвенно подготавливает Wave 8d — когда Decision Repository появится, consumer переключится с logging на Prisma persist, инфраструктура готова."
opens_debts_expected:
  - "D-8c-3-1: Persist events в PostgreSQL (Decision Repository) — Wave 8d (D-F1/D-F3)."
  - "D-8c-3-2: Event-driven business logic (RoundStarted → auto-action, PhaseChanged → notification) — Wave 8c+."
  - "D-8c-3-3: Consumer retry/DLQ tuning — сейчас BullMQ default. Production-grade tuning — Wave 8c+."
  - "D-8c-3-4: Event filtering в GET /events (по sessionId, по type, по timeframe) — сейчас только sessionId. Расширить при росте использования."
---

# PLAN 8c-3 — BullMQ Worker/consumer + REST /events

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8c-3-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **EVIDENCE-RULE (УСИЛЕННЫЙ, доказан 3 раза — 8b-02, 8c-01, 8c-2):** для каждого runtime-D
> явно указан тип evidence. Главный тест D-19 (worker потребляет → GET /events возвращает) —
> лично техлид верифицирует.

## 0. Контекст

### 0.1. Что есть сейчас

**Phase 8c-1 (PASS, `0b41520`)**: `RedisEventPublisher` публикует DomainEvents в BullMQ Queue
`'orchestra.events'` через `queue.add(event.type, event, { jobId: event.id })`. BullMQ Queue
= persisted job storage в Redis. `removeOnComplete: 100`, `removeOnFail: 200` — TTL control.

**Phase 8c-2 (PASS, `9cbd1cf`)**: EventsGateway подписан на Redis pub/sub channel (параллельно
с Queue) → форвардит в WS-клиенты для real-time UI. Publisher пишет **в оба** (Queue + pub/sub).

**Проблема:** Queue накапливает jobs, но **никто их не потребляет**. BullMQ `removeOnComplete`
удаляет после выполнения, но без Worker'а jobs остаются в `wait` состоянии бесконечно. Это:
- Бесполезный расход Redis памяти (медленно, но растёт).
- Не помогает audit/debug (нет logging).
- Не подготавливает почву для Wave 8d persist (consumer infrastructure).

### 0.2. Что делает Phase 8c-3 (scope — owner-decision 2026-07-20)

**Logging consumer + REST /events endpoint для просмотра.**

- ✅ `EventConsumerService` — BullMQ Worker потребляет events из Queue.
- ✅ При получении event: structured log (JSON в `logger.log`) + append в **in-memory ring buffer** (1000 последних events).
- ✅ `EventsController` — `GET /events` (последние N, default 100, max 1000) + `GET /events?sessionId=X` (filter).
- ✅ `EventsModule` — NestJS wiring (service + controller).

**НЕ в scope (забор на Wave 8d+):**
- **Persist events в PostgreSQL** (Decision Repository) — Wave 8d (D-F1/D-F3). При рестарте
  API ring buffer обнуляется. Persist = долговременный audit trail.
- **Event-driven business logic** (RoundStarted → auto-action, PhaseChanged → notification
  через WS) — Wave 8c+ (D-8c-3-2). Сейчас consumer = pure logging.
- **Retry/DLQ tuning** — BullMQ default (`attempts: 3` от publisher). Production-grade tuning
  позже.
- **Расширение DomainEvent до 11 типов** — D-8c-4, по мере появления emiters.
- **Event replay** (Engineering Time Machine) — Wave 8d+, требует persist.
- **Subscribe через WS к /events stream** — сейчас REST polling. WS stream для audit-trail
  viewer — Wave 8c+ когда понадобится real-time audit.

### 0.3. Архитектурное решение: BullMQ Worker (не @Processor decorator)

**Выбор:** `new Worker(EVENT_QUEUE_NAME, async (job) => {...}, { connection })` внутри
`@Injectable OnModuleInit`.

**Обоснование:**
- BullMQ 5.x `Worker` class — explicit lifecycle (`OnModuleInit` создаёт, `OnModuleDestroy`
  закрывает). Полный контроль over concurrency, connection, error handling.
- `@Processor` decorator от `@nestjs/bullmq` — требует доп. dep и NestJS-bull integration.
  Для простого logging consumer overkill.
- Explicit `Worker` соответствует existing код-стилю (`RedisEventPublisher` explicit `Queue`,
  `EventsGateway` explicit `subscriber`).

### 0.4. Ring buffer: простой array

```typescript
private readonly buffer: DomainEvent[] = [];
private readonly maxSize = 1000;

private append(event: DomainEvent) {
  this.buffer.push(event);
  if (this.buffer.length > this.maxSize) {
    this.buffer.shift();  // удаляем самый старый
  }
}
```

**Почему не round-buffer lib:** 1000 элементов — тривиально, shift O(n), но n=1000 на event
— micro-optimization не нужна. Простота > cleverness. Production-grade persist = Wave 8d.

### 0.5. Что НЕ меняется

- `packages/**` — НЕ ТРОГАТЬ (D-26).
- `apps/api/src/event-bus/{redis-event-publisher,events.gateway,redis.config,event-bus.module}.ts` —
  НЕ ТРОГАТЬ (Phase 8c-1/8c-2 код, не трогаем).
- `apps/api/src/{sessions,gsd,kg,context,roles,consensus,providers,prompts}/**` — НЕ ТРОГАТЬ
  (бизнес-модули Phase 2-8).
- `apps/api/src/{prisma.service,app.module,main}.ts` — НЕ ТРОГАТЬ.
- `apps/web/**` — НЕ ТРОГАТЬ (UI не трогаем, audit viewer — Wave 8c+).
- Prisma schema, docs, role-manifests, prompts, docker-compose — НЕ ТРОГАТЬ.

---

## 1. Архитектура

### 1.1. Структура файлов

```
apps/api/src/
├── events/                                    # НОВЫЙ модуль
│   ├── event-consumer.service.ts              # НОВЫЙ: BullMQ Worker
│   ├── events.controller.ts                   # НОВЫЙ: GET /events
│   ├── events.module.ts                       # НОВЫЙ: NestJS module
│   └── event-buffer.ts                        # НОВЫЙ: in-memory ring buffer (или inline в service)
└── app.module.ts                              # ИЗМЕНИТЬ: imports += EventsModule
```

### 1.2. Полный поток

```
RedisEventPublisher.publish(event)
  ├── queue.add → bull:orchestra.events:* (Queue, persist)
  └── pubsub.publish('orchestra.events.pubsub', JSON)
      ↓                                    ↓
Redis pub/sub channel              Queue (Redis)
      ↓                                    ↓ BullMQ Worker pull
EventsGateway → WS broadcast         EventConsumerService.process(job)
      ↓                                    ├── logger.log(JSON event)
useEventsSubscription hook                └── buffer.push(event) (ring buffer 1000)
      ↓
UI real-time                              HTTP GET /events
                                          ↓
                                          EventsController.list()
                                          ↓
                                          buffer.slice(-N) → JSON response
```

**Важно:** Worker и pub/sub — **параллельные пути**. Worker pull из Queue (persist),
EventsGateway push из pub/sub (real-time). Независимы. Это гарантирует что real-time UI не
зависит от Worker (если Worker упал — UI продолжает real-time через pub/sub).

---

## 2. Backend (apps/api/src/events/)

### 2.1. `event-buffer.ts` — in-memory ring buffer

```typescript
import { Injectable } from '@nestjs/common';
import type { DomainEvent } from '@orchestra/domain';

const MAX_BUFFER_SIZE = 1000;

/**
 * In-memory ring buffer последних DomainEvents (max 1000).
 *
 * При переполнении — удаляем самые старые (shift). Не persisted — обнуляется при рестарте API.
 * Persist в PostgreSQL (Decision Repository) — Wave 8d (D-F1/D-F3).
 *
 * Thread-safe в Node.js (single-threaded event loop) — не нужны locks.
 */
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
    // Последние N (reverse chronological для UI-friendliness)
    return result.slice(-limit).reverse();
  }

  clear(): void {
    this.events.length = 0;
  }

  get size(): number {
    return this.events.length;
  }
}
```

> Reverse chronological — UI-friendliness (свежие сверху). Если клиенту нужна chronological —
> reverse на клиенте.

### 2.2. `event-consumer.service.ts` — BullMQ Worker

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { DomainEvent } from '@orchestra/domain';
import { REDIS_CONNECTION, EVENT_QUEUE_NAME } from '../event-bus/redis.config.js';
import { EventBuffer } from './event-buffer.js';

/**
 * BullMQ Worker — потребляет DomainEvents из Queue 'orchestra.events'.
 *
 * Phase 8c-3: logging + ring buffer. Persist в PostgreSQL — Wave 8d (D-F1).
 * Event-driven business logic (RoundStarted → auto-action) — Wave 8c+ (D-8c-3-2).
 *
 * Worker и pub/sub (EventsGateway) — независимые пути. Если Worker падает, real-time UI
 * продолжает работать через pub/sub. Worker restart автоматически обрабатывает backlog.
 */
@Injectable()
export class EventConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventConsumerService.name);
  private worker?: Worker;

  constructor(private readonly buffer: EventBuffer) {}

  onModuleInit() {
    this.worker = new Worker<DomainEvent>(
      EVENT_QUEUE_NAME,
      async (job: Job<DomainEvent>) => {
        const event = job.data;
        // 1. Structured log
        this.logger.log(
          JSON.stringify({
            type: event.type,
            id: event.id,
            sessionId: event.sessionId,
            occurredAt: event.occurredAt,
            // event-specific fields (roundId, from/to, reason) — все в event
            ...this.extractPayload(event),
          }),
        );
        // 2. Append to ring buffer (for GET /events)
        this.buffer.append(event);
      },
      {
        connection: REDIS_CONNECTION,
        concurrency: 5,  // 5 jobs параллельно
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

  /**
   * Извлекает event-specific payload для логирования (без дублирования общих полей).
   * RoundStarted → roundId, phase. PhaseChanged → from, to, gatingVerdict. И т.д.
   */
  private extractPayload(event: DomainEvent): Record<string, unknown> {
    const { id, type, sessionId, occurredAt, ...rest } = event;
    return rest;
  }
}
```

**Ключевые моменты:**
- `Worker<DomainEvent>` — типизированный BullMQ Worker.
- `concurrency: 5` — до 5 events параллельно (events независимы, можно).
- `on('failed')` / `on('error')` — error handling, не падает.
- `extractPayload` — выносит type-specific fields (roundId, from/to, reason) в log, без
  дублирования id/type/sessionId/occurredAt которые уже на верхнем уровне.
- Worker создаётся в `onModuleInit` (не в constructor) — BullMQ требует чтобы connection был
  готов. Закрывается в `onModuleDestroy` — graceful shutdown.

### 2.3. `events.controller.ts` — REST /events

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import type { DomainEvent } from '@orchestra/domain';
import { EventBuffer } from './event-buffer.js';

/**
 * REST endpoint для просмотра последних обработанных DomainEvents.
 *
 * Phase 8c-3: in-memory ring buffer (max 1000). При рестарте API — обнуляется.
 * Persist в PostgreSQL — Wave 8d.
 *
 * Не имеет auth (D-H1 Wave 8+). Public read-only для dev/debug.
 */
@Controller('events')
export class EventsController {
  constructor(private readonly buffer: EventBuffer) {}

  /**
   * GET /events — последние N events (default 100, max 1000).
   * Опц. query: ?sessionId=X (filter by session), ?limit=N.
   * Reverse chronological (свежие сверху).
   */
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
```

**Response shape:**
```json
{
  "events": [
    {
      "id": "RoundStarted-session-...-0",
      "type": "RoundStarted",
      "sessionId": "session-...",
      "roundId": "round-...",
      "phase": "Discover",
      "occurredAt": "2026-07-20T..."
    }
  ],
  "total": 42
}
```

`total` — размер buffer (для UI pagination в будущем). `events` — отфильтрованный + limited
slice (не влияет на total).

### 2.4. `events.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { EventBuffer } from './event-buffer.js';
import { EventConsumerService } from './event-consumer.service.js';
import { EventsController } from './events.controller.js';

@Module({
  providers: [EventBuffer, EventConsumerService],
  controllers: [EventsController],
  exports: [EventBuffer],  // на случай если другой модуль захочет читать buffer
})
export class EventsModule {}
```

### 2.5. `app.module.ts` — imports += EventsModule

```typescript
import { Module } from '@nestjs/common';
// ... existing imports
import { EventsModule } from './events/events.module.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule, GsdModule, SessionsModule, EventsModule],
})
export class AppModule {}
```

---

## 3. must_haves.truths (D-критерии)

### Backend code

- **D-01** `apps/api/src/events/event-buffer.ts`:
  - `@Injectable() class EventBuffer`.
  - `append(event)` push + shift если > maxSize (1000).
  - `list({ sessionId?, limit? })` filter + slice(-limit).reverse() (reverse chronological).
  - `clear()`, `get size`.
- **D-02** `apps/api/src/events/event-consumer.service.ts`:
  - `@Injectable() class EventConsumerService implements OnModuleInit, OnModuleDestroy`.
  - `new Worker<DomainEvent>(EVENT_QUEUE_NAME, async (job) => {...})` в `onModuleInit`.
  - Handler: `logger.log(JSON event)` + `buffer.append(event)`.
  - `on('failed')`, `on('error')` — error handling, не падает.
  - `concurrency: 5`.
  - `onModuleDestroy` → `worker.close()`.
- **D-03** `apps/api/src/events/events.controller.ts`:
  - `@Controller('events')`.
  - `@Get() list(sessionId?, limit?)` → `{ events, total }`.
  - Reverse chronological.
- **D-04** `apps/api/src/events/events.module.ts`:
  - `providers: [EventBuffer, EventConsumerService]`, `controllers: [EventsController]`.
  - `exports: [EventBuffer]`.
- **D-05** `apps/api/src/app.module.ts`:
  - `imports += EventsModule`.
  - Остальные imports не тронуты.

### Build

- **D-06** `pnpm -r typecheck` → 10 пакетов green.
- **D-07** `pnpm --filter @orchestra/api build` → green. `apps/api/dist/main.js` + `events/*.js` существуют.

### Regression

- **D-08** `pnpm --filter @orchestra/gsd-engine test` → green (7/7).
- **D-09** `pnpm --filter @orchestra/consensus-engine test` → green (6/6).
- **D-10** `pnpm --filter @orchestra/api test` → green (5/5).
- **D-11** `pnpm --filter @orchestra/api test:e2e` → green (8/8).

### Runtime (УСИЛЕННЫЙ evidence-rule, главный D-15)

- **D-12** `docker compose up -d redis` → Redis up, PING = PONG.
- **D-13** `node apps/api/dist/main.js` стартует, в логе:
  - `[InstanceLoader] EventsModule dependencies initialized`.
  - `[EventConsumerService] Worker started on queue 'orchestra.events', concurrency=5`.
  - `[Bootstrap] Orchestra API listening`.
  - Никаких error.
  Evidence: copy-paste лога API.
- **D-14** GET /events без events (после рестарта API) → 200, `{ events: [], total: 0 }`.
  Evidence: curl + body.
- **D-15** **ГЛАВНЫЙ — Worker потребляет и ring buffer содержит:**
  1. Запустить API.
  2. `GET /events` → `{ events: [], total: 0 }`.
  3. Trigger: `curl POST /sessions + POST /sessions/:id/rounds`.
  4. `GET /events` → 200, `events: [...]` содержит `RoundStarted` event, `total: 1`.
  5. Trigger ещё один: `POST /sessions/:id/rounds` (создаст round 2).
  6. `GET /events?limit=10` → `total: 2`, `events[0]` — последний (round 2).
  7. `GET /events?sessionId=<id>` → фильтр работает.

  Evidence: copy-paste всех curl + JSON responses. Лично техлид.
- **D-16** Worker error handling: проверка что при невалидном job (если бы такой был) worker не
  падает. Для MVP — достаточно что `on('failed')` и `on('error')` зарегистрированы (code review).
  Evidence: code review D-02.
- **D-17** Real-time UI (Phase 8c-2) не сломан: events публикуются И в Queue (теперь с consumer)
  И в pub/sub (EventsGateway → WS). UI real-time продолжает работать.
  Evidence: D-21-style — `redis-cli SUBSCRIBE orchestra.events.pubsub` + trigger mutation →
  JSON event в pub/sub (как в Phase 8c-2).

### Anti-conflict

- **D-18** `packages/**` (всё): 0 изменений.
- **D-19** `apps/api/src/`: изменения ТОЛЬКО:
  - `events/` (НОВЫЙ module — 4 файла).
  - `app.module.ts` (+EventsModule import).
  Другие apps/api/src/ — 0 diff.
- **D-20** `apps/api/src/{sessions,gsd,kg,context,roles,consensus,providers,prompts,event-bus,prisma.service,main}.ts/**`:
  0 изменений (особенно event-bus/ — Phase 8c-1/8c-2, не трогаем).
- **D-21** `apps/api/{tsconfig.json,nest-cli.json,prisma/,test/,package.json}`: 0 изменений
  (deps bullmq/ioredis/socket.io уже установлены из 8c-1/8c-2).
- **D-22** `apps/web/**`: 0 изменений.
- **D-23** `docs/`, `role-manifests/`, `prompts/`: 0 изменений.
- **D-24** `.planning/phases/08-http-api-gateway/`, `.planning/phases/08b-conducting-score-ui/`,
  `.planning/phases/08c-event-bus/{8c-01,8c-2}-*` (PLAN+SUMMARY+README): 0 изменений.
- **D-25** Root config (`tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json`, `docker-compose.yml`):
  0 изменений.

### Discipline

- **D-26** SUMMARY содержит evidence для каждого runtime-D (D-12..17). Главный D-15 —
  copy-paste curl + JSON responses. Без evidence = auto-FAIL.
- **D-27** Все процессы остановлены (api node + redis-cli subscriber если запускался).
  `docker compose stop redis` в конце. Порты 3001/6380 свободны. PID + kill commands в SUMMARY.
- **D-28** SUMMARY честно описывает: consumer = logging + ring buffer, persist — Wave 8d.
  Никаких заявлений про "Decision Repository" или "ADR" (это Wave 8d).

---

## 4. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-28 PASS (с evidence).
2. BullMQ Worker потребляет events из Queue (логирует + ring buffer).
3. `GET /events` возвращает обработанные events с filter и limit.
4. Real-time UI (Phase 8c-2) продолжает работать.
5. Regression Phase 5/6/7/8/8b/8c-1/8c-2 green.
6. Anti-conflict: только новый events/ module + 1 строка в app.module.ts.

**Фаза НЕ выполнена, если:**
- Worker не запускается или не потребляет (D-13/D-15 FAIL).
- `GET /events` не возвращает events после trigger (D-15 FAIL) — главный критерий.
- Real-time UI сломан (D-17 FAIL) — pub/sub и worker разрушили.
- Кодер тронул что-то вне разрешённых зон (D-18..25 FAIL).
- SUMMARY без evidence (D-26 FAIL).

---

## 5. Порядок работы кодера

1. **Прочитать PLAN.** Особенно §0.3 (BullMQ Worker, не @Processor), §0.4 (ring buffer), §2.2
   EventConsumerService, §3 D-15 (главный test).
2. **Создать events/ module (§2.1..2.4):**
   - `event-buffer.ts` — ring buffer.
   - `event-consumer.service.ts` — BullMQ Worker.
   - `events.controller.ts` — REST /events.
   - `events.module.ts` — NestJS module.
3. **Wire в app.module.ts (§2.5):** imports += EventsModule.
4. **Build (D-06, D-07):** `pnpm -r typecheck`, `pnpm --filter @orchestra/api build`.
5. **Runtime verifier (D-12..17) с УСИЛЕННЫМ evidence:**
   - D-12: docker compose up redis.
   - D-13: API start, copy-paste лога (особенно `Worker started` строка).
   - D-14: GET /events empty.
   - **D-15: главный — trigger mutation → GET /events содержит events + total растёт + filter работает.**
   - D-17: redis-cli SUBSCRIBE → pub/sub продолжает работать (real-time не сломали).
   - Cleanup: PID + kill + `docker compose stop redis`.
6. **Regression (D-08..11):** 4 spec'а.
7. **Anti-conflict (D-18..25):** git diff.
8. **`8c-3-SUMMARY.md`** с evidence.

**Оценка:** ~4-6 часов (4 файла + verification).

---

## 6. Design notes

1. **BullMQ Worker, не @Processor.** Explicit lifecycle, не требует @nestjs/bullmq dep.
   Соответствует existing код-стилю (RedisEventPublisher explicit Queue).
2. **Ring buffer — простой array + shift.** 1000 элементов — micro-optimization не нужна.
   Persist = Wave 8d. Простота > cleverness.
3. **concurrency: 5.** Events независимы (RoundStarted, PhaseChanged, etc не имеют общих
   мутаций). 5 параллельно — разумно для throughput. Можно tuning.
4. **Reverse chronological в GET /events.** UI-friendly (свежие сверху). Клиент может reverse
   если нужна chronological.
5. **Worker ≠ pub/sub path.** Worker pull из Queue (persist, для audit). EventsGateway push из
   pub/sub (real-time для UI). Независимые. Если Worker упал — UI продолжает real-time. Если
   pub/sub упал — Worker продолжает persist (для audit). Двойная надёжность.
6. **`extractPayload` для лога.** Event-specific fields (roundId, from/to, reason) — в log
   отдельно от общих (id/type/sessionId/occurredAt на верхнем уровне). Читаемый structured log.
7. **GET /events — public read-only.** Auth (D-H1) — Wave 8+. Сейчас dev/debug endpoint.
   В production закрыть auth guard.
8. **Не persist в PostgreSQL.** Phase 8c-3 = consumer infra, не Decision Repository. Persist =
   Wave 8d, требует Prisma migration. После 8d — переключить `buffer.append` на `prisma.event.create`.
9. **Ring buffer survives worker restart, но не API restart.** In-memory в Node.js process.
   API restart → buffer пуст. Persist (Wave 8d) решает это. Для dev достаточно — developer
   триггерит event когда нужен.

---

## 7. Долги, которые фаза ЗАКРЫВАЕТ

- **D-8c-1** BullMQ Worker/consumer — Wave 8c-3 закрывает. Queue имеет обработчик, jobs не
  накапливаются бесконечно.
- **Косвенно:** подготавливает Wave 8d persist — consumer infrastructure готова, нужно только
  переключить buffer.append на prisma.event.create.

## 8. Долги, которые фаза ОТКРЫВАЕТ

- **D-8c-3-1** Persist events в PostgreSQL (Decision Repository) — Wave 8d (D-F1/D-F3).
- **D-8c-3-2** Event-driven business logic (RoundStarted → auto-action) — Wave 8c+.
- **D-8c-3-3** Retry/DLQ tuning — сейчас BullMQ default.
- **D-8c-3-4** Event filtering расширение (type, timeframe) — сейчас только sessionId.
- **D-8c-3-5** WS stream для audit viewer (real-time GET /events вместо polling) — Wave 8c+.

### Перенесённые долги (без изменений)

- D-8c-2-1..4 — UI real-time extension (Wave 8c-2 closed, эти как были).
- D-8c-4 DomainEvent расширение до 11 типов.
- D-8c-5 Event replay (Wave 8d+).
- D-H1 Auth, D-H3 Pagination.

---

## 9. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| Worker не подключается к Redis (connection error) | низкая | reusing REDIS_CONNECTION от publisher/gateway (working). Logger.error на `worker.on('error')`. |
| Worker падает на невалидном job | низкая | BullMQ auto-retry (`attempts: 3` от publisher). `on('failed')` логирует. |
| Ring buffer растёт бесконечно | исключено | `shift` при > maxSize=1000 в `append`. |
| GET /events возвращает слишком много | низкая | `limit` query, max 1000, default 100. |
| Worker блокирует pub/sub (общий connection) | исключено | BullMQ Worker использует свой connection из REDIS_CONNECTION (как Queue). Pub/sub — отдельные connection в publisher и gateway. |
| При API restart buffer обнуляется | по дизайну | Persist = Wave 8d. Для MVP in-memory достаточно. |
| Code reviewer (техлид) не сможет проверить consumer working | низкая | D-15 — главный, через GET /events. Техлид curl'ом trigger'ит mutation, curl'ом проверяет /events. Объективно. |
| Process zombies (8-03 precedent) | средняя | D-27 — формальный критерий, PID + kill commands + `docker compose stop redis`. |

---

## 10. Что получает Orchestra после Phase 8c-3

**Event Bus трилогия замкнута.** producer (8c-1) → transport real-time (8c-2) → **consumer (8c-3)**.
Теперь:

1. **Queue не накапливается** — Worker потребляет jobs, BullMQ `removeOnComplete` чистит.
2. **Audit log виден** через `GET /events` — dev-friendly debug без redis-cli.
3. **Structured event log** в API stdout — интегрируется с любым log aggregator (Loki, ELK).
4. **Готовая consumer infra** для Wave 8d persist — переключить `buffer.append` на Prisma.
5. **Готовая infra для event-driven features** (Wave 8c+) — Worker может дёргать business logic.

**Phase 8c-3 = Orchestra Event Bus становится полноценной системой.** Не труба без получателя.

---

**Конец PLAN 8c-3.** Ждёт `/gsd-execute-phase 8c.3` (mimo) → `/gsd-validate-phase 8c.3`.
После PASS — README-CONTRACT-PHASE-8c-3.md → Wave 8c полностью закрыта (producer + transport +
consumer). Wave 8d (Decision Repository persist) — следующая.
