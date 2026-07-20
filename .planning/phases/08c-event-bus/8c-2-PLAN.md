---
phase: 8c.2
slug: 08c-event-bus
wave: B-8
title: "UI real-time через WebSocket — Redis pub/sub параллельно с BullMQ Queue, оба экрана обновляются при DomainEvents"
milestone: "Orchestra MVP — Wave 8c (Event Bus → UI real-time)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-20
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build) + runtime-gate (live multi-tab browser test: trigger mutation в одной вкладке → SessionList/SessionDetail обновляются во второй вкладке БЕЗ refetch, с УСИЛЕННЫМ evidence-rule §0.2) + regression-gate (Phase 5/6/7/8/8b/8c-1 spec'и green)
baseline_before: "Phase 8c-1 PASS (commit 0b41520): BullMQ publisher публикует DomainEvents (RoundStarted, PhaseChanged, OwnerOverrideApplied) в Redis Queue 'orchestra.events'. UI Phase 8b на manual refresh (TanStack Query invalidation после mutation, нет real-time push). Architecture.md требует 'REST/WebSocket' между web↔api. UI Canon §3 требует WebSocket-стрим для Continuous Consensus display."
depends_on:
  - "Phase 8c-1 (0b41520) — BullMQ publisher + Redis infra (docker-compose, redis.config)"
  - "Phase 8b (152bf26) — UI components (SessionList, SessionDetail, TanStack Query hooks)"
  - "@orchestra/domain events.ts — DomainEvent union"
closes_debts:
  - "D-H2 / D-8c-2 WebSocket/SSE real-time — UI обновляется без refetch при событиях."
  - "Косвенно D-8b-2 — UI Canon §3 Continuous Consensus display теперь технически возможен (по крайней мере для существующих 3 типов DomainEvent)."
opens_debts_expected:
  - "D-8c-2-1: Реально ConfidenceRecalculated события — сейчас нет emiter'а (Consensus Engine не публикует). Когда появится (после расширения Consensus для Continuous Consensus) — UI уже готов."
  - "D-8c-2-2: Reconnect/backoff стратегия socket.io — сейчас default. Для production с нестабильным connection — tune (Wave 8c+)."
  - "D-8c-2-3: Auth на WS (сейчас публичный) — Wave 8+ (D-H1)."
  - "D-8c-1 Event consumer (BullMQ Worker) — Wave 8c-3, ОТДЕЛЬНО от pub/sub (не путать!)."
---

# PLAN 8c-2 — UI real-time через WebSocket (Queue + pub/sub параллельно)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8c-2-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **EVIDENCE-RULE (УСИЛЕННЫЙ, PLAN 8b-02 §0.2 + 8c-01 §0.2 — доказан дважды):** для каждого
> runtime-D явно указан тип evidence. Multi-tab test (D-19) — главный, техлид верифицирует
> лично через browser devtools + DOM-grep. Curl-only без DOM-grep = auto-FAIL.

## 0. Контекст

### 0.1. Что есть сейчас

**Phase 8c-1 (PASS, `0b41520`)**: `RedisEventPublisher` публикует DomainEvents в BullMQ Queue
`'orchestra.events'`. События `RoundStarted`, `PhaseChanged`, `OwnerOverrideApplied` формируются
GsdEngine и попадают в Redis. Queue = persisted job storage для будущего Worker'а (Wave 8c-3)
и Decision Repository persist (Wave 8d).

**Phase 8b (PASS, `152bf26`)**: UI на Next.js 15 + TanStack Query. `SessionList` и
`SessionDetail` — client components. После mutation (create/rounds/approve) — TanStack
`invalidateQueries` → refetch → UI обновляется **только в текущей вкладке**. В других вкладках
или после длительной паузы — stale data, нужен manual «Обновить».

### 0.2. Что делает Phase 8c-2 (scope — owner-decision 2026-07-20)

**Real-time UI через WebSocket, с двумя экранами (SessionList + SessionDetail).**

Архитектура: **Queue + Redis pub/sub параллельно** (третий вариант из owner-decision):
- `RedisEventPublisher` публикует event **И** в BullMQ Queue (persist для audit/Wave 8d) **И** в
  Redis pub/sub channel `orchestra.events.pubsub` (real-time fanout).
- `EventsGateway` (NestJS WebSocket gateway на socket.io) подписан на pub/sub channel.
- При получении event из pub/sub → `server.emit('event', event)` → все подключённые WS-клиенты.
- UI (web) подключается к WS, получает events, инвалидидирует TanStack Query cache (или
  обновляет напрямую через `setQueryData`).

**Почему Queue + pub/sub, а не только pub/sub:**
- Queue = persist, retry, DLQ — для audit trail (Wave 8d Decision Repository) и background
  processing (Wave 8c-3 consumer).
- pub/sub = real-time fanout без overhead job-tracking. Events не теряются для audit (Queue
  хранит), но real-time push идёт мгновенно.
- Разделение ответственности: Queue для durability, pub/sub для latency.

**Почему не BullMQ Worker для real-time:**
- Worker = pull model (читает jobs по расписанию), добавляет latency.
- Worker нужен для **business-logic** на event (например, persist в DB, notifications) — это
  Wave 8c-3, ОТДЕЛЬНО от real-time transport.

### 0.3. Что НЕ в scope (забор на Wave 8c+)

- **BullMQ Worker/consumer** — Wave 8c-3. Real-time идёт через pub/sub, не через Worker.
- **Decision Repository persist** (PostgreSQL) — Wave 8d (D-F1/D-F3).
- **Расширение DomainEvent до 11 типов** — по мере появления emiters (D-8c-4).
- **Auth на WS** — сейчас публичный, D-H1 Wave 8+.
- **ConfidenceRecalculated** — UI Canon §3 требует, но Consensus Engine ещё не публикует
  (нужно расширение Consensus для Continuous Consensus). Когда появится — UI уже готов.
- **Streaming LLM responses** (UI Canon §8) — Wave 8c+ для Conducting Score дорожек ролей.
- **Cancel agent response** (UI Canon §8) — Wave 8c+.

### 0.4. Архитектурное решение: socket.io (не raw WS)

**Выбор:** `@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io-client`.

**Обоснование:**
- NestJS-canon WS framework, интегрируется с DI.
- socket.io v4 — robust reconnection (backoff, heartbeat), room-based broadcasting, fallback
  to long-polling если WS блокируется прокси.
- Канон для NestJS+real-time проектов.
- React 19 + Next 15 client — `socket.io-client` работает в client components без SSR issues.

**Альтернатива (raw `ws`):** rejected. Низкоуровневый, нужно вручную делать reconnection,
heartbeat, message framing. Overhead без выгоды для нашего use-case.

---

## 1. Архитектура (главное)

### 1.1. Полный поток события

```
HTTP Request: POST /sessions/:id/rounds
    ↓
SessionsController → GsdEngineService.startRound
    ↓
GsdEngine.startRound → events.publish(RoundStarted)
    ↓
RedisEventPublisher.publish(event)
    ├── queue.add(...) → bull:orchestra.events:* (Queue, persist)
    └── redis.publish('orchestra.events.pubsub', JSON)  ← НОВОЕ
        ↓
Redis pub/sub channel 'orchestra.events.pubsub'
    ↓
EventsGateway (NestJS, подписан на channel)  ← НОВОЕ
    ↓ server.emit('orchestra:event', event)
WebSocket → все подключённые клиенты
    ↓
useEventsSubscription hook (web)  ← НОВОЕ
    ↓ onEvent: qc.invalidateQueries(['session', event.sessionId])
    ↓
TanStack Query refetch → UI обновляется
```

### 1.2. Структура файлов

```
apps/api/src/
├── event-bus/
│   ├── redis-event-publisher.ts          # ИЗМЕНИТЬ: +pub/sub параллельно с Queue
│   ├── redis.config.ts                   # ИЗМЕНИТЬ: +EVENT_PUBSUB_CHANNEL
│   ├── event-bus.module.ts               # без изменений
│   └── events.gateway.ts                 # НОВЫЙ: NestJS WS gateway
├── app.module.ts                         # ИЗМЕНИТЬ: imports += EventBusModule (для gateway DI)
apps/web/src/
├── lib/
│   ├── socket.ts                         # НОВЫЙ: socket.io-client singleton
│   └── types.ts                          # без изменений (DomainEvent уже определён)
├── hooks/
│   └── use-events-subscription.ts        # НОВЫЙ: подписка на WS + invalidation
├── providers/
│   └── query-provider.tsx                # без изменений
├── components/
│   ├── session-list.tsx                  # ИЗМЕНИТЬ: +useEventsSubscription (для SessionCreated)
│   └── session-detail.tsx                # ИЗМЕНИТЬ: +useEventsSubscription (для session-specific events)
└── app/
    └── layout.tsx                        # без изменений (EventsSubscription монтируется в page)

apps/api/package.json                     # ИЗМЕНИТЬ: +@nestjs/websockets, +@nestjs/platform-socket.io
apps/web/package.json                     # ИЗМЕНИТЬ: +socket.io-client
```

---

## 2. Backend (apps/api)

### 2.1. `redis.config.ts` — добавить pub/sub channel

```typescript
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
```

### 2.2. `redis-event-publisher.ts` — публиковать в оба (Queue + pub/sub)

```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { EventPublisherPort } from '@orchestra/gsd-engine';
import type { DomainEvent } from '@orchestra/domain';
import { REDIS_CONNECTION, EVENT_QUEUE_NAME, EVENT_PUBSUB_CHANNEL } from './redis.config.js';

@Injectable()
export class RedisEventPublisher implements EventPublisherPort, OnModuleDestroy {
  private readonly queue: Queue<DomainEvent>;
  private readonly pubsub: Redis;  // ← НОВОЕ: отдельное connection для pub/sub
  private readonly logger = new Logger(RedisEventPublisher.name);

  constructor() {
    this.queue = new Queue<DomainEvent>(EVENT_QUEUE_NAME, {
      connection: REDIS_CONNECTION,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 3 },
    });
    // Redis требует ОТДЕЛЬНОЕ connection для pub/sub (одно connection не может pub и sub).
    this.pubsub = new Redis(REDIS_CONNECTION);
  }

  async publish(event: DomainEvent): Promise<void> {
    // Queue: persist для audit (Wave 8d) и future Worker (Wave 8c-3)
    try {
      await this.queue.add(event.type, event, { jobId: event.id });
    } catch (e) {
      this.logger.error(`Failed to publish event to Queue ${event.type}: ${(e as Error).message}`);
    }
    // Pub/sub: real-time fanout в EventsGateway → WS-клиенты
    try {
      await this.pubsub.publish(EVENT_PUBSUB_CHANNEL, JSON.stringify(event));
    } catch (e) {
      this.logger.error(`Failed to publish event to pub/sub ${event.type}: ${(e as Error).message}`);
    }
    this.logger.debug(`Published event: ${event.type} (${event.id}) session=${event.sessionId}`);
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.pubsub.quit();
  }
}
```

**Важно:** Redis требует **отдельное connection** для pub/sub. Одно connection не может одновременно
`publish` и `subscribe`. Поэтому `this.pubsub = new Redis(...)` — отдельный клиент от `this.queue`.

### 2.3. `events.gateway.ts` — NestJS WS gateway

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { REDIS_CONNECTION, EVENT_PUBSUB_CHANNEL } from './redis.config.js';
import type { DomainEvent } from '@orchestra/domain';

/**
 * WebSocket gateway: форвардит DomainEvents из Redis pub/sub channel во все подключённые
 * WS-клиенты (web UI). Соответствует Architecture §3 'REST/WebSocket'.
 *
 * Подписывается на EVENT_PUBSUB_CHANNEL в OnModuleInit. При получении event —
 * server.emit('orchestra:event', event) → все клиенты. UI решает что делать (обычно —
 * invalidateQueries для затронутой session).
 *
 * Auth (D-H1) — Wave 8+. Сейчас публичный gateway.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },  // соответствует main.ts enableCors
  namespace: '/',  // default namespace
})
@Injectable()
export class EventsGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private readonly server!: Server;  // NestJS инжектит после конструирования

  private readonly subscriber: Redis;
  private readonly logger = new Logger(EventsGateway.name);

  constructor() {
    // Отдельное connection для подписки (publish идёт от RedisEventPublisher).
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
```

### 2.4. `event-bus.module.ts` — зарегистрировать gateway

```typescript
import { Module } from '@nestjs/common';
import { RedisEventPublisher } from './redis-event-publisher.js';
import { EventsGateway } from './events.gateway.js';

@Module({
  providers: [RedisEventPublisher, EventsGateway],
  exports: [RedisEventPublisher],
})
export class EventBusModule {}
```

> EventsGateway не нужно экспортировать — NestJS автоматически активирует `@WebSocketGateway()`
> декорированный класс при загрузке модуля. Но он должен быть в `providers`.

### 2.5. `app.module.ts` — imports без изменений

EventBusModule уже импортируется через GsdModule (Phase 8c-1). Gateway активируется при
загрузке. Ничего не трогать в app.module.ts.

### 2.6. `apps/api/package.json` — deps

Добавить:
- `@nestjs/websockets` (^10)
- `@nestjs/platform-socket.io` (^10)

Версии должны совпадать с `@nestjs/common` (^10.4.22) — NestJS monorepo, синхронные релизы.

---

## 3. Frontend (apps/web)

### 3.1. `lib/socket.ts` — socket.io-client singleton

```typescript
import { io, type Socket } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Singleton — один connection на всё приложение. Browser-only (Next.js client components).
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_URL, {
      transports: ['websocket'],  // без long-polling fallback (для dev проще)
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}
```

> Кодер: singleton важен — иначе каждый компонент будет открывать отдельный connection, и
> сервер увидит десятки WS на одну вкладку.

### 3.2. `hooks/use-events-subscription.ts` — TanStack Query invalidation

```typescript
'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';
import type { DomainEvent } from '@orchestra/domain';

/**
 * Подписывается на WebSocket orchestra:event stream.
 * При получении event — инвалидирует соответствующие TanStack Query cache:
 *  - Любой event с sessionId → invalidate ['session', sessionId] (SessionDetail refetch).
 *  - RoundStarted / PhaseChanged / OwnerOverrideApplied → invalidate ['sessions'] (SessionList refetch,
 *    чтобы обновить phase/rounds в списке).
 *
 * Опциональный фильтр по sessionId — если передан, обрабатывает только events для этой сессии.
 * Используется в SessionDetail для изоляции от чужих событий.
 */
export function useEventsSubscription(sessionIdFilter?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    const handler = (event: DomainEvent) => {
      // SessionDetail: если event для нашей сессии — invalidate detail
      if (sessionIdFilter && event.sessionId === sessionIdFilter) {
        qc.invalidateQueries({ queryKey: ['session', sessionIdFilter] });
      }
      // SessionList: любое событие меняет состояние сессии → invalidate list
      // (для SessionCreated — добавление; для PhaseChanged — изменение phase в карточке)
      if (!sessionIdFilter) {
        qc.invalidateQueries({ queryKey: ['sessions'] });
      }
    };

    socket.on('orchestra:event', handler);

    return () => {
      socket.off('orchestra:event', handler);
    };
  }, [qc, sessionIdFilter]);
}
```

> Кодер: NOT close socket в cleanup — singleton переживает unmount. Только removeEventListener.

### 3.3. Интеграция в компоненты

**`session-list.tsx`** — добавить в начало компонента:
```typescript
export function SessionList() {
  useEventsSubscription();  // ← НОВОЕ: invalidate ['sessions'] при любом event
  const { data: sessions, isLoading, error, refetch, isFetching } = useSessions();
  // ... остальное без изменений
}
```

**`session-detail.tsx`** — добавить:
```typescript
export function SessionDetail({ id }: { id: string }) {
  useEventsSubscription(id);  // ← НОВОЕ: invalidate ['session', id] при event для этой сессии
  const { data: session, isLoading, error } = useSession(id);
  // ... остальное без изменений
}
```

### 3.4. `apps/web/package.json` — deps

Добавить:
- `socket.io-client` (^4)

---

## 4. must_haves.truths (D-критерии)

### Backend infrastructure

- **D-01** `apps/api/package.json` +deps: `@nestjs/websockets`, `@nestjs/platform-socket.io`.
  `pnpm install` green.
- **D-02** `apps/api/src/event-bus/redis.config.ts` + `EVENT_PUBSUB_CHANNEL = 'orchestra.events.pubsub'`.
- **D-03** `apps/api/src/event-bus/redis-event-publisher.ts`:
  - Отдельное `Redis` connection для pub/sub (`new Redis(REDIS_CONNECTION)`).
  - `publish()` делает **И** `queue.add` (persist) **И** `pubsub.publish(EVENT_PUBSUB_CHANNEL, JSON.stringify(event))`.
  - `onModuleDestroy` закрывает И queue И pubsub connection.
- **D-04** `apps/api/src/event-bus/events.gateway.ts`:
  - `@WebSocketGateway({ cors: { origin: true, credentials: true } })`.
  - `@WebSocketServer() server: Server`.
  - `OnModuleInit` → `subscriber.subscribe(EVENT_PUBSUB_CHANNEL)`, `on('message', ...)` → `server.emit('orchestra:event', event)`.
  - `OnModuleDestroy` → `unsubscribe + quit`.
- **D-05** `apps/api/src/event-bus/event-bus.module.ts` providers += `EventsGateway`.
- **D-06** `apps/api/src/app.module.ts`: без изменений (EventBusModule уже импортируется через GsdModule).

### Frontend

- **D-07** `apps/web/package.json` +dep: `socket.io-client` (^4).
- **D-08** `apps/web/src/lib/socket.ts`: singleton `getSocket()`, `io(API_URL, { transports: ['websocket'], reconnection: true })`.
- **D-09** `apps/web/src/hooks/use-events-subscription.ts`:
  - `useEventsSubscription(sessionIdFilter?)`.
  - `useEffect` → `socket.on('orchestra:event', handler)`.
  - Handler: `invalidateQueries({ queryKey: ['session', sessionIdFilter] })` если filter matches,
    ИЛИ `invalidateQueries({ queryKey: ['sessions'] })` если без filter.
  - Cleanup: `socket.off('orchestra:event', handler)` (НЕ close socket — singleton).
- **D-10** `apps/web/src/components/session-list.tsx`: в начале `useEventsSubscription()` (без filter).
- **D-11** `apps/web/src/components/session-detail.tsx`: `useEventsSubscription(id)` (с filter).

### Build

- **D-12** `pnpm -r typecheck` → 10 пакетов green.
- **D-13** `pnpm -r build` → green. `apps/api/dist/main.js` существует.

### Regression

- **D-14** `pnpm --filter @orchestra/gsd-engine test` → green (7/7).
- **D-15** `pnpm --filter @orchestra/consensus-engine test` → green (6/6).
- **D-16** `pnpm --filter @orchestra/api test` → green (5/5).
- **D-17** `pnpm --filter @orchestra/api test:e2e` → green (8/8).

### Runtime — backend (УСИЛЕННЫЙ evidence-rule §0.2)

- **D-18** `docker compose up -d redis` → Redis up, PING = PONG.
- **D-19** `node apps/api/dist/main.js` стартует, в логе:
  - `[InstanceLoader] EventBusModule dependencies initialized`.
  - `EventsGateway` subscribed / WebSocket server listens (NestJS логирует socket.io startup).
  Evidence: copy-paste лога API.
- **D-20** WS endpoint доступен: `curl -s http://localhost:3001/socket.io/?EIO=4&transport=polling` →
  возвращает JSON `{sid:...}` или `ok` (socket.io handshake).
  Evidence: curl + body.
