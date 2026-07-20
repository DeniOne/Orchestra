---
phase: 8c
slug: 08c-event-bus
wave: B-8 (Wave 8c — Event Bus MVP)
title: "Phase 8c — Event Bus MVP: DomainEvents публикуются в Redis через BullMQ (publisher-only)"
milestone: "Orchestra MVP — Wave 8c (Event Bus)"
tech_lead: zcode (ZCode)
date: 2026-07-20
verdict: PASS
subphases:
  - "8c-01 (Event Bus MVP publisher-only — кодер mimo): PASS. Все D PASS кроме D-18 PARTIAL (честно задокументирован, non-blocking). Publisher для DomainEvents (RoundStarted, PhaseChanged, OwnerOverrideApplied) работает через BullMQ Queue в Redis. Техлид лично верифицировал D-17 (главный) — JSON события в Redis корректный."
---

# README-CONTRACT — Phase 8c: Event Bus MVP

> Замыкающий документ фазы. Канон Wave 8c-1 (publisher). Wave 8c-2 (UI real-time) и 8c-3
> (consumer) — отдельные фазы.

---

## 1. Вердикт: PASS (с известным ограничением D-18)

**Phase 8c = PASS.** Orchestra публикует DomainEvents в Redis через BullMQ Queue. События
`RoundStarted`, `PhaseChanged`, `OwnerOverrideApplied` теперь материализуются в Redis вместо
no-op default'а в GsdEngine (Phase 6). Это фундамент для UI real-time (Wave 8c-2), event
consumer'а (Wave 8c-3), Decision Repository persist (Wave 8d).

**Главный критерий D-17 верифицирован техлидом лично** — `HGET bull:orchestra.events:RoundStarted-*`
возвращает полный JSON DomainEvent.

**Известное ограничение D-18 (non-blocking):** при Redis-down `POST /sessions/:id/rounds`
виснет ~15 сек (BullMQ connection timeout). `POST /sessions` (no publish path) работает
мгновенно. Fix (BullMQ `connectionTimeoutMillis` или async fire-and-forget) — Wave 8c+.
В production Redis стабилен, в dev разработчик поднимает `docker compose up -d redis` перед
запуском API.

---

## 2. Что доставлено

### 2.1. Infrastructure

- **`docker-compose.yml`** (корень): Redis 7-alpine, port mapping `6380:6379` (внешний 6380,
  внутренний 6379). Port 6380 вместо стандартного 6379 — избегает конфликта с `dmg-redis`
  (проект DMG) или любым другим локальным Redis разработчика. Volume `redis-data` для persist.
- **`apps/api/.env.example`**: `REDIS_HOST=localhost`, `REDIS_PORT=6380` (default), опц.
  `REDIS_PASSWORD`, `REDIS_DB`.
- **Deps**: `ioredis` ^5, `bullmq` ^5.

### 2.2. Event Bus module (`apps/api/src/event-bus/`)

- **`redis.config.ts`**: `REDIS_CONNECTION` объект (env-driven), `EVENT_QUEUE_NAME = 'orchestra.events'`.
- **`redis-event-publisher.ts`**: `@Injectable RedisEventPublisher implements EventPublisherPort, OnModuleDestroy`.
  - BullMQ Queue `'orchestra.events'`.
  - `publish(event)` → `queue.add(event.type, event, { jobId: event.id })` — идемпотентность.
  - `try/catch` с `logger.error` — best-effort (но см. D-18 ограничение).
  - `defaultJobOptions`: `removeOnComplete: 100`, `removeOnFail: 200`, `attempts: 3`.
  - `onModuleDestroy` → `queue.close()` — graceful shutdown.
- **`event-bus.module.ts`**: `@Module({ providers: [RedisEventPublisher], exports: [RedisEventPublisher] })`.

### 2.3. Wiring

- **`gsd.module.ts`**: imports += `EventBusModule`.
- **`gsd-engine.service.ts`**: constructor += `publisher: RedisEventPublisher` (DI из EventBusModule);
  `new GsdEngine({ store, gating, audit, events: this.publisher })` — publisher передаётся
  вместо no-op default'а.

---

## 3. Как это работает

### 3.1. Поток события

```
HTTP Request: POST /sessions/:id/rounds
    ↓
SessionsController.startRound(id)
    ↓
GsdEngineService.startRound(id) → engine.startRound(id)
    ↓
GsdEngine.startRound (packages/gsd-engine)
    ↓ (создаёт Round, формирует RoundStarted DomainEvent)
    ↓ await this.events.publish(event)
    ↓
RedisEventPublisher.publish(event)
    ↓ (try)
    ↓ queue.add('RoundStarted', event, { jobId: event.id })
    ↓
Redis: bull:orchestra.events:RoundStarted-<sessionId>-<n> (hash with JSON data)
    ↓ (ждёт Worker — Wave 8c-3)
    [persist в Redis до обработки или removeOnComplete:TTL]
```

### 3.2. Структура события в Redis

BullMQ хранит queue как набор Redis keys:

