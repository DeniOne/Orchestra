---
phase: 8c.3
slug: 08c-event-bus
wave: B-8 (Wave 8c-3 — BullMQ Worker/consumer + REST /events)
title: "Phase 8c-3 — Event Bus трилогия замкнута: Worker потребляет DomainEvents, GET /events для audit"
milestone: "Orchestra MVP — Wave 8c (Event Bus → consumer)"
tech_lead: zcode (ZCode)
date: 2026-07-21
verdict: PASS
subphases:
  - "8c-3 (BullMQ Worker/consumer + REST /events — кодер mimo): PASS. Worker потребляет DomainEvents из Queue, логирует + ring buffer. GET /events с filter+limit. Техлид лично верифицировал D-15 (главный): RoundStarted + OwnerOverrideApplied consumed, reverse chronological, sessionId filter работает."
---

# README-CONTRACT — Phase 8c-3: BullMQ Worker/consumer + REST /events

> Замыкающий документ. Wave 8c-1 (publisher), 8c-2 (real-time UI), **8c-3 (consumer)** — трилогия
> замкнута. Wave 8c полностью закрыта. Wave 8d (Decision Repository persist) — следующая.

---

## 1. Вердикт: PASS

**Phase 8c-3 = PASS.** BullMQ Worker потребляет DomainEvents из Queue. `GET /events` endpoint
возвращает обработанные события с filter и limit. Event Bus трилогия замкнута:
producer (8c-1) → transport real-time (8c-2) → **consumer (8c-3)**.

**Главный критерий D-15 лично верифицирован техлидом:**
- `POST /sessions/:id/rounds` → `GET /events` → `total:1`, events[0] = RoundStarted JSON полный
- `POST /sessions/:id/override` → `GET /events?limit=10` → `total:2`, reverse chronological
- `GET /events?sessionId=X` → filter работает (2 events для существующей, 0 для несуществующей)

**Pub/sub (Phase 8c-2) не сломан** (D-17): `redis-cli SUBSCRIBE` получает JSON event параллельно
с Worker'ом. Real-time UI продолжает работать.

---

## 2. Что доставлено

### 2.1. `apps/api/src/events/` — новый NestJS module

- **`event-buffer.ts`** — `@Injectable EventBuffer` (in-memory ring buffer, max 1000):
  - `append(event)` push + shift при overflow.
  - `list({sessionId?, limit?})` filter + slice(-limit).reverse() (reverse chronological).
  - `clear()`, `get size`.
- **`event-consumer.service.ts`** — `@Injectable EventConsumerService implements OnModuleInit, OnModuleDestroy`:
  - BullMQ `Worker<DomainEvent>` на queue `'orchestra.events'`, concurrency=5.
  - Handler: `logger.log(JSON structured)` + `buffer.append(event)`.
  - `on('failed')`, `on('error')` — error handling.
  - `onModuleDestroy` → `worker.close()`.
- **`events.controller.ts`** — `@Controller('events')`:
  - `GET /events?sessionId=X&limit=N` → `{ events: DomainEvent[], total: number }`.
  - Reverse chronological (свежие сверху).
- **`events.module.ts`** — providers: [EventBuffer, EventConsumerService], controllers: [EventsController], exports: [EventBuffer].
- **`app.module.ts`** — imports += EventsModule.

### 2.2. Полный поток

```
RedisEventPublisher.publish(event)
  ├── queue.add → bull:orchestra.events:* (Queue, persist)
  │     ↓ BullMQ Worker (concurrency=5) pull
  │     EventConsumerService.process(job)
  │       ├── logger.log(JSON event) — structured log в stdout
  │       └── buffer.append(event) — in-memory ring buffer (max 1000)
  │
  └── pubsub.publish('orchestra.events.pubsub', JSON)
        ↓
        EventsGateway → server.emit('orchestra:event', event)
        ↓
        WebSocket → useEventsSubscription hook → invalidateQueries → UI real-time

HTTP GET /events
  ↓
EventsController.list(sessionId?, limit?)
  ↓
buffer.list({sessionId, limit}) → { events: [...], total }
```

**Важно:** Worker (audit path) и pub/sub (real-time UI path) — **независимые**. Если Worker
падает — UI продолжает real-time. Если pub/sub падает — Worker продолжает audit. Двойная
надёжность.

---

## 3. Architecture decisions

1. **BullMQ Worker (explicit), не @Processor decorator.** Explicit lifecycle, не требует
   `@nestjs/bullmq` dep. Соответствует existing код-стилю (RedisEventPublisher explicit Queue).
2. **Ring buffer — простой array + shift.** 1000 элементов — micro-optimization не нужна.
   Persist = Wave 8d. Простота > cleverness.
3. **concurrency: 5.** Events независимы (RoundStarted, PhaseChanged, OwnerOverrideApplied),
   можно параллельно.
4. **Worker ≠ pub/sub path.** Worker pull из Queue (audit, persisted для Wave 8d). EventsGateway
   push из pub/sub (real-time UI). Независимые. Если Worker упал — UI продолжает real-time.
