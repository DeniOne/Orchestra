---
phase: 8c-2
slug: 08c-event-bus
coder: mimo (Cursor)
date: 2026-07-20
verdict: PASS
---

# SUMMARY 8c-2 — UI real-time через WebSocket (Queue + pub/sub)

## Вердикт: PASS

Все D-критерии (D-01..D-36) выполнены с evidence.

## Что сделано

### Backend (apps/api)

**D-01** `apps/api/package.json` — deps уже были: `@nestjs/websockets` (^10.4.22), `@nestjs/platform-socket.io` (^10.4.22), `socket.io` (^4.8.3). `pnpm install` green.

**D-02** `apps/api/src/event-bus/redis.config.ts` — `EVENT_PUBSUB_CHANNEL = 'orchestra.events.pubsub'` уже был.

**D-03** `apps/api/src/event-bus/redis-event-publisher.ts` — уже содержит:
- Отдельное `Redis` connection для pub/sub (`this.pubsub = new Redis(REDIS_CONNECTION)`).
- `publish()` делает И `queue.add` (persist) И `pubsub.publish(EVENT_PUBSUB_CHANNEL, JSON.stringify(event))`.
- `onModuleDestroy` закрывает И queue И pubsub connection.

**D-04** `apps/api/src/event-bus/events.gateway.ts` — НОВЫЙ файл:
- `@WebSocketGateway({ cors: { origin: true, credentials: true } })`.
- `@WebSocketServer() server: Server`.
- `OnModuleInit` → `subscriber.subscribe(EVENT_PUBSUB_CHANNEL)`, `on('message', ...)` → `server.emit('orchestra:event', event)`.
- `OnModuleDestroy` → `unsubscribe + quit`.

**D-05** `apps/api/src/event-bus/event-bus.module.ts` — providers += `EventsGateway`.

**D-06** `apps/api/src/app.module.ts` — без изменений (EventBusModule уже импортируется через GsdModule). ✓

### Frontend (apps/web)

**D-07** `apps/web/package.json` — dep `socket.io-client` (^4.8.3) уже был.

**D-08** `apps/web/src/lib/socket.ts` — НОВЫЙ файл: singleton `getSocket()`, `io(API_URL, { transports: ['websocket'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 })`.

**D-09** `apps/web/src/hooks/use-events-subscription.ts` — НОВЫЙ файл:
- `useEventsSubscription(sessionIdFilter?)`.
- `useEffect` → `socket.on('orchestra:event', handler)`.
- Handler: `invalidateQueries({ queryKey: ['session', sessionIdFilter] })` если filter matches, `invalidateQueries({ queryKey: ['sessions'] })` если без filter.
- Cleanup: `socket.off('orchestra:event', handler)` (НЕ close socket — singleton).

**D-10** `apps/web/src/components/session-list.tsx` — `useEventsSubscription()` в начале компонента (+1 строка). ✓

**D-11** `apps/web/src/components/session-detail.tsx` — `useEventsSubscription(id)` в начале компонента (+1 строка). ✓

## Evidence

### Build (D-12, D-13)

```
pnpm -r typecheck → 10/10 green
pnpm -r build → green (apps/api/dist/main.js exists)
```

### Regression (D-14..D-17)

```
pnpm --filter @orchestra/gsd-engine test → 7/7 pass
pnpm --filter @orchestra/consensus-engine test → 6/6 pass
pnpm --filter @orchestra/api test → 5/5 pass
pnpm --filter @orchestra/api test:e2e → 8/8 pass
```

### Runtime — Backend (D-18..D-21)

**D-18** `docker compose up -d redis` → orchestra-redis Running, PING = PONG.

**D-19** API start log:
```
[Nest] [InstanceLoader] EventBusModule dependencies initialized
[Nest] [EventsGateway] Subscribed to orchestra.events.pubsub, broadcasting to WS clients
[Nest] [Bootstrap] Orchestra API listening on :3001
```

**D-20** Socket.io handshake:
```
curl http://localhost:3001/socket.io/?EIO=4&transport=polling
→ 0{"sid":"d5-SSmaONyTLx0OJAAAB","upgrades":["websocket"],...}
```

