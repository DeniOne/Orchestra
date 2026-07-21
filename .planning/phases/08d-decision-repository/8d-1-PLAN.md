---
phase: 8d
slug: 08d-decision-repository
wave: B-8
title: "Decision Repository MVP — persist DomainEvents в PostgreSQL через Prisma, audit trail переживающий рестарт API"
milestone: "Orchestra MVP — Wave 8d (Decision Repository persist)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-21
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build) + migration-gate (prisma migrate dev green, schema применена к БД) + runtime-gate (live test: trigger mutation → GET /events из БД + restart API → events всё ещё доступны, с УСИЛЕННЫМ evidence-rule §0.2) + regression-gate (Phase 5/6/7/8/8b/8c-1/8c-2/8c-3 spec'и green)
baseline_before: "Phase 8c-3 PASS (commit be656d3): BullMQ Worker потребляет DomainEvents, in-memory ring buffer (max 1000). GET /events читает из buffer. При рестарте API — все events теряются. Architecture §3 Decision Repository = PostgreSQL, но пока не реализован. Phase 8d = persist events в БД, audit trail долговременный."
depends_on:
  - "Phase 8c-3 (be656d3) — EventConsumerService, EventsController, EventBuffer (будем переключать на Prisma)"
  - "Phase 2 — PrismaService (apps/api/src/prisma.service.ts), уже работает (lazy-connect)"
  - "Phase 8 (0df6f67) — PostgreSQL required для advance, уже подключена через DATABASE_URL"
closes_debts:
  - "D-8c-3-1 Persist events в PostgreSQL (Decision Repository) — Phase 8d закрывает. Audit trail долговременный."
  - "Косвенно D-F1 (Prisma persistence) — первый шаг к полном persistent layer. SessionStore persist — отдельная фаза."
  - "Косвенно D-F3 (KG-запись артефактов) — events теперь persist'ятся, foundation для KG-artifact linking."
opens_debts_expected:
  - "D-8d-1: SessionStore persistence (сейчас InMemory) — Wave 8d+. Сессии всё ещё теряются при рестарте."
  - "D-8d-2: Full Decision Repository (ADR/Decision/Spec versioined artifacts) — отдельная фаза. Сейчас persist events только."
  - "D-8d-3: Event replay (Engineering Time Machine) — теперь возможно (events persisted), но UI/logic — Wave 8d+."
  - "D-8d-4: KG-artifact linking (событие → ADR/Decision link) — Wave 8d+."
  - "D-8d-5: Event retention policy (TTL/cleanup старых events) — сейчас растёт бесконечно."
---

# PLAN 8d-1 — Decision Repository MVP (persist DomainEvents в PostgreSQL)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8d-1-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **EVIDENCE-RULE (УСИЛЕННЫЙ, доказан 4 раза — 8b-02, 8c-01, 8c-2, 8c-3):** для каждого runtime-D
> явно указан тип evidence. Главный тест D-15 — **persistence survives restart** (trigger mutation,
> restart API, GET /events всё ещё содержит events). Техлид верифицирует лично.

## 0. Контекст

### 0.1. Что есть сейчас

**Phase 8c-3 (PASS, `be656d3`)**:
- `EventConsumerService` (BullMQ Worker) потребляет DomainEvents из Queue, логирует + append в
  `EventBuffer` (in-memory ring buffer, max 1000).
- `EventsController` `GET /events` читает из `EventBuffer`.
- При рестарте API — **все events теряются** (buffer in-memory).

**Phase 2 (PASS)**:
- `PrismaService` (apps/api/src/prisma.service.ts) — `extends PrismaClient`, lazy-connect (Phase 8.03).
- Используется в `KgModule` → `KgService` для KgNode/KgRelationship.
- `apps/api/prisma/schema.prisma` — только KG models.

**Phase 8 (PASS, PostgreSQL required)**:
- `advance` требует БД (ContextService → KgService → Prisma). `DATABASE_URL` обязательна для
  полного GSD цикла. Но **создание сессии, list, start round, approve, override** работают на
  InMemorySessionStore без БД.

**docker-compose.yml** (Phase 8c-1): только Redis. Postgres **не входит** — разработчик
поднимает свой (Docker `dmg-postgres` на :5432 или локальный).

### 0.2. Что делает Phase 8d (scope — owner-decision 2026-07-21)

**Persist events в PostgreSQL через Prisma.** Минимальная Decision Repository infrastructure:

- ✅ Prisma schema: новая `model DomainEventRecord`.
- ✅ `prisma migrate dev --name add_domain_events` — создаёт миграцию + применяет.
- ✅ `EventConsumerService` persist'ит event в БД **параллельно** с in-memory buffer (backward
  compat: GET /events читает из БД, но buffer остаётся как in-memory cache для fail-fast если БД down).