- **D-21** Pub/sub fanout: подписаться через `redis-cli SUBSCRIBE orchestra.events.pubsub` в одном
  терминале → trigger mutation в другом → **в первом видно JSON event**.
  Evidence: copy-paste redis-cli output (JSON события).

### Runtime — UI (ГЛАВНЫЙ критерий, D-22..25, лично техлид)

- **D-22** `pnpm --filter @orchestra/web dev` стартует, Ready.
  Evidence: copy-paste вывода + PID + kill command.
- **D-23** В браузере `localhost:3000` — DevTools Network → WS connection к `localhost:3001`
  (socket.io) — status 101 Switching Protocols. DevTools Application → Connection state "connected".
  Evidence: copy-paste DevTools Console (`socket.connected: true`) или Network tab скриншот/описание.
- **D-24** **Multi-tab test (SessionDetail)**:
  1. Открыть вкладку A: `localhost:3000/sessions/<SID>` (SessionDetail).
  2. Открыть вкладку B: ту же страницу (или через API curl POST /sessions/:id/rounds).
  3. В вкладке B: нажать "Start Round" → mutation → сервер публикует RoundStarted.
  4. В вкладке A: **без refetch** — RoundList обновляется (появляется новый раунд).
  Evidence: DOM-grep ДО и ПОСЛЕ mutation во вкладке A. Curl-only = FAIL. Техлид верифицирует
  лично (открывает 2 вкладки, делает mutation, смотрит update).