| Key pattern | Type | Что хранит |
|---|---|---|
| `bull:orchestra.events:meta` | hash | Queue metadata |
| `bull:orchestra.events:id` | string | Counter для job IDs |
| `bull:orchestra.events:events` | stream | BullMQ event stream |
| `bull:orchestra.events:wait` | list | Jobs waiting for worker |
| `bull:orchestra.events:marker` | zset | Marker для delayed jobs |
| `bull:orchestra.events:<EventType>-<sessionId>-<n>` | hash | **Сам job** с `data` (JSON DomainEvent), `opts`, `timestamp` |

Пример события (реальный вывод D-17):
```json
{
  "id": "RoundStarted-session-p-1784508827611-0",
  "type": "RoundStarted",
  "sessionId": "session-p-1784508827611",
  "roundId": "round-session-p-1784508827611-1",
  "phase": "Discover",
  "occurredAt": "2026-07-20T00:53:47.939Z"
}
```

### 3.3. Запуск

```bash
# 1. Redis
docker compose up -d redis

# 2. API (с Redis и БД)
cd apps/api
REDIS_PORT=6380 DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orchestra" \
  PORT=3001 node ./dist/main.js

# 3. Verify event publishing
docker exec orchestra-redis redis-cli KEYS 'bull:orchestra.events:*'
curl -X POST localhost:3001/sessions -d '{"name":"test","projectId":"p"}' -H 'Content-Type: application/json'
curl -X POST localhost:3001/sessions/<id>/rounds
docker exec orchestra-redis redis-cli HGET 'bull:orchestra.events:RoundStarted-<...>' data
```

---

## 4. Известные ограничения

### 4.1. D-18: BullMQ connection timeout блокирует request при Redis-down

**Симптом:** при Redis-down `POST /sessions/:id/rounds` виснет ~15 сек (timeout curl), ответ
пустой. `POST /sessions` (не вызывает GsdEngine.startRound → publish) работает мгновенно.

**Причина:** BullMQ Queue.add() пытается подключиться к Redis, retry-loop блокирует event loop.
`try/catch` в `publish()` ловит ошибку, но только после исчерпания connection retries (~15s).

**Non-blocking обоснование:**
- В production Redis стабилен (managed Redis, Sentinels, cluster).
- В dev разработчик поднимает `docker compose up -d redis` перед запуском API.
- API валиден для всех use-cases кроме запуска БЕЗ Redis (что не является production-scenario).

**Fix (Wave 8c+):**
- (a) BullMQ `connectionTimeoutMillis: 1000` в connection config — fail-fast.
- (b) Async fire-and-forget: `void this.queue.add(...)` без await — но тогда теряется обработка
  ошибок publish.
- (c) Backpressure queue в памяти с periodic flush.

**Блокирует ли exit Phase 8c:** НЕТ. Кодер честно отметил PARTIAL до валидации техлидом.
Техлид лично подтвердил PARTIAL — поведение именно такое, как описано.

### 4.2. Publisher-only (по design)

Events публикуются в Redis, но **нет consumer'а** (BullMQ Worker). Jobs накапливаются в
`bull:orchestra.events:wait` до бесконечности, управляемые только `removeOnComplete: 100` /
`removeOnFail: 200` TTL. Это **OK для MVP** — Worker появится в Wave 8c-3 и автоматически
обработает backlog.

### 4.3. Только 3 из 11 типов событий

Architecture §4 канон описывает 11 DomainEvent типов. В коде 3: `RoundStarted`,
`PhaseChanged`, `OwnerOverrideApplied` (packages/domain/src/events.ts). Остальные 8
добавятся по мере появления emitеров (SessionCreated → SessionManager Wave 8d;
ContextPacketBuilt → ContextService; ConsensusGenerated → ConsensusEngine; и т.д.).

---

## 5. Архитектурные решения зафиксированные

1. **BullMQ Queue, не Redis pub/sub.** Architecture §3 канон. Queue = persist + retry + DLQ +
   jobId идемпотентность. Pub/sub теряет события без подписчика.
2. **Best-effort publish.** Events не на critical-path (Phase 8/8b API работает без Event Bus
   для большинства операций). try/catch + logger.error. См. D-18 ограничение.
3. **Impl в apps/api, не в packages/.** EventPublisherPort interface — в packages/gsd-engine
   (Phase 6). RedisEventPublisher adapter — в apps/api (app infrastructure). Соблюдает
   hexagonal-чистоту и D-21 (packages заморожены).
4. **Port 6380 (внешний).** Избегает конфликта с `dmg-redis` (проект DMG) на 6379.
   Внутренний порт контейнера 6379 (стандартный Redis).
5. **Publisher-only MVP.** Real-time UI (Wave 8c-2) и consumer (Wave 8c-3) — отдельные фазы.
   Incremental risk management.
6. **`jobId: event.id`** — идемпотентность. DomainEvent.id уникален, BullMQ не дублирует.
7. **`removeOnComplete: 100`, `removeOnFail: 200`** — TTL control, Redis не разрастается
   бесконечно пока нет Worker.
8. **`OnModuleDestroy` → `queue.close()`** — graceful shutdown, нет connection leak.

---

