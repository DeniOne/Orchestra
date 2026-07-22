---
phase: 8d
slug: 08d-decision-repository
wave: B-8 (Wave 8d-1 — Persist DomainEvents в PostgreSQL)
title: "Phase 8d-1 — Decision Repository MVP: events persisted в PostgreSQL, audit trail переживает рестарт API"
milestone: "Orchestra MVP — Wave 8d (Decision Repository persist)"
tech_lead: zcode (ZCode)
date: 2026-07-22
verdict: PASS
executor: mimo (код) + zcode (self-execute verification, owner-санкция — mimo системно зависал на PowerShell runtime-тестах)
subphases:
  - "8d-1 (Persist events в PostgreSQL — кодер mimo + self-execute техлида): PASS. mimo написал весь код (8 файлов), завис перед runtime-verification. Owner-санкция «доделай сам» → техлид выполнил formal validation, главный D-22 лично верифицирован (restart persistence работает)."
---

# README-CONTRACT — Phase 8d-1: Decision Repository MVP (persist events)

> Замыкающий документ. Wave 8c (Event Bus: publisher + transport + consumer) — закрыта.
> Wave 8d-1 = persist events в PostgreSQL, audit trail долговременный.

---

## 1. Вердикт: PASS

**Phase 8d-1 = PASS.** DomainEvents persist'ятся в PostgreSQL через Prisma. Audit trail
переживает рестарт API. `GET /events` читает из БД (primary) с fallback на in-memory buffer.

**Главный критерий D-22 лично верифицирован техлидом:**
```
Instance 1: POST /rounds → event persisted (DB row exists, GET /events total:1)
STOP API instance 1
Instance 2: restart → GET /events → total:1, RoundStarted event still there ✅
```

---

## 2. Что доставлено

### 2.1. Infrastructure

- **`docker-compose.yml`** + `postgres` service (postgres:16-alpine, port **5433:5432** —
  избегает конфликта с `dmg-postgres` на :5432). Volume `postgres-data`.
- **`apps/api/.env.example`** + `DATABASE_URL="postgresql://orchestra:orchestra@localhost:5433/orchestra"`.

### 2.2. Prisma

- **`schema.prisma`** + `model DomainEventRecord`:
  - `id String @id` (без @default — используем DomainEvent.id для идемпотентности).
  - `type String`, `sessionId String`, `occurredAt DateTime`, `payload Json` (full event JSON).
  - `createdAt DateTime @default(now())` (latency debugging: event.occurredAt vs record.createdAt).
  - Indexы: `sessionId`, `type`, `occurredAt`.
- **`migrations/20260721160318_add_domain_events/migration.sql`** — автогенерация prisma migrate.
  Создаёт `DomainEventRecord` table + 3 indexа.

### 2.3. Event Persistence Service

- **`event-persistence.service.ts`** (НОВЫЙ) — `@Injectable EventPersistenceService`:
  - `persist(event)` — `prisma.domainEventRecord.upsert` (идемпотентность через PK = event.id).
  - `list({sessionId?, limit?})` — `findMany` orderBy `occurredAt desc`, returns `{events, total}`.
  - Best-effort: try/catch с logger.error, не падает при БД-down.

### 2.4. EventConsumer (dual write)

- **`event-consumer.service.ts`** — constructor += `EventPersistenceService`.
  Handler теперь: `buffer.append` + `persistence.persist` (**dual write**).
- Buffer остаётся как fast cache + fallback. Persist = durability.

### 2.5. EventsController (read из БД + fallback)

- **`events.controller.ts`** — constructor += `EventPersistenceService`.
  `list()`: primary `persistence.list()` (из PostgreSQL), fallback `buffer.list()` при catch.
- БД-down → клиент получает stale events из buffer (лучше чем 500).

### 2.6. EventsModule wiring

- **`events.module.ts`** — providers += `PrismaService`, `EventPersistenceService`.

---

## 3. Architecture decisions

1. **Dual write (buffer + persist), не persist-only.** Buffer = fast cache + fallback при БД-down.
   Persist = durability. Best of both. Если переключить на persist-only — при БД-down events
   теряются.
2. **Upsert идемпотентность.** DomainEvent.id как PK. BullMQ retry не создаёт дублей.
3. **Payload Json (jsonb) — extensible.** Новые типы событий (8 типов добавить из Architecture §4)
   не требуют schema migration — все event-specific fields в payload.
4. **createdAt vs occurredAt.** event.occurredAt = когда событие произошло (в GsdEngine).
   record.createdAt = когда записали в БД. Latency debugging.
5. **Port 5433, не 5432.** Избегает конфликта с `dmg-postgres` (проект DMG). Параллельно
   с портом 6380 для Redis (избегает `dmg-redis`).