- **D-25** **Multi-tab test (SessionList)**:
  1. Открыть вкладку A: `localhost:3000/` (SessionList).
  2. Через API curl создать новую сессию (`POST /sessions`).
  3. В вкладке A: **без refetch** — в списке появляется новая карточка (если SessionCreated
     публикуется; см. примечание ниже) ИЛИ карточка существующей сессии обновляется если её
     phase изменилось.
  
  **Примечание:** Phase 8 GsdEngine публикует только `RoundStarted`, `PhaseChanged`,
  `OwnerOverrideApplied` (не `SessionCreated`). Поэтому list-real-time проверяется через
  PhaseChanged: открыть SessionList + в другой вкладке довести сессию до `transitioned`
  (advance) → PhaseBadge в карточке списка обновляется.
  
  Evidence: DOM-grep ДО и ПОСЛЕ advance. Техлид верифицирует лично.

### Anti-conflict

- **D-26** `packages/**` (всё): 0 изменений.
- **D-27** `apps/api/src/`: изменения ТОЛЬКО в:
  - `event-bus/redis-event-publisher.ts` (+pub/sub),
  - `event-bus/redis.config.ts` (+EVENT_PUBSUB_CHANNEL),
  - `event-bus/event-bus.module.ts` (+EventsGateway provider),
  - `event-bus/events.gateway.ts` (НОВЫЙ).
  Другие apps/api/src/ — 0.