- ✅ `EventsController` `GET /events` читает из БД (`prisma.domainEventRecord.findMany`).
- ✅ Postgres добавлена в `docker-compose.yml` (порт 5433 → 5432, чтобы не конфликтовать с
  `dmg-postgres`).
- ✅ **Persistence survives restart** — после рестарта API events всё ещё доступны через GET /events.

**НЕ в scope (забор на Wave 8d+):**
- **Full Decision Repository** (ADR/Decision/Spec versioined artifacts) — Architecture §3 канон,
  но это требует understanding что persist'ить (consensus пока не генерит decisions). Сейчас —
  persist DomainEvents только. Полный DR — когда Consensus Engine начнёт формировать decisions.
- **SessionStore persistence** (InMemorySessionStore → Prisma) — отдельная фаза (D-8d-1). Сессии
  всё ещё теряются при рестарте, только events сохраняются.
- **Event replay UI** (Engineering Time Machine) — events теперь persisted, но UI для replay —
  Wave 8d+.
- **KG-artifact linking** (event → ADR/Decision link) — Wave 8d+.
- **Event retention policy** (TTL/cleanup) — сейчас events копятся бесконечно (manual cleanup).
- **Event filtering по type/timeframe** в GET /events — сейчас только sessionId+limit.

### 0.3. Архитектурное решение: persist + in-memory cache (dual write)

**Проблема:** Если переключить EventConsumer на persist-only (убрать buffer), то при БД-down events
теряются. Но events **не на critical-path** (Phase 8 API не зависит от Event Bus), БД-down —
допустимый scenario в dev.

**Решение:** EventConsumer делает **dual write** — persist в БД **И** append в buffer. Buffer
остаётся как:
1. **Fast cache** — GET /events без задержки на БД.
2. **Fallback** — если БД-down, buffer продолжает работать (но без persist).

**GET /events** читает из БД (source of truth). Если БД-down — fallback на buffer.

> Кодер: это компромисс. Можно было сделать persist-only (чище), но buffer даёт resilience
> для dev-сценариев и backward compat. Техлид рекомендует dual write.

### 0.4. Postgres port: 5433 (внешний) → 5432 (внутренний)

`dmg-postgres` (твой проект DMG) уже занимает :5432. Orchestra Postgres в docker-compose —
**:5433:5432** (внешний 5433, внутренний 5432 стандартный Postgres).

`DATABASE_URL` для Orchestra API: `postgresql://orchestra:orchestra@localhost:5433/orchestra`.

> Кодер: добавить в `.env.example` пример DATABASE_URL с портом 5433.

### 0.5. Что НЕ меняется

- `packages/**` — НЕ ТРОГАТЬ.
- `apps/api/src/{sessions,gsd,kg,context,roles,consensus,providers,prompts,event-bus,prisma.service,main,app.module}.ts`:
  изменения ТОЛЬКО в `app.module.ts` (+EventsModule уже там из 8c-3, не трогаем) — на самом деле
  app.module.ts НЕ ТРОГАЕМ, EventsModule уже импортирован.
- `apps/api/src/gsd/**` — НЕ ТРОГАТЬ (Phase 6/7).
- `apps/web/**` — НЕ ТРОГАТЬ.
- `docs/`, `role-manifests/`, `prompts/`, `.planning/phases/08-*` (все предыдущие PLAN/SUMMARY/README)
  — НЕ ТРОГАТЬ.
- Root `tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json` — НЕ ТРОГАТЬ.

