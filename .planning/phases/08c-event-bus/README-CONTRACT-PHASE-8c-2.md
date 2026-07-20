---
phase: 8c.2
slug: 08c-event-bus
wave: B-8 (Wave 8c-2 — UI real-time через WebSocket)
title: "Phase 8c-2 — Real-time Conducting Score UI: WebSocket transport, multi-tab auto-update без refetch"
milestone: "Orchestra MVP — Wave 8c (Event Bus → UI real-time)"
tech_lead: zcode (ZCode)
date: 2026-07-20
verdict: PASS
subphases:
  - "8c-2 (UI real-time WebSocket — кодер mimo): PASS. EventsGateway (NestJS socket.io) подписан на Redis pub/sub channel, форвардит DomainEvents в WS-клиенты. Frontend: socket.io-client singleton + useEventsSubscription hook → TanStack invalidateQueries. Multi-tab test выполнен программно (2 socket.io-client). Техлид лично верифицировал D-21 pub/sub fanout — JSON event в redis-cli SUBSCRIBE полный и корректный."
---

# README-CONTRACT — Phase 8c-2: UI real-time через WebSocket

> Замыкающий документ фазы. Wave 8c-1 (publisher) закрыта в `0b41520`. Wave 8c-2 (real-time UI)
> — этот документ. Wave 8c-3 (BullMQ Worker/consumer) — отдельная фаза.

---

## 1. Вердикт: PASS

**Phase 8c-2 = PASS.** Orchestra UI стал reactive: действия в одной вкладке мгновенно отражаются
во всех других. Conducting Score (UI Canon §1) теперь поддерживает real-time обновления без
manual refetch.

**Главный критерий D-21 (pub/sub fanout) лично верифицирован техлидом:**
```
redis-cli SUBSCRIBE orchestra.events.pubsub
→ POST /sessions/:id/rounds
→ message: {"id":"RoundStarted-...","type":"RoundStarted","sessionId":"...","roundId":"...","phase":"Discover","occurredAt":"..."}
```

Multi-tab UI test (D-24/D-25) кодер выполнил **программно** (2 socket.io-client'а вместо
браузерных вкладок) — эквивалентно, но без DOM-grep. Техлид принимает как sufficient: если
pub/sub получает event и gateway эмитит в WS-клиенты (что техдоказуемо), UI-часть работает
через стандартный TanStack Query invalidate pattern.

---

## 2. Что доставлено

### 2.1. Backend (apps/api)

- **`redis.config.ts`** + `EVENT_PUBSUB_CHANNEL = 'orchestra.events.pubsub'`.
- **`redis-event-publisher.ts`** — `publish()` теперь делает **И** `queue.add` (BullMQ persist,
  для Wave 8d audit) **И** `pubsub.publish(EVENT_PUBSUB_CHANNEL, JSON)`. Отдельное Redis
  connection для pub/sub (Redis constraint: одно connection не может pub+sub).
- **`events.gateway.ts`** (НОВЫЙ) — `@WebSocketGateway` (socket.io через `@nestjs/platform-socket.io`).
  - `@WebSocketServer() server: Server`.
  - `OnModuleInit` → `subscriber.subscribe(EVENT_PUBSUB_CHANNEL)`, `on('message', ...)` →
    `server.emit('orchestra:event', event)` всем WS-клиентам.
  - `OnModuleDestroy` → `unsubscribe + quit`.
- **`event-bus.module.ts`** + `EventsGateway` provider.
- **Deps**: `@nestjs/websockets`, `@nestjs/platform-socket.io` (уже установлены из 8c-01
  несмотря на утверждение SUMMARY — фактически в package.json).

### 2.2. Frontend (apps/web)

- **`lib/socket.ts`** (НОВЫЙ) — singleton `getSocket()` (один socket.io-client на приложение,
  иначе десятки WS на вкладку).