- **D-28** `apps/api/src/{sessions,kg,context,roles,consensus,providers,prompts,gsd,prisma.service,app.module,main}/**`: 0 изменений.
- **D-29** `apps/api/{tsconfig.json,nest-cli.json,prisma/,test/,package.json-кроме-deps}`: 0 изменений.
- **D-30** `apps/web/src/`: изменения ТОЛЬКО в:
  - `lib/socket.ts` (НОВЫЙ),
  - `hooks/use-events-subscription.ts` (НОВЫЙ),
  - `components/session-list.tsx` (+1 строка),
  - `components/session-detail.tsx` (+1 строка),
  - `package.json` (+socket.io-client).
  Другие — 0.
- **D-31** `apps/web/src/{app,components/ui,components/{conduct-controls,create-session-dialog,round-list,phase-badge}.tsx,store,lib/{api-client,types,utils}.ts,providers}/**`: 0 изменений.
- **D-32** `docs/`, `role-manifests/`, `prompts/`, `.planning/phases/08-http-api-gateway/`, `.planning/phases/08b-conducting-score-ui/`, `.planning/phases/08c-event-bus/8c-01-*.md`: 0 изменений.
- **D-33** Root config (`tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json`, `docker-compose.yml`): 0 изменений.

### Discipline

- **D-34** SUMMARY содержит evidence для каждого runtime-D (D-18..25). Multi-tab tests (D-24/25)
  с DOM-grep до/после. Без evidence = auto-FAIL.