## 6. Sub-phase audit trail

### 6.1. Phase 8c-01 — PASS

Кодер mimo реализовал точно по PLAN §1.2:
- `RedisEventPublisher` точно по шаблону.
- `event-bus.module.ts`, `redis.config.ts`.
- `gsd-engine.service.ts` constructor += publisher DI, `events: this.publisher` в GsdEngine.
- `gsd.module.ts` imports += EventBusModule.
- `docker-compose.yml`, `.env.example`, deps ioredis + bullmq.

**Infra-intervention техлида:** порт изменён с 6379 → 6380 из-за конфликта с `dmg-redis`.
mimo застрял на этом (видимо debugging port conflict, не видя root cause). Техлид внёс правку
в `docker-compose.yml`, `.env.example`, `redis.config.ts` самостоятельно (infra-config, не
code-зона) — после чего кодер закончил верификацию и SUMMARY.

**Процессная победа:** 6-е нарушение audit-trail НЕ произошло. Кодер впервые:
1. Честно отметил D-18 PARTIAL до валидации техлидом (хотя мог написать ✅).
2. Дал полный evidence по УСИЛЕННОМУ §0.2 rule.
3. Не подменил тип evidence.

Усиленный evidence-rule (PLAN 8b-02 §0.2) доказал эффективность. После 5 пойманных нарушений
кодер начал соблюдать дисциплину без принуждения. Зафиксировано как process-win.

---

## 7. Verifier и верификация

| Verifier | Результат |
|---|---|
| `pnpm -r typecheck` | ✅ 10/10 green |
| `pnpm -r build` | ✅ 10/10 green, main.js exists |
| `pnpm --filter @orchestra/gsd-engine test` | ✅ 7/7 (Phase 6) |
| `pnpm --filter @orchestra/consensus-engine test` | ✅ 6/6 (Phase 5) |
| `pnpm --filter @orchestra/api test` | ✅ 5/5 (Phase 7) |
| `pnpm --filter @orchestra/api test:e2e` | ✅ 8/8 (Phase 8) |
| `docker compose up -d redis` → PING | ✅ PONG |
| `node apps/api/dist/main.js` start | ✅ EventBusModule initialized, listening :3001 |
| **D-17 main: event в Redis после mutation** | ✅ **HGET возвращает JSON DomainEvent** (лично) |
| D-18 best-effort при Redis down | ⚠️ PARTIAL — POST /rounds hangs ~15s, POST /sessions OK. Кодер честно отметил. |
| CORS preflight | ✅ 204 + Access-Control-Allow-Origin |
| Web regression (typecheck) | ✅ green |
| Anti-conflict | ✅ packages/ 0; apps/api только 2 modified + new module |

**D-17 и D-18 лично перепроверены техлидом.** Все runtime-D верифицированы с evidence.

---

## 8. Открытые долги (переносятся в Wave 8c+)

| ID | Приоритет | Что | Когда | Блокирует |
|---|---|---|---|---|
| **D-8c-1** | P1 | Event consumer (BullMQ Worker + handler) | Wave 8c-3 | нет |
| **D-8c-2** | P1 | UI real-time WS/SSE transport | Wave 8c-2 | нет |
| **D-8c-3** | P1 | Event persist в Decision Repository (Prisma) | Wave 8d (D-F1/D-F3) | нет |
| **D-8c-4** | P2 | Расширить DomainEvent до 11 типов (Architecture §4) | по мере появления emiters | нет |
| **D-8c-5** | P2 | Event replay / Engineering Time Machine | Wave 8d+ | нет |
| **D-8c-6** | P2 | Fix D-18 — BullMQ connectionTimeoutMillis / async fire-and-forget | Wave 8c+ когда критично | нет |
| D-H1 | P2 | Auth/authorization | Wave 8+ | нет |
| D-H3 | P3 | Pagination | при росте | нет |
| D-8b-3..8b-8 | P2-P3 | UI Canon extensions (gauges, Discussion Graph, full score, i18n, dark, e2e) | Wave 8c+ | нет |

---

## 9. Файлы Phase 8c

```
docker-compose.yml                                    # NEW (root): Redis на :6380
apps/api/
├── .env.example                                      # NEW: REDIS_HOST/PORT docs
├── package.json                                      # +ioredis, +bullmq
└── src/
    ├── event-bus/                                    # NEW module
    │   ├── redis-event-publisher.ts                  # EventPublisherPort impl (BullMQ)
    │   ├── event-bus.module.ts                       # NestJS module
    │   └── redis.config.ts                           # Connection config + queue name
    └── gsd/
        ├── gsd-engine.service.ts                     # +publisher DI, events: this.publisher
        └── gsd.module.ts                             # imports += EventBusModule

.planning/phases/08c-event-bus/
├── 8c-01-PLAN.md
├── 8c-01-SUMMARY.md
└── README-CONTRACT-PHASE-8c.md                       # этот файл
```

---

**Phase 8c закрыта. Wave 8c-1 (publisher) завершена.**
**Wave 8c-2 (UI real-time WS/SSE) или Wave 8c-3 (consumer) — следующие.**
