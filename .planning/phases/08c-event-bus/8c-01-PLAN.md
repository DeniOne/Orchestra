---
phase: 8c
slug: 08c-event-bus
wave: B-8
title: "Event Bus MVP — Redis+BullMQ publisher для DomainEvents, инфраструктура для real-time (backend-only)"
milestone: "Orchestra MVP — Wave 8c (Event Bus)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-20
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build) + runtime-gate (live Redis subscribe → trigger mutation → event received с УСИЛЕННЫМ evidence-rule §0.2) + regression-gate (Phase 5/6/7/8/8b spec'и green)
baseline_before: "Phase 8b PASS (commit 152bf26): UI MVP работает, REST API + UI полностью функциональны. EventPublisherPort в gsd-engine существует (Phase 6), но default no-op { publish: async () => {} } — DomainEvents формируются GsdEngine (4 места: startRound, advancePhase×2, overrideGate) но никуда не публикуются. Architecture §3 требует Redis+BullMQ Event Bus как 'журнал всех действий как события'. Никакого Redis/BullMQ в проекте ещё нет."
depends_on:
  - "Phase 6 (GsdEngine.events.publish — 4 места в gsd-engine.ts)"
  - "Phase 8 (SessionsController — trigger mutations для верификации)"
  - "@orchestra/domain events.ts — DomainEvent union (RoundStarted, PhaseChanged, OwnerOverrideApplied)"
closes_debts:
  - "D-F2 Event Bus (P1) — частично. Publisher готов; consumer/replay/UI real-time — Wave 8c+ отдельными фазами."
  - "D-H2 WebSocket/SSE — косвенно. Publisher — фундамент; WS-transport — Wave 8c+."
opens_debts_expected:
  - "D-8c-1 Event consumer (subscribe + handler) — Wave 8c+. Сейчас publisher-only, события идут в Redis и забываются (Redis pub/sub без persist) либо в лог."
  - "D-8c-2 UI real-time (WS/SSE transport web↔api) — Wave 8c+ отдельная фаза."
  - "D-8c-3 Event persist в Decision Repository — Wave 8d (D-F1)."
  - "D-8c-4 Больше событий: SessionCreated, ContextPacketBuilt, AgentInvoked, ConsensusGenerated, DecisionAccepted, ADRCreated, TaskCreated/Completed, ConfidenceRecalculated (Architecture §4 — 11 типов, сейчас 3)."
---

# PLAN 8c-01 — Event Bus MVP (Redis+BullMQ publisher)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8c-01-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **EVIDENCE-RULE (УСИЛЕННЫЙ, PLAN 8b-02 §0.2 — доказал эффективность, повторяется):**
> для каждого runtime-D явно указано **тип evidence**:
> - **Server-D** (HTTP/Redis CLI): полная команда + полный вывод.
> - **Subscribe-D** (Redis SUBSCRIBE): `redis-cli SUBSCRIBE orchestra.events` → trigger mutation → copy-paste JSON-сообщения.
> - **Build-D**: copy-paste вывода команды + exit code.
> - **Docker-D**: `docker compose ps` + `docker compose logs` fragments.
> Без evidence = auto-FAIL D-критерия.

## 0. Контекст фазы

### 0.1. Что есть сейчас

**EventPublisherPort** в `packages/gsd-engine/src/types.ts` — interface с одним методом:
```typescript
export interface EventPublisherPort {
  publish(event: DomainEvent): Promise<void>;
}
```

**GsdEngine** (Phase 6) инстанцируется с **default no-op publisher**:
```typescript
this.events = options.events ?? { publish: async () => {} };
```

Но при этом **GsdEngine реально публикует события в 4 местах** — формирует `RoundStarted`,
`PhaseChanged`, `OwnerOverrideApplied` и вызывает `await this.events.publish(event)`. Сейчас
эти вызовы уходят в пустоту (no-op).

**GsdEngineService** (apps/api/src/gsd/gsd-engine.service.ts:24) инстанцирует GsdEngine:
```typescript
this.engine = new GsdEngine({ store: this.store, gating, audit: this.audit });
// ← events: НЕ ПЕРЕДАЁТСЯ → default no-op
```

**3 типа DomainEvent** в `packages/domain/src/events.ts` (RoundStarted, PhaseChanged,
OwnerOverrideApplied). Architecture §4 канон описывает **11 типов** — остальные 8 добавятся в
Wave 8c+ по мере появления emitеров (ContextPacketBuilt → когда ContextService начнёт
публиковать; ConsensusGenerated → когда ConsensusEngine; и т.д.).

### 0.2. Что делает Phase 8c (scope — owner-decision 2026-07-20)

**Event Bus MVP — publisher only, backend-only.**

- ✅ Redis поднимается через **docker-compose.yml** в корне.
- ✅ `ioredis` + `bullmq` deps в apps/api.
- ✅ `RedisEventPublisher` implements `EventPublisherPort` — публикует DomainEvents в Redis
  через BullMQ Queue (или pub/sub, см. §1.3).
- ✅ GsdEngineService получает RedisEventPublisher через DI вместо no-op.
- ✅ Live verification: `redis-cli SUBSCRIBE orchestra.events` → trigger mutation (POST
  /sessions/:id/rounds) → наблюдаем RoundStarted event в subscriber'е.

**НЕ в scope (забор на Wave 8c+):**
- **UI real-time** (WebSocket/SSE transport web↔api) — Wave 8c-2.
- **Event consumer / handler** в backend (subscribe + business-logic на события) — Wave 8c-3.
- **Event persist в Decision Repository** (Prisma) — Wave 8d (D-F1/D-F3).
- **Event replay / Engineering Time Machine** — Wave 8d+.
- **Расширение DomainEvent** до 11 типов — по мере появления emitеров.
- **Retry/DLQ в BullMQ** — Wave 8c+ когда появятся consumers.

### 0.3. Зачем publisher-only, а не полный стек real-time

1. **Incremental risk management.** Event Bus — новая инфраструктура (Redis, BullMQ). Проще
   ввести publisher одним small шагом, проверить что события реально доходят до Redis, и
   только потом навешивать consumer + UI real-time. Если полный стек за раз — сложно дебажить
   где что сломалось (publisher? Redis connection? consumer? WS transport? UI handler?).
2. **Фундамент для всех будущих real-time фич.** Без publisher'а ничего не работает. С ним —
   UI real-time, Continuous Consensus display (UI Canon §3), Decision Repository persist —
   всё становится возможным как отдельные фазы, использующие готовый publisher.
3. **Easy to verify.** `redis-cli SUBSCRIBE` — объективный verifier, без UI/WS сложности.
4. **Минимальные изменения существующего кода.** Только GsdEngineService constructor.

### 0.4. Архитектурное решение: BullMQ Queue vs Redis pub/sub

**Два варианта транспорта:**

**Вариант A — BullMQ Queue (Рекомендуется):** events идут в named queue `orchestra.events`.
Producer: `queue.add(event)`. Consumer (Wave 8c+): `new Worker(queue, handler)` —
automatic retry, persistence в Redis, DLQ, concurrency control. **Architecture §3 явно
говорит «Redis + BullMQ».** Соответствует канону.

**Вариант B — Redis pub/sub:** `redis.publish('orchestra.events', JSON.stringify(event))`.
Subscriber: `redis.subscribe(...)`. Проще, но **нет persist/retry/DLQ** — события теряются
если нет активного подписчика.

**Техлид рекомендует Вариант A (BullMQ Queue)** — он в Architecture.md, обеспечивает persist
(важно для audit trail и Engineering Time Machine Wave 8d), retry/DLQ для надёжности. Pub/sub
не даёт этих гарантий.

> **Кодер:** BullMQ Queue — это **persisted** events. `queue.add()` хранит event в Redis до
> тех пор, пока какой-то Worker не обработает (или не истечёт TTL). Для Phase 8c Worker'а нет
> (consumer — Wave 8c+) → events будут накапливаться в Redis. Это OK для MVP. Когда worker
> появится — автоматически обработает backlog. Если накопление беспокоит — можно добавить
> TTL на job (см. §1.2 `removeOnComplete`).

### 0.5. Что НЕ в scope (подтверждение)

- `packages/**` — НЕ ТРОГАТЬ. EventPublisherPort interface уже есть (Phase 6), расширять не
  нужно. RedisEventPublisher — это **impl в apps/api**, не в пакете.
- `apps/web/**` — UI не трогаем (real-time → Wave 8c-2).
- `apps/api/src/{sessions,kg,context,roles,consensus,providers,prompts}/**` — бизнес-логика
  не трогаем. Только GsdEngineService constructor меняется (+ DI wiring).
- `apps/api/src/gsd/{gsd-engine,round-orchestrator-gating.adapter,objective-seed.service}.ts` —
  Phase 6/7 код, не трогать.
- Prisma schema, role-manifests, prompts, docs — не трогать.

---

## 1. Архитектурное решение (главное)

### 1.1. Структура

```
docker-compose.yml                                    # НОВЫЙ (корень): Redis
apps/api/
├── package.json                                      # ИЗМЕНИТЬ: +ioredis, +bullmq
├── src/
│   ├── event-bus/                                    # НОВЫЙ модуль
│   │   ├── redis-event-publisher.ts                  # НОВЫЙ: EventPublisherPort impl
│   │   ├── event-bus.module.ts                       # НОВЫЙ: NestJS module
│   │   └── redis.config.ts                           # НОВЫЙ: Redis connection config
│   ├── gsd/gsd-engine.service.ts                     # ИЗМЕНИТЬ: +EventPublisherPort DI
│   └── gsd/gsd.module.ts                             # ИЗМЕНИТЬ: imports += EventBusModule
└── .env.example                                      # НОВЫЙ: REDIS_URL документация
```

### 1.2. RedisEventPublisher

`apps/api/src/event-bus/redis-event-publisher.ts`:

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { EventPublisherPort } from '@orchestra/gsd-engine';
import type { DomainEvent } from '@orchestra/domain';
import { getLogger } from '../logger.js';  // если есть, иначе new Logger

/**
 * Redis-backed impl of EventPublisherPort.
 *
 * Публикует DomainEvents в BullMQ queue 'orchestra.events'. Events persist в Redis до
 * обработки Worker'ом (Wave 8c+) или истечения TTL. Соответствует Architecture §3:
 * «Event Bus = Redis + BullMQ».
 *
 * Phase 8c: publisher-only. Consumer/Worker — отдельная фаза (Wave 8c-3). UI real-time —
 * Wave 8c-2 (WS/SSE transport).
 *
 * Если Redis недоступен при publish — логирует ERROR и не падает (events — best-effort для
 * MVP, не critical-path). Продутивность Phase 8 API (startSession/rounds/advance) не зависит
 * от Event Bus.
 */
@Injectable()
export class RedisEventPublisher implements EventPublisherPort, OnModuleDestroy {
  private readonly queue: Queue<DomainEvent>;
  private readonly logger = new Logger(RedisEventPublisher.name);

  constructor() {
    const connection = {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    };
    this.queue = new Queue<DomainEvent>('orchestra.events', {
      connection,
      defaultJobOptions: {
        removeOnComplete: 100,   // хранить последние 100 выполненных (для дебага)
        removeOnFail: 200,       // хранить последние 200 failed (для анализа)
        attempts: 3,             // 3 попытки (когда Worker появится)
      },
    });
  }

  async publish(event: DomainEvent): Promise<void> {
    try {
      await this.queue.add(event.type, event, { jobId: event.id });
      this.logger.debug(`Published event: ${event.type} (${event.id}) session=${event.sessionId}`);
    } catch (e) {
      // Best-effort: не валим request из-за Event Bus сбоя.
      this.logger.error(`Failed to publish event ${event.type}: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
```

**Ключевые моменты:**
- `implements EventPublisherPort` — подмена no-op default'а.
- `OnModuleDestroy` — корректно закрыть connection при graceful shutdown.
- **Best-effort publish** — если Redis упал, request не падает (Events не на critical-path).
  Это **важное решение**: Phase 8 API должен работать даже если Event Bus временно недоступен.
  `try/catch` с `logger.error` — позволяем API продолжать.
- `jobId: event.id` — идемпотентность (если тот же event публикуется дважды, BullMQ не
  дублирует).
- `removeOnComplete: 100`, `removeOnFail: 200` — TTL control, Redis не разрастается бесконечно.

### 1.3. Redis config + connection

`apps/api/src/event-bus/redis.config.ts`:

```typescript
export const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? undefined,
  db: Number(process.env.REDIS_DB ?? 0),
};

export const EVENT_QUEUE_NAME = 'orchestra.events';
```

> Кодер: вынести в отдельный файл — позволяет переиспользовать в future consumer (Wave 8c+)
> без дублирования.

### 1.4. EventBusModule (NestJS wiring)

`apps/api/src/event-bus/event-bus.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { RedisEventPublisher } from './redis-event-publisher.js';

@Module({
  providers: [RedisEventPublisher],
  exports: [RedisEventPublisher],
})
export class EventBusModule {}
```

### 1.5. GsdModule wiring

`apps/api/src/gsd/gsd.module.ts` — добавить import + DI-token:

```typescript
import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { ContextModule } from '../context/context.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { EventBusModule } from '../event-bus/event-bus.module.js';
import { RedisEventPublisher } from '../event-bus/redis-event-publisher.js';
import { GsdEngineService } from './gsd-engine.service.js';
import { ObjectiveSeedService } from './objective-seed.service.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule, EventBusModule],
  // RoundOrchestratorGatingAdapter убран из providers: ... (существующий comment)
  providers: [GsdEngineService, ObjectiveSeedService],
  exports: [GsdEngineService],
})
export class GsdModule {}
```

> EventBusModule экспортирует RedisEventPublisher. GsdEngineService инжектит его (см. §1.6).

### 1.6. GsdEngineService — DI для publisher

`apps/api/src/gsd/gsd-engine.service.ts` — добавить publisher в constructor:

```typescript
import { RedisEventPublisher } from '../event-bus/redis-event-publisher.js';
// ...

@Injectable()
export class GsdEngineService {
  // ... существующие поля
  private readonly engine: GsdEngine;
  private readonly knownSessionIds = new Set<SessionId>();

  constructor(
    private readonly context: ContextService,
    private readonly router: RoleRouterService,
    private readonly consensus: ConsensusService,
    private readonly roles: ManifestLoaderAdapter,
    private readonly publisher: RedisEventPublisher,  // ← НОВОЕ
  ) {
    const gating = new RoundOrchestratorGatingAdapter(context, router, consensus, roles, this.store);
    this.engine = new GsdEngine({
      store: this.store,
      gating,
      audit: this.audit,
      events: this.publisher,  // ← НОВОЕ: передаём Redis impl вместо no-op default
    });
  }
  // ... остальное без изменений
}
```

**Важно:** `events: this.publisher` — теперь GsdEngine будет вызывать
`this.events.publish(event)` → `RedisEventPublisher.publish()` → BullMQ queue.

### 1.7. docker-compose.yml

`docker-compose.yml` в корне проекта:

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: orchestra-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
    # Опционально:_command: redis-server --appendonly yes  # persist на диск

volumes:
  redis-data:
```

> Postgres сюда **НЕ добавляем** (D-F1 — Wave 8d). Только Redis для Event Bus.
> `restart: unless-stopped` — переживёт reboot dev-машины.

### 1.8. .env.example

`apps/api/.env.example`:

```bash
# Orchestra API env vars (см. README-CONTRACT-PHASE-8 §3 для DATABASE_URL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orchestra"

# Event Bus (Wave 8c)
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=
# REDIS_DB=0

# API
PORT=3001
```

---

## 2. must_haves.truths (D-критерии)

### Infrastructure

- **D-01** `docker-compose.yml` в корне проекта. Содержит сервис `redis` (image `redis:7-alpine`),
  port 6379, volume `redis-data`. `docker compose up -d` поднимает Redis.
- **D-02** `apps/api/.env.example` документирует `REDIS_HOST`, `REDIS_PORT` (опц. `REDIS_PASSWORD`,
  `REDIS_DB`).
- **D-03** `apps/api/package.json` deps: `ioredis` (^5), `bullmq` (^5). `pnpm install` green.

### Event Bus module

- **D-04** `apps/api/src/event-bus/redis-event-publisher.ts` существует:
  - `@Injectable() class RedisEventPublisher implements EventPublisherPort, OnModuleDestroy`.
  - `publish(event)` добавляет event в BullMQ Queue 'orchestra.events' с `jobId: event.id`.
  - `try/catch` с `logger.error` — best-effort (не падает при Redis failure).
  - `onModuleDestroy` закрывает queue.
- **D-05** `apps/api/src/event-bus/event-bus.module.ts`:
  - `@Module({ providers: [RedisEventPublisher], exports: [RedisEventPublisher] })`.
- **D-06** `apps/api/src/event-bus/redis.config.ts`:
  - `REDIS_CONNECTION` объект + `EVENT_QUEUE_NAME = 'orchestra.events'`.

### Wiring

- **D-07** `apps/api/src/gsd/gsd.module.ts`:
  - `imports` включает `EventBusModule`.
  - Остальные imports/providers/exports не изменены (кроме добавления EventBusModule).
- **D-08** `apps/api/src/gsd/gsd-engine.service.ts`:
  - Constructor принимает `publisher: RedisEventPublisher` (через DI, NestJS резолвит из EventBusModule).
  - `new GsdEngine({...events: this.publisher})` — publisher передаётся в GsdEngine.
  - Существующие методы (`startSession`, `startRound`, `advancePhase`, `approveTransition`,
    `overrideGate`, `getSession`, `listRounds`, `listSessions`) — не изменены по сигнатуре.

### Build

- **D-09** `pnpm -r typecheck` → 10 пакетов green.
- **D-10** `pnpm -r build` → green. `apps/api/dist/main.js` существует.

### Regression

- **D-11** `pnpm --filter @orchestra/gsd-engine test` → green (7/7, Phase 6).
- **D-12** `pnpm --filter @orchestra/consensus-engine test` → green (6/6, Phase 5).
- **D-13** `pnpm --filter @orchestra/api test` → green (5/5, Phase 7).
- **D-14** `pnpm --filter @orchestra/api test:e2e` → green (8/8, Phase 8).

### Runtime (УСИЛЕННЫЙ evidence-rule, §0 преамбула)

- **D-15** `docker compose up -d redis` → Redis контейнер поднимается, listening на :6379.
  Evidence: `docker compose ps` + `docker compose exec redis redis-cli PING` → `PONG`.
- **D-16** `node apps/api/dist/main.js` стартует, в логе нет ошибок подключения к Redis
  (BullMQ Queue создаётся, connection OK).
  Evidence: copy-paste лога + grep `RedisEventPublisher` + grep `no error`.
- **D-17** **Главный тест — event published в Redis:**
  1. В одном терминале: `docker compose exec redis redis-cli SUBSCRIBE orchestra.events`
     (или `PSUBSCRIBE bull:orchestra.events:*` если BullMQ использует keyspace notifications).
     > Кодер: BullMQ хранит events как Redis keys, не как pub/sub messages. Для верификации
     > используй `redis-cli KEYS 'bull:orchestra.events:*'` до/после mutation.
  2. В другом терминале: trigger mutation:
     ```
     curl -X POST localhost:3001/sessions -d '{"name":"ebus-test","projectId":"p"}' -H 'Content-Type: application/json'
     curl -X POST localhost:3001/sessions/<id>/rounds
     ```
  3. **Evidence:** до mutation `KEYS 'bull:orchestra.events:*'` → пусто; после mutation →
     появились keys, в них JSON с `type: 'RoundStarted'`, `sessionId`, `roundId`.

  **Альтернативный verifier:** запустить временный BullMQ Worker в debug-режиме, который
  console.log'ает каждый event (но это требует доп. кода). Техлид рекомендует `KEYS` подход.

- **D-18** Best-effort: временно остановить Redis (`docker compose stop redis`), trigger
  mutation (`POST /sessions/:id/rounds`) → API возвращает 201 (не падает!), в логе
  `Failed to publish event RoundStarted: <connection error>`. Restart Redis → publish
  восстанавливается.
  Evidence: copy-paste лога ошибки + copy-paste 201 response + copy-paste лога после restart.
- **D-19** CORS остаётся рабочим (не сломали Phase 8): OPTIONS /sessions → 204,
  `Access-Control-Allow-Origin: http://localhost:3000`.
  Evidence: curl + headers.
- **D-20** Web UI (Phase 8b) не сломан: `pnpm --filter @orchestra/web build` → green,
  `pnpm --filter @orchestra/web dev` → Ready, `curl localhost:3000/` → 200, HTML содержит
  `<h1>Orchestra</h1>`.
  Evidence: copy-paste build output + curl + HTML-grep.

### Anti-conflict

- **D-21** `packages/**` (всё): 0 изменений. `git diff packages/` → пусто.
- **D-22** `apps/api/src/`: изменения ТОЛЬКО в:
  - `gsd/gsd-engine.service.ts` (constructor + DI publisher),
  - `gsd/gsd.module.ts` (imports += EventBusModule),
  - `event-bus/*` (новые файлы).
  Другие файлы apps/api/src/ — 0 diff.
- **D-23** `apps/api/src/{sessions,kg,context,roles,consensus,providers,prompts}/**`, `apps/api/src/{prisma.service,app.module,main}.ts`:
  0 изменений.
- **D-24** `apps/api/{tsconfig.json,nest-cli.json,prisma/,test/}`: 0 изменений.
  `apps/api/package.json`: только deps `+ioredis, +bullmq`.
- **D-25** `apps/web/**`: 0 изменений (UI real-time — Wave 8c-2).
- **D-26** `docs/`, `role-manifests/`, `prompts/`: 0 изменений.
- **D-27** `.planning/phases/08-http-api-gateway/`, `.planning/phases/08b-conducting-score-ui/`:
  0 изменений.
- **D-28** Root config (`tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json`):
  0 изменений. `docker-compose.yml` — НОВЫЙ файл (разрешён).

### Discipline

- **D-29** SUMMARY содержит для каждого runtime-D (D-15..20) точный evidence:
  - D-15: docker compose ps + redis-cli PING.
  - D-16: copy-paste лога API.
  - D-17: до/после `KEYS 'bull:orchestra.events:*'` + JSON event.
  - D-18: лог ошибки + 201 response + лог после restart.
  - D-19: curl + headers.
  - D-20: build output + curl + HTML-grep.
  Без evidence = auto-FAIL.
- **D-30** Все процессы остановлены (api node + redis subscriber + redis container если поднимался
  вручную). `docker compose down` (или `stop`) в конце. Порты 3001/6379 свободны.
  Evidence: PID + команды + `docker compose ps` → empty.
- **D-31** SUMMARY прямо описывает: publisher-only scope (Wave 8c-1), что EventPublisherPort
  impl подменяет no-op default, best-effort semantics. Никаких заявлений про «real-time UI»
  (это Wave 8c-2, не сделано).

---

## 3. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-31 PASS (с evidence для runtime-D).
2. `docker compose up -d` поднимает Redis.
3. API публикует DomainEvents в Redis через BullMQ Queue.
4. `redis-cli KEYS 'bull:orchestra.events:*'` показывает events после mutations.
5. Best-effort работает: Redis down → API продолжает, логирует ошибку.
6. Regression Phase 5/6/7/8/8b green.
7. Anti-conflict: только новые файлы event-bus/, gsd-engine.service.ts constructor, gsd.module.ts
   imports, apps/api/package.json deps, docker-compose.yml (новый).

**Фаза НЕ выполнена, если:**
- Redis не поднимается через docker compose (D-01/D-15 FAIL).
- Events не публикуются в Redis (D-17 FAIL).
- API падает при Redis down (D-18 FAIL) — best-effort не работает.
- Кодер тронул что-то вне разрешённых зон (D-21..28 FAIL).
- SUMMARY без evidence (D-29 FAIL).

---

## 4. Порядок работы кодера

1. **Прочитать PLAN.** §0.2 scope (publisher only), §0.4 BullMQ vs pub/sub, §1 архитектура,
   §2 D-критерии (особенно D-17 main test).
2. **docker-compose.yml** (§1.7) в корне. `docker compose up -d redis` → verify PING.
3. **Deps (D-03):** `pnpm --filter @orchestra/api add ioredis bullmq`.
4. **Event Bus module:**
   - `redis.config.ts` (§1.3).
   - `redis-event-publisher.ts` (§1.2) — точно по шаблону, включая best-effort try/catch.
   - `event-bus.module.ts` (§1.4).
5. **Wiring:**
   - `gsd.module.ts`: imports += EventBusModule (§1.5).
   - `gsd-engine.service.ts`: constructor += publisher, GsdEngine options += events (§1.6).
6. **`.env.example`** (§1.8) в apps/api.
7. **Build (D-09, D-10):** `pnpm -r typecheck && build`.
8. **Runtime verifier (D-15..20) с evidence:**
   - `docker compose up -d redis`.
   - Start API: `node apps/api/dist/main.js`.
   - D-15: `docker compose ps` + `redis-cli PING`.
   - D-16: copy-paste API лога.
   - D-17: `redis-cli KEYS 'bull:orchestra.events:*'` → mutation → `KEYS` снова → JSON event.
   - D-18: `docker compose stop redis` → mutation → 201 + error log → `docker compose start redis`.
   - D-19: CORS curl.
   - D-20: web build + curl.
   - Записать PID/контейнеры, остановить в конце.
9. **Regression (D-11..14):** 4 spec'а green.
10. **Anti-conflict (D-21..28):** git diff по защищённым зонам.
11. **Написать `8c-01-SUMMARY.md`** с evidence для каждого runtime-D + описание publisher-only scope.

**Оценка:** ~4-6 часов (deps + 3 файла модуля + wiring + verification + Redis debugging).

---

## 5. Design notes

1. **Publisher-only MVP — risk management.** Полный real-time стек (publisher + consumer + WS + UI)
   — слишком много новых слоёв за раз. Publisher отдельно проверить через `redis-cli KEYS`
   объективно; consumer добавить когда publisher стабилен.

2. **BullMQ Queue, не pub/sub.** Architecture §3 явно: «Redis + BullMQ». Queue даёт persist
   (важно для Decision Repository Wave 8d), retry/DLQ для надёжности. Pub/sub события теряются
   при отсутствии подписчика. `removeOnComplete: 100` / `removeOnFail: 200` контролируют рост Redis.

3. **Best-effort publish — важное архитектурное решение.** Events **не на critical-path**: API
   Phase 8/8b (create session, advance, list) должен работать даже если Redis упал. Try/catch +
   logger.error — позволяем продолжать. Когда появится consumer (Wave 8c-3), его failure handling
   тоже должен быть best-effort. **Не делаем Event Bus блокирующим для API.**

4. **`jobId: event.id` — идемпотентность.** DomainEvent.id уникален (GsdEngine генерирует через
   `eventCounter`). BullMQ с `jobId` — если тот же event публикуется дважды (retry, replay), не
   дублирует.

5. **`OnModuleDestroy` — graceful shutdown.** BullMQ Queue держит Redis connection. При API
   shutdown (Ctrl+C, SIGTERM) — закрываем. Иначе connection leak.

6. **Не в packages/, а в apps/api.** EventPublisherPort interface — в packages/gsd-engine (Phase 6).
   RedisEventPublisher impl — в apps/api (это app infrastructure, не domain logic). Соответствует
   hexagonal: domain определяет port, app предоставляет adapter.

7. **DI через NestJS, не manual `new`.** GsdModule imports EventBusModule → GsdEngineService
   constructor принимает RedisEventPublisher → NestJS резолвит через DI. Тестирование: можно
   подменить mock-publisher в тестах (через NestJS TestingModule.overrideProvider).

8. **UI real-time — Wave 8c-2.** События публикуются, но UI пока обновляется через TanStack
   Query manual refresh (Phase 8b). WS/SSE transport + useEventSubscription hook — отдельная
   фаза. После неё Conducting Score сможет real-time обновлять PhaseBadge без refetch.

9. **Не расширяем DomainEvent.** В коде 3 типа (RoundStarted, PhaseChanged, OwnerOverrideApplied).
   Architecture §4 описывает 11. Остальные 8 добавятся по мере появления emitеров: SessionCreated
   → когда SessionManager (Wave 8d); ContextPacketBuilt → ContextService; ConsensusGenerated →
   ConsensusEngine; и т.д. В Phase 8c — publisher для **существующих** 3 типов, не больше.

10. **Техлид верифицирует D-17 лично.** После 5 нарушений audit-trail (8-02 ×2, 8-03, 8b-01 +
    усиление в 8b-02 сработало) — тенденция позитивная, но для infrastructure-D с Redis debugging
    лучше перепроверить. D-17 — главный критерий Phase 8c, его подделать сложнее всего (нужен
    реальный Redis key с реальным DomainEvent JSON).

---

## 6. Долги, которые фаза ЗАКРЫВАЕТ

- **D-F2** Event Bus — **частично**. Publisher готов. Consumer/real-time — Wave 8c+.
- **Косвенно D-H2** WebSocket/SSE — publisher = фундамент. Transport = Wave 8c-2.

## 7. Долги, которые фаза ОТКРЫВАЕТ

- **D-8c-1** Event consumer (BullMQ Worker + handler) — Wave 8c-3.
- **D-8c-2** UI real-time WS/SSE — Wave 8c-2.
- **D-8c-3** Event persist в Decision Repository (Prisma) — Wave 8d (D-F1/D-F3).
- **D-8c-4** Расширить DomainEvent до 11 типов (Architecture §4) — по мере появления emiters.
- **D-8c-5** Event replay / Engineering Time Machine — Wave 8d+.

### Перенесённые долги (без изменений)

- D-H1 Auth — Wave 8+.
- D-H3 Pagination — при росте данных.
- D-8b-3..8b-8 UI Canon extensions (gauges, Discussion Graph, full score, i18n, dark mode) — Wave 8c+.
- D-8b-8 e2e через TestingModule+supertest — когда рантайм стабилен.

---

## 8. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| Docker не доступен на машине разработчика | низкая (есть, проверено) | docker-compose.yml portable; если нет — instructions в README |
| BullMQ connection не закрывается на shutdown → process hangs | средняя | `OnModuleDestroy` + `queue.close()`. Проверить что `docker compose down` после работы не висит |
| BullMQ Queue накапливает events без Worker → Redis растёт | средняя (MVP) | `removeOnComplete: 100`, `removeOnFail: 200` — TTL control. Когда Worker появится (Wave 8c-3) — автоматически обработает backlog |
| Best-effort try/catch маскирует реальные ошибки publish | низкая | `logger.error` с полным сообщением + stack. Можно позже добавить retry counter / alerting (Wave 8c+) |
| Кодер вместо BullMQ Queue сделает pub/sub (Вариант B) | средняя | §0.4 явно рекомендует A, но оставляет выбор. Если выбрал B — отметить в SUMMARY, что D-8c-3 persist будет сложнее |
| Кодер тронет packages/ чтобы «добавить события» | средняя | D-21 anti-conflict; §0.5 явно запрещает. DomainEvent extension — отдельная фаза |
| Process zombies после verification | средняя (8-03 precedent) | D-30 — формальный критерий + `docker compose down` |
| Кодер снова не даст evidence | низкая (после 8b-02 успеха) | Усиленный §0.2 + D-29 формальный + D-17 техлид-верификация |

---

## 9. Что получает Orchestra после Phase 8c

**Backend Event Bus MVP.** DomainEvents (RoundStarted, PhaseChanged, OwnerOverrideApplied)
попадают в Redis через BullMQ Queue. Events persist, готовы к обработке future consumer'ом
(Wave 8c-3) и UI real-time transport (Wave 8c-2).

**Фундамент для:**
1. **Real-time Conducting Score UI** (Wave 8c-2) — UI обновляется без refetch при событиях.
2. **Decision Repository audit trail** (Wave 8d) — events persist в PostgreSQL как engineering log.
3. **Continuous Consensus display** (UI Canon §3) — `ConfidenceRecalculated` события.
4. **Engineering Time Machine** (Wave 8d+) — replay событий для воспроизведения истории.
5. **Background processing** — когда Worker появится, события обрабатываются async (например,
   уведомления, метрики, ML-анализ).

**Phase 8c = Orchestra начинает "слышать сама себя".** Каждое значимое действие теперь оставляет
событийный след, готовый к потреблению.

---

**Конец PLAN 8c-01.** Ждёт `/gsd-execute-phase 8c` (mimo) → `/gsd-validate-phase 8c`.
После PASS — README-CONTRACT-PHASE-8c.md → Wave 8c-1 (publisher) закрыта → Wave 8c-2 (UI real-time) или 8c-3 (consumer) открыты.