- **`hooks/use-events-subscription.ts`** (НОВЫЙ) — `useEventsSubscription(sessionIdFilter?)`:
  `socket.on('orchestra:event', handler)` → `invalidateQueries(['session', id])` если filter
  matches, ИЛИ `invalidateQueries(['sessions'])` если без filter. Cleanup: `socket.off` (НЕ
  close — singleton переживает unmount).
- **`components/session-list.tsx`** + 1 строка `useEventsSubscription()` в начале.
- **`components/session-detail.tsx`** + 1 строка `useEventsSubscription(id)` в начале.
- **Dep**: `socket.io-client` (^4).

### 2.3. Полный поток события

```
POST /sessions/:id/rounds
  ↓
GsdEngine.startRound → events.publish(RoundStarted)
  ↓
RedisEventPublisher.publish(event)
  ├── queue.add → bull:orchestra.events:* (BullMQ Queue, persist для Wave 8d)
  └── pubsub.publish('orchestra.events.pubsub', JSON)  ← НОВОЕ
      ↓
Redis pub/sub channel ← EventsGateway подписан
                        ↓ server.emit('orchestra:event', event)
WebSocket → все подключённые клиенты
            ↓ socket.on('orchestra:event')
useEventsSubscription hook
            ↓ invalidateQueries(['session', sessionId]) или ['sessions']
TanStack Query refetch → UI обновляется автоматически
```

---

## 3. Architecture decisions

1. **Queue + pub/sub параллельно, не выбор.** BullMQ Queue — persist/retry/DLQ для audit trail
   (Wave 8d Decision Repository) и future Worker (Wave 8c-3). Redis pub/sub — low-latency
   fanout для real-time push. Events публикуются в оба, каждый transport свою ответственность.
2. **socket.io (NestJS canon), не raw ws.** `@nestjs/platform-socket.io` — robust reconnection,
   fallback to polling, room-based broadcasting (future для session-scoped updates).
3. **Отдельное Redis connection для pub/sub.** Redis constraint: одно connection не может
   одновременно publish и subscribe. `RedisEventPublisher` имеет `this.pubsub`, `EventsGateway`
   имеет свой `this.subscriber`.
4. **Singleton socket на клиенте.** `getSocket()` возвращает один `Socket` instance. Если каждый
   компонент откроет connection — десятки WS на вкладку, server overload.
5. **TanStack Query invalidate, не setQueryData.** Server = source of truth, refetch — canonical
   pattern. Альтернатива (incremental state update из event payload) сложнее и error-prone.
6. **session-scoped filter в useEventsSubscription.** SessionDetail подписывается с
   `sessionIdFilter = id` — обрабатывает только events для своей сессии. SessionList — без
   filter (любой event меняет list).
7. **CORS дублирован в `@WebSocketGateway`.** NestJS требует отдельно для WS transport.
   Соответствует `main.ts enableCors`.

---

## 4. Sub-phase audit trail

### 4.1. Phase 8c-2 — PASS

Кодер mimo реализовал точно по PLAN §2/§3:
- Backend: `events.gateway.ts`, `redis-event-publisher.ts` (+pub/sub), `redis.config.ts`,
  module registration.
- Frontend: `socket.ts` singleton, `use-events-subscription.ts`, +1 строка в `session-list.tsx`
  и `session-detail.tsx`.

**Multi-tab test compromise:** кодер честно отметил в §риски SUMMARY: Playwright не установлен,
D-24/25 multi-tab выполнен **программно** через 2 socket.io-client'а (эквивалент browser tabs
на transport-уровне, но без DOM-grep). Техлид принял как sufficient — главное техдоказуемое
(pub/sub + WS broadcast) лично перепроверено.

**Process-observation:** 7-е нарушение audit-trail НЕ произошло. Кодер на позитивном тренде
после усиленного evidence-rule (8b-02) — D-24/25 compromise честно описан в рисках, не
замаскирован под «✅ works».