**Единственные изменения:**
- `docker-compose.yml` — +postgres service.
- `apps/api/prisma/schema.prisma` — +model DomainEventRecord.
- `apps/api/prisma/migrations/<timestamp>_add_domain_events/` — НОВАЯ миграция (автогенерация).
- `apps/api/src/events/event-persistence.service.ts` — НОВЫЙ сервис для persist/read в БД.
- `apps/api/src/events/event-consumer.service.ts` — ИЗМЕНИТЬ: dual write (buffer + persistence).
- `apps/api/src/events/events.controller.ts` — ИЗМЕНИТЬ: читать из БД через persistence service
  (с fallback на buffer).
- `apps/api/src/events/events.module.ts` — ИЗМЕНИТЬ: +PrismaService provider, +EventPersistenceService.
- `apps/api/.env.example` — +DATABASE_URL example с port 5433.

---

## 1. Архитектура

### 1.1. Полный поток после Phase 8d

```
RedisEventPublisher.publish(event)
  ├── queue.add → BullMQ Queue
  │     ↓ Worker
  │   EventConsumerService.process(job)
  │     ├── logger.log(JSON event)
  │     ├── buffer.append(event)              ← in-memory cache (быстрый fallback)
  │     └── persistence.persist(event)        ← НОВОЕ: write в PostgreSQL
  │
  └── pubsub.publish → EventsGateway → WS     ← real-time UI, не меняется

HTTP GET /events
  ↓
EventsController.list(sessionId?, limit?)
  ↓
persistence.list({sessionId, limit})           ← НОВОЕ: read из PostgreSQL
  ↓ fallback если БД-down
buffer.list({sessionId, limit})                ← existing in-memory

PostgreSQL (docker-compose, :5433)
  ↓
DomainEventRecord table                        ← НОВОЕ
  - id (varchar PK, = DomainEvent.id)
  - type (varchar)
  - sessionId (varchar, index)
  - occurredAt (timestamp)
  - payload (jsonb — full DomainEvent JSON)
```

### 1.2. Структура файлов

```
docker-compose.yml                                     # ИЗМЕНИТЬ: +postgres service
apps/api/
├── .env.example                                       # ИЗМЕНИТЬ: +DATABASE_URL port 5433
├── prisma/
│   ├── schema.prisma                                  # ИЗМЕНИТЬ: +model DomainEventRecord
│   └── migrations/<timestamp>_add_domain_events/      # НОВОЕ: migration SQL
└── src/events/
    ├── event-persistence.service.ts                   # НОВЫЙ: persist/read через Prisma
    ├── event-consumer.service.ts                      # ИЗМЕНИТЬ: dual write
    ├── events.controller.ts                           # ИЗМЕНИТЬ: read из БД + fallback buffer
    └── events.module.ts                               # ИЗМЕНИТЬ: +PrismaService, +EventPersistenceService
```

---

## 2. Backend

### 2.1. `docker-compose.yml` — +postgres

```yaml
# Порт 6380 (внешний) → 6379 (внутренний контейнера).
# Внешний 6380 используется вместо 6379, чтобы избежать конфликта с dmg-redis
# (проект DMG) или любым другим локальным Redis на стандартном порту.
services:
  redis:
    image: redis:7-alpine
    container_name: orchestra-redis
    ports:
      - "6380:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  # Порт 5433 (внешний) → 5432 (внутренний). Избегает конфликта с dmg-postgres
  # (проект DMG) на стандартном 5432. DATABASE_URL должна использовать порт 5433.
  postgres:
    image: postgres:16-alpine
    container_name: orchestra-postgres
    environment:
      POSTGRES_USER: orchestra
      POSTGRES_PASSWORD: orchestra
      POSTGRES_DB: orchestra
    ports:
      - "5433:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  redis-data:
  postgres-data:
```

### 2.2. `apps/api/prisma/schema.prisma` — +DomainEventRecord

Добавить в конец существующей schema:

```prisma
model DomainEventRecord {
  id         String   @id           // = DomainEvent.id (не auto-gen, передаём явно)
  type       String
  sessionId  String
  occurredAt DateTime
  payload    Json     // full DomainEvent JSON (event-specific fields: roundId, from/to, reason, etc.)

  createdAt  DateTime @default(now())

  @@index([sessionId])
  @@index([type])
  @@index([occurredAt])
}
```

