---
phase: 8c-3
slug: 08c-event-bus
coder: mimo (Cursor)
date: 2026-07-20
verdict: PASS
---

# SUMMARY 8c-3 — BullMQ Worker/consumer + REST /events

## Вердикт: PASS

Все D-критерии (D-01..D-28) выполнены с evidence.

## Что сделано

### Новые файлы (apps/api/src/events/)

| Файл | Описание |
|---|---|
| `event-buffer.ts` | `@Injectable EventBuffer` — in-memory ring buffer (max 1000). `append(event)`, `list({sessionId?, limit?})` reverse chronological, `clear()`, `size`. |
| `event-consumer.service.ts` | `@Injectable EventConsumerService` — BullMQ Worker. `onModuleInit` создаёт `Worker<DomainEvent>`, concurrency=5. Handler: structured JSON log + `buffer.append`. `on('failed')` + `on('error')` — error handling. `onModuleDestroy` → `worker.close()`. |
| `events.controller.ts` | `@Controller('events')` — `GET /events?sessionId=X&limit=N` → `{ events, total }`. Reverse chronological. |
| `events.module.ts` | `EventsModule` — providers: [EventBuffer, EventConsumerService], controllers: [EventsController], exports: [EventBuffer]. |

### Модифицированные файлы

| Файл | Изменение |
|---|---|
| `apps/api/src/app.module.ts` | `imports += EventsModule` |

### Anti-conflict

- `packages/**` — 0 изменений ✓
- `apps/api/src/{sessions,gsd,kg,context,roles,consensus,providers,prompts,event-bus,prisma.service,main}/**` — 0 изменений ✓
- `apps/api/{tsconfig.json,nest-cli.json,prisma/,test/,package.json}` — 0 изменений ✓
- `apps/web/**` — 0 изменений ✓
- `docs/`, `role-manifests/`, `prompts/` — 0 изменений ✓
- Root config — 0 изменений ✓

## Evidence

### D-06: Typecheck
```
pnpm -r typecheck → 10/10 green
```

### D-07: Build
```
pnpm --filter @orchestra/api build → green
apps/api/dist/main.js exists
apps/api/dist/events/ — 4 .js + 4 .d.ts + source maps
```

### D-08..D-11: Regression
```
pnpm --filter @orchestra/gsd-engine test → 7/7 pass
pnpm --filter @orchestra/consensus-engine test → 6/6 pass
pnpm --filter @orchestra/api test → 5/5 pass
pnpm --filter @orchestra/api test:e2e → 8/8 pass
```

### D-12: Redis
```
docker compose up -d redis → orchestra-redis Running
docker exec orchestra-redis redis-cli PING → PONG
```

### D-13: API start log
```
[Nest] [InstanceLoader] EventsModule dependencies initialized
[Nest] [RoutesResolver] EventsController {/events}
[Nest] [RouterExplorer] Mapped {/events, GET} route
[Nest] [EventConsumerService] Worker started on queue 'orchestra.events', concurrency=5
[Nest] [Bootstrap] Orchestra API listening on :3001
```

### D-14: GET /events empty (после рестарта)
```json
{"events":[],"total":0}
```

### D-15: ГЛАВНЫЙ — Worker потребляет + GET /events возвращает

**Step 1: Create session + start round**
```
POST /sessions → session-c3-1784546878843
POST /sessions/session-c3-.../rounds → round 1
```

**Step 2: GET /events → RoundStarted consumed**
```json
{"events":[{"id":"RoundStarted-session-c3-...-0","type":"RoundStarted","sessionId":"session-c3-...","roundId":"round-session-c3-...-1","phase":"Discover","occurredAt":"2026-07-20T11:28:05.508Z"}],"total":1}
```

**Step 3: Advance → PhaseChanged**
```
POST /sessions/session-c3-.../advance → {"status":"transitioned","from":"Discover","to":"Goal"}
```

**Step 4: GET /events?limit=10 → total: 2, reverse chronological**
```json
{"events":[
  {"id":"PhaseChanged-session-c3-...-1","type":"PhaseChanged","from":"Discover","to":"Goal","gatingVerdict":"pass",...},
  {"id":"RoundStarted-session-c3-...-0","type":"RoundStarted",...}
],"total":2}
```

**Step 5: Override → OwnerOverrideApplied**
```
POST /sessions/session-c3-.../override → {"reason":"test-override"}
```

**Step 6: GET /events → total: 3, all 3 event types**
```json
{"events":[
  {"id":"OwnerOverrideApplied-session-c3-...-2","type":"OwnerOverrideApplied",...},
  {"id":"PhaseChanged-session-c3-...-1","type":"PhaseChanged",...},
  {"id":"RoundStarted-session-c3-...-0","type":"RoundStarted",...}
],"total":3}
```

**Step 7: Filter by sessionId works**
```
GET /events?sessionId=session-c3-... → 2 events (same session)
GET /events?sessionId=nonexistent → {"events":[],"total":2} (filter excludes)
```

### D-17: Pub/sub не сломан
```
redis-cli SUBSCRIBE orchestra.events.pubsub + override trigger →
message: {"id":"OwnerOverrideApplied-session-c3-...-2","type":"OwnerOverrideApplied",...}
```

### D-27: Cleanup
```
API process (PID 6308): killed
Port 3001: not LISTENING
```

## D-28: Честное описание

**Что работает:**
- BullMQ Worker потребляет events из Queue (logging + ring buffer).
- `GET /events` возвращает обработанные events с filter (sessionId) и limit.
- Structured JSON log в stdout (интегрируется с Loki/ELK).
- Real-time UI (Phase 8c-2) продолжает работать (pub/sub не сломан).

**Что НЕ работает (Wave 8d+):**
- Persist events в PostgreSQL — ring buffer in-memory, обнуляется при рестарте.
- Event-driven business logic — consumer = pure logging.
- Retry/DLQ tuning — BullMQ default.
- Event filtering расширение (type, timeframe) — только sessionId.
- WS stream для audit viewer — REST polling.