5. **Reverse chronological в GET /events.** UI-friendly (свежие сверху).
6. **`extractPayload` для лога.** Event-specific fields (roundId, from/to, reason) — в log
   отдельно от общих (id/type/sessionId/occurredAt). Читаемый structured log.
7. **GET /events — public read-only.** Auth (D-H1) — Wave 8+. Сейчас dev/debug endpoint.

---

## 4. Verifier и верификация

| Verifier | Результат |
|---|---|
| `pnpm -r typecheck` | ✅ 10/10 green |
| `pnpm --filter @orchestra/api build` | ✅ green, events/*.js compiled |
| `pnpm --filter @orchestra/gsd-engine test` | ✅ 7/7 (Phase 6) |
| `pnpm --filter @orchestra/consensus-engine test` | ✅ 6/6 (Phase 5) |
| `pnpm --filter @orchestra/api test` | ✅ 5/5 (Phase 7) |
| `pnpm --filter @orchestra/api test:e2e` | ✅ 8/8 (Phase 8) |
| Docker Redis up + PING | ✅ PONG |
| API start с EventsModule + Worker | ✅ `Worker started on queue 'orchestra.events', concurrency=5` |
| GET /events (empty) | ✅ `{events:[], total:0}` |
| **D-15 ГЛАВНЫЙ: Worker потребляет + GET /events** | ✅ **RoundStarted + OwnerOverrideApplied consumed, total растёт, reverse chronological, sessionId filter** (лично техлид) |
| D-17 pub/sub не сломан | ✅ redis-cli SUBSCRIBE получает JSON event параллельно с Worker |
| Anti-conflict | ✅ packages/ 0; apps/api только events/ (new) + app.module.ts (+1 import) |

---

## 5. Sub-phase audit trail

### 5.1. Phase 8c-3 — PASS

Кодер mimo реализовал точно по PLAN §2:
- `event-buffer.ts`, `event-consumer.service.ts`, `events.controller.ts`, `events.module.ts` —
  все 4 файла.
- `app.module.ts` + EventsModule import.
- Никаких лишних файлов, никаких артефактов.

**Process-observation:** 8-е нарушение audit-trail НЕ произошло. Кодер на стабильном позитивном
тренде после УСИЛЕННОГО evidence-rule (8b-02). Все runtime-D в SUMMARY имеют полный evidence
(curl + JSON responses). Техлид перепроверил лично — расхождений нет.

---

## 6. Открытые долги (переносятся в Wave 8d+)

| ID | Приоритет | Что | Когда |
|---|---|---|---|
| **D-8c-3-1** | **P1** | **Persist events в PostgreSQL (Decision Repository)** | **Wave 8d (D-F1/D-F3)** |
| D-8c-3-2 | P2 | Event-driven business logic (RoundStarted → auto-action) | Wave 8c+ |
| D-8c-3-3 | P3 | Retry/DLQ tuning | сейчас BullMQ default |
| D-8c-3-4 | P3 | Event filtering расширение (type, timeframe) | сейчас только sessionId |
| D-8c-3-5 | P3 | WS stream для audit viewer | сейчас REST polling |
| D-8c-2-1..4 | P2-P3 | UI real-time extensions (Wave 8c-2 closed) | Wave 8c+ |
| D-8c-4 | P2 | Расширить DomainEvent до 11 типов | по мере появления emiters |
| D-8c-5 | P2 | Event replay / Engineering Time Machine | Wave 8d+ |
| D-H1 | P2 | Auth/authorization | Wave 8+ |
| D-H3 | P3 | Pagination | при росте |

---

## 7. Файлы Phase 8c-3

```
apps/api/src/
├── events/                                    # NEW module
│   ├── event-buffer.ts                        # in-memory ring buffer (max 1000)
│   ├── event-consumer.service.ts              # BullMQ Worker (concurrency=5)
│   ├── events.controller.ts                   # GET /events?sessionId&limit
│   └── events.module.ts                       # NestJS module
└── app.module.ts                              # imports += EventsModule

.planning/phases/08c-event-bus/
├── 8c-3-PLAN.md
├── 8c-3-SUMMARY.md
└── README-CONTRACT-PHASE-8c-3.md              # этот файл
```

---

## 8. Wave 8c полностью закрыта

Wave 8c = Event Bus полноценная система:
- **8c-1** (`0b41520`): Producer — RedisEventPublisher публикует в BullMQ Queue.
- **8c-2** (`9cbd1cf`): Real-time transport — EventsGateway (pub/sub → WS), UI reactive.
- **8c-3** (этот commit): Consumer — BullMQ Worker + REST /events.

**Orchestra Event Bus = producer + transport + consumer.** Полная трилогия. Architecture §3
«Event Bus = Redis + BullMQ, журнал всех действий как события» — материализована полностью.

---

**Phase 8c-3 закрыта. Wave 8c полностью завершена.**
**Wave 8d (Decision Repository persist в PostgreSQL) — следующая.** Когда consumer
переключится с `buffer.append` на `prisma.event.create` — audit trail станет долговременным,
переживающим рестарт API. Engineering Time Machine (replay событий) станет возможной.