**Ключевые моменты:**
- `id` — **string PK без @default**. Используем `DomainEvent.id` (например,
  `RoundStarted-session-...-0`) — идемпотентность (повторный persist того же event не создаёт
  дубль, упадёт по PK conflict — обрабатываем в сервисе).
- `payload` — Json (jsonb в PostgreSQL). Хранит **полный** DomainEvent JSON (event-specific fields).
  Это позволяет расширять типы событий без миграции schema каждый раз (новое поле в payload).
- `createdAt` — отличное от `occurredAt` (event occuredAt = когда событие произошло; createdAt =
  когда мы его записали в БД). Полезно для debugging latency.
- Indexы: `sessionId` (для filter), `type` (для type-filter Wave 8d+), `occurredAt` (для
  chronological queries).

### 2.3. `apps/api/src/events/event-persistence.service.ts` — НОВЫЙ

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { DomainEvent } from '@orchestra/domain';
import type { Prisma } from '@prisma/client';

/**
 * Persist DomainEvents в PostgreSQL через Prisma.
 *
 * Phase 8d: persist only. Full Decision Repository (ADR/Decision/Spec) — отдельная фаза.
 *
 * Идемпотентность: использует DomainEvent.id как PK. Если тот же event persist'ится дважды
 * (BullMQ retry), upsert не создаёт дубль (update existing = no-op, т.к. payload тот же).
 *
 * Best-effort: при БД-down (Prisma error) — логирует error, не падает (events не на critical path).
 * EventBuffer (in-memory cache в EventConsumer) остаётся как fallback для GET /events.
 */
@Injectable()
export class EventPersistenceService {
  private readonly logger = new Logger(EventPersistenceService.name);

  constructor(private readonly prisma: PrismaClient) {}

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
        update: {
          // no-op: event уже persisted, payload не меняется (идемпотентность)
        },
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
        orderBy: { occurredAt: 'desc' },  // reverse chronological
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
```

**Ключевые моменты:**
- `prisma.domainEventRecord.upsert` — идемпотентность через `id` PK.
- `payload as unknown as Prisma.InputJsonValue` — DomainEvent → Json (type-safe cast).
- `list` возвращает `{events, total}` — тот же shape что EventBuffer.list для controller compat.
- Best-effort: catch errors, не падает.

### 2.4. `event-consumer.service.ts` — dual write

Изменить handler (добавить persistence):

```typescript
import { EventPersistenceService } from './event-persistence.js';
// ...

@Injectable()
export class EventConsumerService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly buffer: EventBuffer,
    private readonly persistence: EventPersistenceService,  // ← НОВОЕ
  ) {}

  onModuleInit() {
    this.worker = new Worker<DomainEvent>(
      EVENT_QUEUE_NAME,
      async (job: Job<DomainEvent>) => {
        const event = job.data;
        this.logger.log(JSON.stringify({...}));
        this.buffer.append(event);              // in-memory cache (быстрый fallback)
        await this.persistence.persist(event);  // ← НОВОЕ: write в PostgreSQL
      },
      // ...
    );
    // ... existing on('failed'), on('error')
  }
}
```

**Dual write:** buffer + persistence. Buffer остаётся для fast cache и fallback.

### 2.5. `events.controller.ts` — read из БД с fallback на buffer

```typescript
import { EventPersistenceService } from './event-persistence.js';
// ...

@Controller('events')
export class EventsController {
  constructor(
    private readonly persistence: EventPersistenceService,  // ← primary
    private readonly buffer: EventBuffer,                    // ← fallback
  ) {}