**Cleanup-замечание:** кодер оставил 2 тестовых артефакта (`apps/web/ws-multitab-test.cjs`,
`.planning/_scratch/ws-multitab-test.mjs`) — техлид удалил перед commit. Не нарушение, но
кодер должен чистить за собой.

---

## 5. Verifier и верификация

| Verifier | Результат |
|---|---|
| `pnpm -r typecheck` | ✅ 10/10 green |
| `pnpm --filter @orchestra/api build` | ✅ green, events.gateway.js compiled |
| `pnpm --filter @orchestra/gsd-engine test` | ✅ 7/7 (Phase 6) |
| `pnpm --filter @orchestra/consensus-engine test` | ✅ 6/6 (Phase 5) |
| `pnpm --filter @orchestra/api test` | ✅ 5/5 (Phase 7) |
| `pnpm --filter @orchestra/api test:e2e` | ✅ 8/8 (Phase 8) |
| Docker Redis up + PING | ✅ PONG |
| API start с EventsGateway | ✅ `Subscribed to orchestra.events.pubsub` |
| socket.io handshake | ✅ `{sid:...}` response |
| **D-21 pub/sub fanout (лично техлид)** | ✅ **JSON event RoundStarted в redis-cli SUBSCRIBE** |
| D-24/25 multi-tab (программный, техлид принимает) | ✅ 2 socket.io-client получили RoundStarted + PhaseChanged |
| Anti-conflict | ✅ packages/ 0; apps/api только event-bus/; apps/web только 2 компонента + new lib/hook |

---

## 6. Открытые долги (переносятся в Wave 8c+)

| ID | Приоритет | Что | Когда |
|---|---|---|---|
| D-8c-1 | P1 | BullMQ Worker/consumer (business-logic на events) | Wave 8c-3 |
| D-8c-2-1 | P2 | ConfidenceRecalculated event — UI готов, emiter'а нет | после Continuous Consensus в Consensus Engine |
| D-8c-2-2 | P3 | Reconnect/backoff tuning для production | socket.io default пока |
| D-8c-2-3 | P2 | Auth на WS (сейчас публичный) | Wave 8+ (D-H1) |
| D-8c-2-4 | P3 | Playwright e2e для multi-tab (сейчас программный) | когда Playwright в проекте |
| D-8c-3 | P1 | Decision Repository persist (PostgreSQL) | Wave 8d (D-F1/D-F3) |
| D-8c-4 | P2 | Расширить DomainEvent до 11 типов | по мере появления emiters |
| D-8c-5 | P2 | Event replay / Engineering Time Machine | Wave 8d+ |
| D-H1 | P2 | Auth/authorization | Wave 8+ |
| D-H3 | P3 | Pagination | при росте |

---

## 7. Файлы Phase 8c-2

```
apps/api/
├── package.json                                      # +@nestjs/websockets, +@nestjs/platform-socket.io (deps)
└── src/event-bus/
    ├── redis.config.ts                               # +EVENT_PUBSUB_CHANNEL
    ├── redis-event-publisher.ts                      # +pubsub.publish параллельно с queue.add
    ├── events.gateway.ts                             # NEW: @WebSocketGateway, подписан pub/sub → WS emit
    └── event-bus.module.ts                           # +EventsGateway provider

apps/web/
├── package.json                                      # +socket.io-client
└── src/
    ├── lib/socket.ts                                 # NEW: socket.io-client singleton
    ├── hooks/use-events-subscription.ts              # NEW: socket.on + invalidateQueries
    └── components/
        ├── session-list.tsx                          # +1 строка useEventsSubscription()
        └── session-detail.tsx                        # +1 строка useEventsSubscription(id)

.planning/phases/08c-event-bus/
├── 8c-2-PLAN.md
├── 8c-2-SUMMARY.md
└── README-CONTRACT-PHASE-8c-2.md                     # этот файл
```

---

**Phase 8c-2 закрыта. Wave 8c-2 (UI real-time) завершена.**
**Wave 8c-3 (BullMQ Worker/consumer) или Wave 8d (Decision Repository persist) — следующие.**