6. **EventPersistenceService в EventsModule providers, не @Global.** Минимальное изменение,
   не трогаем prisma.service.ts (Phase 2). @Global refactor — отдельная задача.
7. **Fallback на buffer в EventsController.** БД-down → stale events из buffer. При восстановлении
   БД → автоматически переключается на primary.

---

## 4. Verifier и верификация

| Verifier | Результат |
|---|---|
| `pnpm -r typecheck` | ✅ 10/10 green |
| `pnpm --filter @orchestra/api build` | ✅ green, event-persistence.service.js compiled |
| `pnpm --filter @orchestra/gsd-engine test` | ✅ 7/7 (Phase 6) |
| `pnpm --filter @orchestra/consensus-engine test` | ✅ 6/6 (Phase 5) |
| `pnpm --filter @orchestra/api test` | ✅ 5/5 (Phase 7) |
| `pnpm --filter @orchestra/api test:e2e` | ✅ 8/8 (Phase 8) |
| `docker compose up -d` | ✅ Redis + Postgres running |
| `prisma migrate deploy` | ✅ applied, DomainEventRecord table exists |
| API start | ✅ Worker + EventsModule initialized, listening |
| GET /events (empty) | ✅ `{events:[], total:0}` |
| Trigger mutation → GET /events | ✅ RoundStarted persisted, total:1, DB row exists |
| **D-22 ГЛАВНЫЙ: restart persistence** | ✅ **stop API → start API → GET /events → event still there** (лично техлид) |
| Anti-conflict | ✅ packages/ 0; apps/api только events/ (3 modified + 1 new) + prisma + docker-compose |

---

## 5. Sub-phase audit trail

### 5.1. Phase 8d-1 — PASS (self-execute)

**Кодер mimo** написал весь код (8 файлов: docker-compose, schema.prisma, migration, 4 файла
events/, .env.example) точно по PLAN §2. Код полностью соответствует спецификации — code review
техлида не нашёл расхождений.

**Зависание кодера:** mimo системно зависал на runtime-тестах — та же PowerShell + long-running
server ловушка что в 8-03, 8c-1, 8c-2. Код написан, но верификация + SUMMARY не завершены.

**Owner-санкция «доделай сам»** → техлид (zcode) выполнил formal validation:
- Code review всех 8 файлов — корректно.
- Build + typecheck + prisma generate + migrate deploy — green.
- **D-22 лично:** trigger mutation → stop API → start API → GET /events → event persisted.
- Regression 26/26, anti-conflict чист.

**Process-observation:** После 8 фаз подряд с mimo (где 5 раз ловил нарушения audit-trail,
потом 3 фазы стабильного позитивного тренда), этот раз — кодер стабильно делает код, но
системно не может завершить runtime-verification из-за PowerShell/Cursor-shell constraint.
Техлид рекомендует на будущее: либо мигрировать runtime-тесты в Git Bash, либо делать
verification скрипты (один запуск — весь test suite).

---

## 6. Открытые долги (переносятся в Wave 8d+)

| ID | Приоритет | Что | Когда |
|---|---|---|---|
| **D-8d-1** | P1 | SessionStore persistence (InMemory → Prisma) | Wave 8d+ |
| **D-8d-2** | P1 | Full Decision Repository (ADR/Decision/Spec versioined) | когда Consensus начнёт генерить decisions |
| D-8d-3 | P2 | Event replay UI (Engineering Time Machine) | Wave 8d+ |
| D-8d-4 | P2 | KG-artifact linking | Wave 8d+ |
| D-8d-5 | P3 | Event retention policy (TTL/cleanup) | сейчас растёт бесконечно |
| D-8d-6 | P3 | Event filtering по type/timeframe | сейчас sessionId+limit |
| D-H1 | P2 | Auth/authorization | Wave 8+ |
| D-H3 | P3 | Pagination | при росте |

---

## 7. Файлы Phase 8d-1

```
docker-compose.yml                                     # +postgres service (5433:5432)
apps/api/
├── .env.example                                       # +DATABASE_URL port 5433
├── prisma/
│   ├── schema.prisma                                  # +model DomainEventRecord
│   └── migrations/20260721160318_add_domain_events/   # migration.sql
└── src/events/
    ├── event-persistence.service.ts                   # NEW: persist (upsert) + list (findMany)
    ├── event-consumer.service.ts                      # +dual write (buffer + persist)
    ├── events.controller.ts                           # +read из БД с fallback buffer
    ├── events.module.ts                               # +PrismaService, +EventPersistenceService
    └── event-buffer.ts                                # без изменений (fallback cache)
```

---

**Phase 8d-1 закрыта. Wave 8d-1 (persist events) завершена.**
**Wave 8d-2 (SessionStore persistence) или другие расширения — следующие.**