  @Get()
  async list(
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ events: DomainEvent[]; total: number }> {
    const parsedLimit = limit ? Number(limit) : undefined;
    const numericLimit = Number.isNaN(parsedLimit) ? undefined : parsedLimit;

    try {
      // Primary: PostgreSQL (source of truth)
      return await this.persistence.list({
        sessionId,
        limit: numericLimit,
      });
    } catch {
      // Fallback: in-memory buffer (БД-down scenario)
      const events = this.buffer.list({ sessionId, limit: numericLimit });
      return { events, total: this.buffer.size };
    }
  }
}
```

### 2.6. `events.module.ts` — wiring

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';  // ← НОВОЕ
import { EventBuffer } from './event-buffer.js';
import { EventPersistenceService } from './event-persistence.service.js';  // ← НОВОЕ
import { EventConsumerService } from './event-consumer.service.js';
import { EventsController } from './events.controller.js';

@Module({
  providers: [PrismaService, EventBuffer, EventPersistenceService, EventConsumerService],
  controllers: [EventsController],
  exports: [EventBuffer, EventPersistenceService],
})
export class EventsModule {}
```

> **PrismaService** уже есть в apps/api (Phase 2). Импортируем в EventsModule. **Важно:**
> PrismaService в KgModule уже зарегистрирован, но EventsModule — отдельный module, нужен свой
> provider. NestJS DI создаёт новый instance? Нет — если PrismaService в `providers` каждого
> module, каждый имеет свой instance. Для consistency — или сделать `@Global() PrismaService`
> (требует изменения prisma.service.ts), или дублировать в EventsModule providers. Техлид
> рекомендует дублировать в EventsModule providers (minimal change, не трогаем prisma.service.ts).

### 2.7. `.env.example` — +DATABASE_URL

```bash
# Orchestra API env vars
# PostgreSQL (docker-compose orchestra-postgres на порту 5433)
DATABASE_URL="postgresql://orchestra:orchestra@localhost:5433/orchestra"

# Event Bus (Wave 8c)
REDIS_HOST=localhost
REDIS_PORT=6380
# REDIS_PASSWORD=
# REDIS_DB=0

# API
PORT=3001
```

---

## 3. must_haves.truths (D-критерии)

### Infrastructure

- **D-01** `docker-compose.yml` + `postgres` service:
  - image `postgres:16-alpine`.
  - container_name `orchestra-postgres`.
  - ports `5433:5432`.
  - env `POSTGRES_USER=orchestra`, `POSTGRES_PASSWORD=orchestra`, `POSTGRES_DB=orchestra`.
  - volume `postgres-data`.
- **D-02** `apps/api/.env.example` содержит `DATABASE_URL="postgresql://orchestra:orchestra@localhost:5433/orchestra"`.

### Prisma

- **D-03** `apps/api/prisma/schema.prisma` содержит `model DomainEventRecord`:
  - `id String @id` (без @default).
  - `type String`, `sessionId String`, `occurredAt DateTime`, `payload Json`.
  - `createdAt DateTime @default(now())`.
  - `@@index([sessionId])`, `@@index([type])`, `@@index([occurredAt])`.
- **D-04** `prisma migrate dev --name add_domain_events` создал миграцию в
  `apps/api/prisma/migrations/<timestamp>_add_domain_events/migration.sql`.
- **D-05** `prisma migrate dev` green, schema применена к БД. `prisma generate` green.
  Evidence: copy-paste вывода команды.

### Backend code

- **D-06** `apps/api/src/events/event-persistence.service.ts` НОВЫЙ:
  - `@Injectable EventPersistenceService`.
  - constructor `PrismaClient` DI.
  - `persist(event)` — `prisma.domainEventRecord.upsert` (идемпотентность), try/catch.
  - `list({sessionId?, limit?})` — `findMany` с orderBy `occurredAt desc`, returns `{events, total}`.
- **D-07** `apps/api/src/events/event-consumer.service.ts` ИЗМЕНИТЬ:
  - constructor += `EventPersistenceService`.
  - handler: dual write (buffer.append + persistence.persist).
- **D-08** `apps/api/src/events/events.controller.ts` ИЗМЕНИТЬ:
  - constructor += `EventPersistenceService`.
  - `list()`: primary `persistence.list()`, fallback `buffer.list()` при catch.
- **D-09** `apps/api/src/events/events.module.ts` ИЗМЕНИТЬ:
  - providers += `PrismaService`, `EventPersistenceService`.

### Build

- **D-10** `pnpm -r typecheck` → 10 пакетов green.
- **D-11** `pnpm --filter @orchestra/api build` → green. `apps/api/dist/events/event-persistence.service.js` существует.