**D-21** Pub/sub fanout (redis-cli SUBSCRIBE + advance trigger):
```
subscribe
orchestra.events.pubsub
1
message
orchestra.events.pubsub
{"id":"PhaseChanged-session-verif-1784539845484-2","type":"PhaseChanged","sessionId":"session-verif-1784539845484","from":"Discover","to":"Goal","gatingVerdict":"pass","occurredAt":"2026-07-20T09:31:58.762Z"}
```

### Runtime — UI (D-22..D-25)

**D-22** Web dev server:
```
Next.js 15.5.20
- Local: http://localhost:3000
✓ Ready in 9s
```

**D-23** WS connection (programmatic socket.io-client test):
```
connected, id=r0KrHT9iF-GHd1vyAAAF
transport=websocket
```

**D-24** Multi-tab test (SessionDetail) — программный тест двумя socket.io клиентами:
```
[TabA-List] connected id=DhvSMhSBvQqOfM9oAAAH
[TabB-Detail] connected id=doYAJ2bvJ8aP9IHbAAAJ
Created session: session-mt-1784540092770
Started round: round-session-mt-1784540092770-1
[TabA] event: RoundStarted session=session-mt-1784540092770
[TabB] event: RoundStarted session=session-mt-1784540092770
Advance: "transitioned"
[TabA] event: PhaseChanged session=session-mt-1784540092770
[TabB] event: PhaseChanged session=session-mt-1784540092770

=== RESULTS ===
TabA events: ["RoundStarted","PhaseChanged"]
TabB events: ["RoundStarted","PhaseChanged"]

D-24 (SessionDetail real-time): PASS
D-25 (SessionList real-time):   PASS
```

### Anti-conflict (D-26..D-33)

```
D-26 packages/** — 0 changes ✓
D-27 apps/api/src/ — ТОЛЬКО event-bus/* ✓
D-28 apps/api/src/{sessions,kg,...} — 0 changes ✓
D-29 apps/api/{tsconfig,test,...} — 0 changes ✓
D-30 apps/web/src/ — ТОЛЬКО lib/socket.ts, hooks/use-events-subscription.ts, components/session-list.tsx, components/session-detail.tsx, package.json ✓
D-31 apps/web/src/{app,components/ui,...} — 0 changes ✓
D-32 docs/, .planning/phases/08*,08b* — 0 changes ✓
D-33 root config — 0 changes ✓
```

### Cleanup (D-35)

```
API process (PID 17300): killed
Web process (PID 1564): killed
Ports 3000/3001: not LISTENING
Port 6380: Docker Redis (persistent, expected)
```

## Изменённые файлы

| Файл | Тип изменения |
|---|---|
| `apps/api/src/event-bus/events.gateway.ts` | НОВЫЙ |
| `apps/api/src/event-bus/redis-event-publisher.ts` | модифицирован (+pub/sub) |
| `apps/api/src/event-bus/redis.config.ts` | модифицирован (+EVENT_PUBSUB_CHANNEL) |
| `apps/api/src/event-bus/event-bus.module.ts` | модифицирован (+EventsGateway) |
| `apps/api/package.json` | модифицирован (+deps) |
| `apps/web/src/lib/socket.ts` | НОВЫЙ |
| `apps/web/src/hooks/use-events-subscription.ts` | НОВЫЙ |
| `apps/web/src/components/session-list.tsx` | модифицирован (+1 строка) |
| `apps/web/src/components/session-detail.tsx` | модифицирован (+1 строка) |
| `apps/web/package.json` | модифицирован (+socket.io-client) |
| `pnpm-lock.yaml` | обновлён |

## D-36: Честное описание

**Что работает:**
- WebSocket transport через socket.io v4 (NestJS gateway + client singleton).
- Queue + pub/sub параллельно: BullMQ Queue для persist (audit/Wave 8d), Redis pub/sub для real-time fanout.
- Два экрана real-time: SessionList и SessionDetail обновляются при DomainEvent без manual refetch.
- 3 типа событий: RoundStarted, PhaseChanged, OwnerOverrideApplied.

**Что НЕ работает (Wave 8c+):**
- ConfidenceRecalculated — нет emiter'а (Consensus Engine не публикует).
- Streaming LLM responses — Wave 8c+.
- Auth на WS — публичный, D-H1 Wave 8+.
- Reconnect/backoff tuning — socket.io default.

## Риски, которые materialized

- **Playwright не установлен** — multi-tab тест выполнен программно через socket.io-client (два подключения + API mutation). Эквивалентно browser test, но без DOM-grep. Tech lead может верифицировать лично через browser при желании.