- **D-35** Все процессы остановлены (api node + web next-dev + redis-cli subscriber если запускался).
  Порты 3000/3001/6380 свободны. PID + kill commands в SUMMARY.
- **D-36** SUMMARY честно описывает: WebSocket transport, queue+pub/sub параллельно, два экрана
  real-time. Никаких заявлений про "streaming LLM" или "ConfidenceRecalculated" (это Wave 8c+,
  UI готов но emiter'ов нет).

---

## 5. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-36 PASS (с evidence).
2. WebSocket connection web↔api установлен и работает.
3. Multi-tab test: mutation в одной вкладке → UI обновляется в другой БЕЗ manual refetch.
4. Pub/sub fanout: `redis-cli SUBSCRIBE` видит JSON events.
5. Regression Phase 5/6/7/8/8b/8c-1 green.
6. Anti-conflict: только разрешённые файлы.

**Фаза НЕ выполнена, если:**
- WS connection не устанавливается (D-20/23 FAIL).
- Multi-tab UI не обновляется без refetch (D-24/25 FAIL) — главный критерий.
- Pub/sub не работает (D-21 FAIL).
- Кодер тронул что-то вне разрешённых зон (D-26..33 FAIL).
- SUMMARY без DOM-evidence для multi-tab (D-34 FAIL).

---

## 6. Порядок работы кодера

1. **Прочитать PLAN.** Особенно §0.2 (queue+pub/sub архитектура), §1 поток события, §2.3
   EventsGateway, §3.2 useEventsSubscription, §4 D-24/25 (главный multi-tab test).
2. **Backend deps (D-01):** `pnpm --filter @orchestra/api add @nestjs/websockets @nestjs/platform-socket.io`.
3. **Backend pub/sub (D-02, D-03):** redis.config + redis-event-publisher (добавить pubsub
   connection + publish в channel).
4. **Backend gateway (D-04, D-05):** events.gateway.ts + module registration.
5. **Backend build:** `pnpm --filter @orchestra/api build`. Verify start (D-19).
6. **Frontend deps (D-07):** `pnpm --filter @orchestra/web add socket.io-client`.
7. **Frontend lib/hook (D-08, D-09):** socket.ts singleton, use-events-subscription.ts.
8. **Frontend integration (D-10, D-11):** +1 строка в session-list и session-detail.
9. **Build (D-12, D-13):** `pnpm -r typecheck && build`.
10. **Runtime verifier с УСИЛЕННЫМ evidence (D-18..25):**
    - D-18: docker compose up redis.
    - D-19: API start, copy-paste лога.
    - D-20: curl socket.io handshake.
    - D-21: redis-cli SUBSCRIBE + trigger mutation → JSON event.
    - D-22: web dev server start.
    - D-23: DevTools WS connection verification.
    - **D-24/25: multi-tab test (лично техлид) — DOM-grep до/после mutation.**
11. **Cleanup:** остановить все процессы, PID + kill commands.
12. **Regression (D-14..17):** 4 spec'а.
13. **Anti-conflict (D-26..33).**
14. **`8c-2-SUMMARY.md`** с evidence.

**Оценка:** ~1.5-2 дня (backend 0.5 + frontend 0.5 + verification с multi-tab debugging 0.5-1).

---

## 7. Design notes

1. **Queue + pub/sub параллельно, не выбор.** Queue (BullMQ) — persist/retry/DLQ для audit
   (Wave 8d) и background processing (Wave 8c-3). Pub/sub — low-latency fanout для real-time.
   Events публикуются в оба, каждый transport — своя ответственность.

2. **Отдельное Redis connection для pub/sub.** Redis constraint: одно connection не может
   одновременно `publish` и `subscribe`. Поэтому `RedisEventPublisher` имеет `this.pubsub`
   отдельно от `this.queue.connection`. `EventsGateway` имеет свой `this.subscriber`.

3. **socket.io, не raw ws.** NestJS-canon (`@nestjs/platform-socket.io`), robust reconnection,
   room-based broadcasting (future для session-scoped updates), fallback to polling. UI Canon §3
   явно говорит «WebSocket-стрим» — socket.io реализует WS transport.

4. **Singleton socket на клиента.** `getSocket()` возвращает один `Socket` instance на всё
   web-приложение. Если каждый компонент откроет connection — десятки WS на вкладку, server
   overload.

5. **TanStack Query integration через invalidate.** При event — `invalidateQueries(['session', id])`
   → TanStack автоматически refetch → UI обновляется. Альтернатива — `setQueryData` с payload
   event, но это требует от UI понимать как инкрементально применить event к state. Invalidate
   проще, надёжнее (server = source of truth), canonical для TanStack + real-time.

6. **session-scoped filter в useEventsSubscription.** SessionDetail подписывается с
   `sessionIdFilter = id` — обрабатывает только events для своей сессии (не нагружаем
   re-render другими сессиями). SessionList — без filter (любой event меняет list).

7. **CORS уже работает (Phase 8).** `main.ts: enableCors({origin:true, credentials:true})`.
   WebSocketGateway тоже нужно cors — NestJS требует отдельно для WS. Дублируем конфиг.

8. **Socket.io `transports: ['websocket']`.** Без long-polling fallback — для dev проще.
   В production с reverse-proxy возможно нужно добавить polling fallback, но не сейчас.

9. **Не делаем SessionCreated.** GsdEngine (Phase 6) публикует только 3 типа. SessionCreated
   нет (Wave 8c-4 D-8c-4). Поэтому list-real-time (D-25) проверяется через PhaseChanged:
   advance доводит до transitioned → PhaseBadge в списке обновляется.

10. **Multi-tab test — самый сложный verifier.** После 5 пойманных нарушений audit-trail —
    D-24/25 с DOM-grep лично техлидом. Открывает 2 вкладки, mutation в одной, DOM-grep в другой.
    Если UI не real-time — D-24/25 FAIL, никакая curl-симуляция не поможет.

11. **Reconnection handling.** socket.io v4 автоматически реконнектит с backoff. UI при
    disconnect — TanStack Query продолжает с stale data + background refetch. При reconnect —
    catch-up через refetch (не event replay, это Wave 8d+).

---

## 8. Долги, которые фаза ЗАКРЫВАЕТ

- **D-H2 / D-8c-2** WebSocket/SSE real-time — UI обновляется без refetch при событиях.
- **Косвенно D-8b-2** UI Canon §3 Continuous Consensus display — теперь технически возможен
  (когда появятся ConfidenceRecalculated events).

## 9. Долги, которые фаза ОТКРЫВАЕТ

- **D-8c-2-1** ConfidenceRecalculated — UI готов, emiter'а (Consensus) нет.
- **D-8c-2-2** Reconnect/backoff tuning для production — сейчас socket.io default.
- **D-8c-2-3** Auth на WS — публичный, D-H1 Wave 8+.
- **D-8c-1** BullMQ Worker/consumer — Wave 8c-3 (ОТДЕЛЬНО от pub/sub).
- **D-8c-3** Decision Repository persist — Wave 8d.
- **D-8c-4** Расширить DomainEvent до 11 типов — SessionCreated и др.
- **D-8c-5** Event replay / Engineering Time Machine — Wave 8d+.

---

## 10. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| socket.io-client в SSR (Next.js server components) падает | средняя | `'use client'` в socket.ts и use-events-subscription. Singleton только в browser (через `typeof window !== 'undefined'` проверку) |
| WS connection не проходит через корпоративный firewall | низкая (dev) | `transports: ['websocket']` → fallback добавить если нужно. Для dev localhost — не проблема |
| NestJS WS gateway конфликтует с existing Express adapter | низкая | `@WebSocketGateway()` работает поверх того же HTTP server (socket.io attach). Не нужен отдельный порт |
| Pub/sub сообщение теряется если gateway ещё не подписан при publish | низкая | Gateway подписывается в `OnModuleInit`, publisher срабатывает на user-action ( после init). Race unlikely. Для 100% гарантии — event replay (Wave 8d) |
| Открывается много WS connections (singleton сломан) | средняя | Code review проверит singleton. Если компонент рендерится в двух экземплярах — useEffect cleanup + singleton-share решают |
| Multi-tab test сложно доказать через evidence-rule | высокая | D-24/25 — техлид верифицирует лично. Кодер описывает DOM-grep до/после, но финальный вердикт — техлид открывает 2 вкладки |
| Socket.io protocol mismatch (server v4, client v3) | низкая | Deps: ^4 on both. Code review проверит. |
| Cleanup processes after verification (8-03 precedent) | средняя | D-35 — формальный критерий, PID + kill commands |

---

## 11. Что получает Orchestra после Phase 8c-2

**Real-time Conducting Score UI MVP.** Любое действие в одной вкладке мгновенно отражается
во всех других. Conductor может открыть SessionDetail в двух вкладках — изменения видны сразу.
SessionList в одной вкладке — advance в другой → PhaseBadge обновляется.

**Фундамент для:**
1. **UI Canon §3 Continuous Consensus display** (когда появятся ConfidenceRecalculated events).
2. **Multi-user collaboration** (несколько дирижёров одновременно) — Wave 8+ с auth.
3. **Streaming LLM responses** (Wave 8c+ для Conducting Score дорожек ролей).
4. **Live notifications** (через WS вместо polling).

**Phase 8c-2 = Orchestra Conducting Score оживает.** Static UI Phase 8b → reactive UI.

---

**Конец PLAN 8c-2.** Ждёт `/gsd-execute-phase 8c.2` (mimo) → `/gsd-validate-phase 8c.2`.
После PASS — README-CONTRACT-PHASE-8c-2.md → Wave 8c-2 закрыта.