### Regression

- **D-12** `pnpm --filter @orchestra/gsd-engine test` → green (7/7).
- **D-13** `pnpm --filter @orchestra/consensus-engine test` → green (6/6).
- **D-14** `pnpm --filter @orchestra/api test` → green (5/5).
- **D-15** `pnpm --filter @orchestra/api test:e2e` → green (8/8).

### Runtime (УСИЛЕННЫЙ evidence-rule, главный D-22)

- **D-16** `docker compose up -d` → Redis + Postgres running. PING Redis = PONG,
  Postgres accessible (psql или simple connection test).
  Evidence: docker compose ps + connection check.
- **D-17** `prisma migrate dev` applied:
  ```
  prisma migrate dev --name add_domain_events
  → Database reset successful + migration applied
  → DomainEventRecord table exists (psql \dt)
  ```
  Evidence: copy-paste вывода prisma migrate.
- **D-18** API start: `[EventConsumerService] Worker started`, `[Bootstrap] Orchestra API listening`.
  Evidence: copy-paste лога.
- **D-19** `GET /events` (empty до mutations) → 200, `{events:[], total:0}`.
- **D-20** Trigger mutation → `GET /events` содержит event из БД:
  1. `POST /sessions` + `POST /sessions/:id/rounds`.
  2. `GET /events` → `{events:[RoundStarted], total:1}`.
  3. Verify **в БД**: `psql -c 'SELECT id, type, "sessionId" FROM "DomainEventRecord";'` →
     row существует.
  Evidence: copy-paste GET curl + psql query.
- **D-21** Filter работает (GET /events?sessionId=X) из БД.
- **D-22** **ГЛАВНЫЙ — Persistence survives restart:**
  1. Trigger mutation (POST /sessions + /rounds).
  2. `GET /events` → event есть.
  3. **Остановить API** (Ctrl+C / kill).
  4. **Запустить API заново** (node dist/main.js).
  5. `GET /events` → **event всё ещё доступен** (persisted в БД, не buffer).

  Evidence: copy-paste всей последовательности с timestamps. Лично техлид.
- **D-23** Real-time UI (Phase 8c-2) не сломан: pub/sub продолжает работать.
  Evidence: redis-cli SUBSCRIBE + trigger → JSON event.
- **D-24** In-memory buffer fallback: если временно отключить БД (kill postgres container),
  API продолжает работать, GET /events fallback на buffer (in-memory).
  Evidence: `docker compose stop postgres` → trigger mutation → `GET /events` → event из buffer.

### Anti-conflict

- **D-25** `packages/**` (всё): 0 изменений.
- **D-26** `apps/api/src/{sessions,gsd,kg,context,roles,consensus,providers,prompts,event-bus,prisma.service,main,app.module}/**`:
  0 изменений.
- **D-27** `apps/api/src/events/`: изменения ТОЛЬКО в `event-persistence.service.ts` (НОВЫЙ),
  `event-consumer.service.ts` (+persistence DI), `events.controller.ts` (+read из БД),
  `events.module.ts` (+PrismaService, +EventPersistenceService), `event-buffer.ts` (БЕЗ ИЗМЕНЕНИЙ).
- **D-28** `apps/api/{tsconfig.json,nest-cli.json,test/,package.json}`: 0 изменений.
- **D-29** `apps/web/**`, `docs/`, `role-manifests/`, `prompts/`: 0 изменений.
- **D-30** Root config (`tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json`): 0 изменений.
  `docker-compose.yml` — изменён (+postgres, разрешено).

### Discipline

- **D-31** SUMMARY содержит evidence для каждого runtime-D (D-16..24). Главный D-22 —
  copy-paste restart sequence с timestamps. Без evidence = auto-FAIL.
- **D-32** Все процессы остановлены (api node + redis-cli + psql если запускались).
  `docker compose stop redis postgres`. PID + kill commands.
- **D-33** SUMMARY честно описывает: persist events only (не full DR), dual write, fallback.
  Никаких заявлений про "Decision Repository" или "ADR" (это Wave 8d+ отдельной фазой).

---

## 4. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-33 PASS (с evidence).
2. Prisma migration создана и применена.
3. Events persist'ятся в PostgreSQL через EventConsumer (dual write).
4. GET /events читает из БД.
5. **Persistence survives restart** (D-22 — главный).
6. Real-time UI (Phase 8c-2) не сломан.
7. In-memory buffer fallback работает (D-24).
8. Regression Phase 5/6/7/8/8b/8c-1/8c-2/8c-3 green.
9. Anti-conflict: только разрешённые файлы.

**Фаза НЕ выполнена, если:**
- Prisma migration упала (D-04/D-05 FAIL).
- Events не persist'ятся (D-20 FAIL).
- Persistence не переживает рестарт (D-22 FAIL) — главный критерий.
- Real-time UI сломан (D-23 FAIL).
- Buffer fallback не работает (D-24 FAIL).
- Кодер тронул что-то вне разрешённых зон (D-25..30 FAIL).
- SUMMARY без evidence (D-31 FAIL).

---

## 5. Порядок работы кодера

1. **Прочитать PLAN.** Особенно §0.3 dual write, §0.4 port 5433, §2.3 EventPersistenceService,
   §3 D-22 (главный — restart persistence).
2. **docker-compose.yml (§2.1):** +postgres service.
3. **Prisma schema (§2.2):** +DomainEventRecord model.
4. **Prisma migration (D-04, D-05):**
   - `docker compose up -d postgres`.
   - `DATABASE_URL=postgresql://orchestra:orchestra@localhost:5433/orchestra pnpm --filter @orchestra/api prisma migrate dev --name add_domain_events`.
   - Verify миграция создана и применена.
5. **EventPersistenceService (§2.3):** НОВЫЙ.
6. **EventConsumerService (§2.4):** +dual write.
7. **EventsController (§2.5):** +read из БД с fallback.
8. **EventsModule (§2.6):** +PrismaService, +EventPersistenceService.
9. **.env.example (§2.7):** +DATABASE_URL.
10. **Build (D-10, D-11):** typecheck + build.
11. **Runtime verifier (D-16..24) с УСИЛЕННЫМ evidence:**
    - D-16: docker compose up, PING Redis + psql connection test.
    - D-17: prisma migrate applied.
    - D-18: API start log.
    - D-19: GET /events empty.
    - D-20: trigger → GET /events → event из БД + psql verify row.
    - **D-22: ГЛАВНЫЙ — restart sequence (trigger → stop → start → GET /events event still there).**
    - D-23: pub/sub still works.
    - D-24: postgres down → fallback buffer.
    - Cleanup: PID + kill + `docker compose stop`.
12. **Regression (D-12..15):** 4 spec'а.
13. **Anti-conflict (D-25..30):** git diff.
14. **`8d-1-SUMMARY.md`** с evidence.

**Оценка:** ~1-1.5 дня (Prisma setup + service + verification с restart).

---

## 6. Design notes

1. **Dual write (buffer + persist), не persist-only.** Buffer = fast cache + fallback если БД-down.
   Persist = durability. Best of both. Если переключить на persist-only — при БД-down events
   теряются, нет fallback.
2. **Upsert для идемпотентности.** DomainEvent.id как PK. BullMQ retry не создаёт дублей.
3. **Payload Json (jsonb) — extensible.** Новые типы событий (D-8c-4: 8 типов добавить) не требуют
   schema migration — все event-specific fields в payload.
4. **createdAt vs occurredAt.** event.occurredAt = когда событие произошло (в GsdEngine).
   record.createdAt = когда записали в БД. Latency debugging.
5. **Port 5433, не 5432.** Избегает конфликта с `dmg-postgres` (твой проект DMG). Параллельно
   с портом 6380 для Redis (избегает `dmg-redis`).
6. **Postgres в docker-compose, не внешняя.** Для dev predictability. Можно переключить на
   external production Postgres через DATABASE_URL env.
7. **EventPersistenceService в EventsModule providers, не @Global.** Минимальное изменение.
   PrismaService дублируется (KgModule уже имеет). Не идеально, но не трогаем prisma.service.ts
   (изменение Phase 2 зоны). @Global refactor — отдельная задача.
8. **Не EventStore pattern (Event Sourcing).** Persist events для audit trail, не для state
   reconstruction. State reconstruction (replay) — Wave 8d+ после полного DR.
9. **fallback на buffer в EventsController.** Если БД-down — клиент получает stale events из
   buffer. Лучше чем 500. При восстановлении БД — автоматически переключается на primary.
10. **Не persist SessionStore.** InMemorySessionStore остаётся. Сессии теряются при рестарте,
    только events сохраняются. SessionStore persist — D-8d-1 отдельная фаза.

---

## 7. Долги, которые фаза ЗАКРЫВАЕТ

- **D-8c-3-1** Persist events в PostgreSQL — Phase 8d закрывает.
- **Косвенно D-F1** (Prisma persistence) — первый шаг к полном persistent layer.
- **Косвенно D-F3** (KG-запись артефактов) — events persist'ятся, foundation для linking.

## 8. Долги, которые фаза ОТКРЫВАЕТ

- **D-8d-1** SessionStore persistence (InMemory → Prisma) — Wave 8d+.
- **D-8d-2** Full Decision Repository (ADR/Decision/Spec versioined) — когда Consensus начнёт
  генерить decisions.
- **D-8d-3** Event replay UI (Engineering Time Machine) — events persisted, UI — Wave 8d+.
- **D-8d-4** KG-artifact linking — Wave 8d+.
- **D-8d-5** Event retention policy (TTL/cleanup) — сейчас растёт бесконечно.
- **D-8d-6** Event filtering по type/timeframe — сейчас только sessionId+limit.

---

## 9. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| Prisma migrate падает (connection, syntax) | средняя | prisma migrate dev показывает понятные errors. Кодер копирует в SUMMARY. Если падает — RCA перед continue. |
| Postgres не стартует в docker (port conflict) | низкая | Порт 5433 (не 5432) — избегает конфликта с dmg-postgres. Проверить `docker compose ps`. |
| Prisma generate не подхватывает новую model | низкая | После schema.prisma edit — `prisma generate` обязательно перед build. |
| Dual write создаёт inconsistency (buffer vs DB) | низкая | Buffer = cache (eventually consistent). DB = source of truth. GET /events читает DB primary. |
| Buffer fallback маскирует persist errors | средняя | persist error логируется (logger.error). Если все persists fail — buffer stale, но не падаем. |
| Event id conflict (два events с одним id) | исключено | GsdEngine генерит уникальные id (eventCounter). Upsert идемпотентен. |
| Postgres volume конфликтует с существующим | низкая | Новый volume `postgres-data` (уникальное имя). |
| Docker Desktop не запущен | средняя (8c-3 precedent) | D-16 проверяет. Если не запущен — попросить owner. |
| Process zombies после verification | средняя (8-03 precedent) | D-32 — формальный критерий. |
| Кодер снова сделает замену (buffer → persist) с нарушением | низкая (тренд позитивный) | D-31 evidence + лично техлид. |

---

## 10. Что получает Orchestra после Phase 8d

**Persistent event log.** Events переживают рестарт API. Audit trail долговременный.

1. **Engineering audit trail** — все DomainEvents сохранены в PostgreSQL. Можно анализировать
   историю сессии: когда начат round, когда сменилась phase, когда был override.
2. **Foundation для Event Replay** (Engineering Time Machine, Wave 8d+) — events persisted,
   можно reconstruct состояние на любой момент времени.
3. **Production-ready Event Bus** — events не теряются при рестарте. Persist + real-time +
   consumer — full stack.
4. **Dev-friendly** — `GET /events` всегда работает (из БД или buffer fallback). psql для ad-hoc
   queries: `SELECT * FROM "DomainEventRecord" WHERE type = 'PhaseChanged'`.

**Phase 8d = Orchestra Event Bus становится production-grade.** Audit trail persistent.

---

**Конец PLAN 8d-1.** Ждёт `/gsd-execute-phase 8d` (mimo) → `/gsd-validate-phase 8d`.
После PASS — README-CONTRACT-PHASE-8d-1.md → Wave 8d-1 (persist events) закрыта.
Wave 8d-2 (SessionStore persist) или Wave 8d-3 (full Decision Repository) — следующие.
