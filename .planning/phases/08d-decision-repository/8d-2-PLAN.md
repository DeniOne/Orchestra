---
phase: 8d.2
slug: 08d-decision-repository
wave: B-8
title: "SessionStore persistence — PrismaSessionStore implements SessionStorePort, сессии переживают рестарт API"
milestone: "Orchestra MVP — Wave 8d (Decision Repository → SessionStore persistence)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-22
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build) + migration-gate (prisma migrate dev green) + runtime-gate (live: create session → stop API → start API → GET /sessions → session still there, с УСИЛЕННЫМ evidence-rule §0.2) + regression-gate (Phase 5/6/7/8/8b/8c/8d-1 spec'и green)
baseline_before: "Phase 8d-1 PASS (commit f9e7f29): DomainEvents persist в PostgreSQL. Но сессии (InMemorySessionStore) всё ещё теряются при рестарте. GsdEngineService хардкодит new InMemorySessionStore(). knownSessionIds Set — обходной путь для listSessions, тоже теряется при рестарте. Phase 8d-2 = PrismaSessionStore, сессии долговременные."
depends_on:
  - "Phase 8d-1 (f9e7f29) — PostgreSQL в docker-compose, PrismaService, DATABASE_URL"
  - "Phase 6 — SessionStorePort interface (packages/gsd-engine/src/types.ts), GsdEngineOptions.store"
  - "@orchestra/domain session.ts — Session/Round типы"
closes_debts:
  - "D-8d-1 SessionStore persistence (InMemory → Prisma) — Phase 8d-2 закрывает."
  - "D-F1 Prisma persistence — полностью закрывается (events в 8d-1, sessions в 8d-2)."
  - "knownSessionIds Set в GsdEngineService становится не нужен — listSessions читает из БД."
opens_debts_expected:
  - "D-8d-2-1: PrismaSessionStore connection pooling для production load — сейчас 1 PrismaClient instance."
  - "D-8d-2-2: Session lister pagination (когда > 100 сессий) — сейчас findMany без limit."
  - "D-8d-2-3: AuditLog persistence (InMemoryAuditLog → Prisma) — пока in-memory, отдельная фаза."
---

# PLAN 8d-2 — SessionStore persistence (PrismaSessionStore)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8d-2-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **EVIDENCE-RULE (УСИЛЕННЫЙ, доказан 5 раз — 8b-02..8d-1):** для каждого runtime-D явно указан
> тип evidence. Главный D-22 — persistence survives restart (create → stop → start → GET).
>
> **ПРОЦЕСС-НОТА (8d-1 precedent):** Если кодер зависает на PowerShell runtime-тестах, owner
> может санкционировать self-execute. Техлид рекомендует сразу Git Bash + verification script.

## 0. Контекст

### 0.1. Что есть сейчас

**Phase 8d-1 (PASS, `f9e7f29`)**: DomainEvents persist'ятся в PostgreSQL (`DomainEventRecord`).
Postgres в docker-compose (port 5433), PrismaService работает. Events переживают рестарт API.

**Но сессии — in-memory.** `GsdEngineService`:
```typescript
private readonly store: SessionStorePort = new InMemorySessionStore();
private readonly knownSessionIds = new Set<SessionId>();  // workaround для listSessions
```
При рестарте API — сессии и knownSessionIds **обнуляются**. UI показывает пустой SessionList.
Events в БД есть, но привязки к сессии нет (session не существует).

**Архитектурный hook (Phase 6):** `GsdEngine` constructor принимает `store?: SessionStorePort`:
```typescript
this.store = options.store ?? new InMemorySessionStore();
```
→ можно подсунуть `PrismaSessionStore` **без правки packages/gsd-engine** (D-26 anti-conflict).
Идеальный hexagonal port — domain не знает про Prisma, app предоставляет adapter.

### 0.2. Что делает Phase 8d-2

**PrismaSessionStore implements SessionStorePort.** Сессии persist'ятся в PostgreSQL, переживают
рестарт. `knownSessionIds` Set удаляется — `listSessions()` читает из БД.

- ✅ Prisma schema: `model SessionRecord` (embedded rounds как Json — как DomainEventRecord payload).
- ✅ `PrismaSessionStore implements SessionStorePort` (create/get/update/listRounds через Prisma).
- ✅ `GsdEngineService` — DI `PrismaSessionStore` вместо hardcoded `new InMemorySessionStore()`.
- ✅ `listSessions()` — читает из БД (через PrismaSessionStore или prisma.findMany).
- ✅ `knownSessionIds` Set **удаляется** (больше не нужен).
- ✅ **Persistence survives restart** — после рестарта API сессии доступны.

**НЕ в scope:**
- **AuditLog persistence** (InMemoryAuditLog → Prisma) — отдельная фаза (D-8d-2-3).
- **Approvals persistence** (`private readonly approvals = new Map()` в GsdEngine) — GsdEngine
  internal state, требует правки packages/gsd-engine. Wave 8d+.
- **SessionStore rollback/cleanup** (TTL старых сессий) — D-8d-2-2 pagination/retention.
- **Migration existing in-memory sessions** — не делаем (dev sessions не критичны).

### 0.3. Архитектурное решение: Session.rounds embedded как Json

**Проблема:** `Session` содержит `rounds: Round[]` (embedded array). В реляционной БД это:
- **Вариант A:** Отдельная table `RoundRecord` с FK на Session. Нормализованная схема, но при
  каждом `store.get(sessionId)` нужно JOIN или второй query для rounds.
- **Вариант B:** `rounds Json` в SessionRecord (как payload в DomainEventRecord). Embedded array.
  Один query, no JOIN. Trivial mapping Session ↔ record.

**Решение: Вариант B (rounds Json).** Соответствует pattern из 8d-1 (payload Json). Session —
aggregate root, rounds — его embedded collection. Нет separate round-identity lifecycle outside
session. Проще, быстрее (1 query vs 2), canonical для document-style в реляционной БД.

> Кодер: `Session` → `SessionRecord` mapping тривиальный. `rounds: Round[]` ↔ `rounds: Json`
> через `as unknown as Round[]` cast (type-safe, Prisma Json возвращает any).

### 0.4. Dual-write vs full switch

**Выбор: full switch (не dual-write).** Причина:
- SessionStore — **critical-path** (create/get/update дёргаются при каждом GSD operation).
  Dual-write = 2x latency на каждый запрос.
- В отличие от events (best-effort), sessions — **обязательные** данные. Без сессии GSD не работает.
- При БД-down → API валидно падает на first session operation (понятная ошибка), не продолжает
  с in-memory сессиями которые потом потеряются (inconsistency).

> В 8d-1 events dual-write был оправдан (events не critical-path, buffer = fast cache). Для
> sessions dual-write создаёт inconsistency. Full switch = clean.

### 0.5. Что НЕ меняется

- `packages/**` — НЕ ТРОГАТЬ (D-26). SessionStorePort уже есть (Phase 6), InMemorySessionStore
  остаётся в packages для тестов/spec'ов.
- `apps/api/src/{sessions,kg,context,roles,consensus,providers,prompts,event-bus,events,prisma.service,main,app.module}.ts`:
  изменения ТОЛЬКО в `gsd/` (см. §2).
- `apps/api/src/gsd/{gsd-engine.ts-в-package,round-orchestrator-gating.adapter,objective-seed.service}.ts`:
  НЕ ТРОГАТЬ (Phase 6/7).
- `apps/web/**`, `docs/`, `role-manifests/`, `prompts/` — НЕ ТРОГАТЬ.
- `docker-compose.yml` — НЕ ТРОГАТЬ (Postgres уже в 8d-1).

**Единственные изменения:**
- `apps/api/prisma/schema.prisma` — +model SessionRecord.
- `apps/api/prisma/migrations/<ts>_add_sessions/` — НОВАЯ миграция.
- `apps/api/src/gsd/prisma-session-store.ts` — НОВЫЙ adapter.
- `apps/api/src/gsd/gsd-engine.service.ts` — ИЗМЕНИТЬ: DI PrismaSessionStore, убрать knownSessionIds.
- `apps/api/src/gsd/gsd.module.ts` — ИЗМЕНИТЬ: providers += PrismaSessionStore, PrismaService.

---

## 1. Архитектура

### 1.1. Поток после Phase 8d-2

```
HTTP POST /sessions -d '{name, projectId}'
  ↓
SessionsController.createSession → GsdEngineService.startSession
  ↓
GsdEngine.startSession → store.create(session)
  ↓
PrismaSessionStore.create(session)         ← НОВОЕ (вместо InMemorySessionStore)
  ↓
prisma.sessionRecord.create({id, name, ..., rounds: []})
  ↓
PostgreSQL SessionRecord table              ← НОВОЕ

HTTP GET /sessions (после рестарта API)
  ↓
SessionsController.listSessions → GsdEngineService.listSessions
  ↓
prisma.sessionRecord.findMany()             ← НОВОЕ (вместо knownSessionIds Set)
  ↓
Returns Session[] — persisted, survives restart ✅
```

### 1.2. Структура файлов

```
apps/api/
├── prisma/
│   ├── schema.prisma                                  # ИЗМЕНИТЬ: +model SessionRecord
│   └── migrations/<ts>_add_sessions/                  # НОВОЕ: migration SQL
└── src/gsd/
    ├── prisma-session-store.ts                        # НОВЫЙ: PrismaSessionStore
    ├── gsd-engine.service.ts                          # ИЗМЕНИТЬ: DI store, remove knownSessionIds
    └── gsd.module.ts                                  # ИЗМЕНИТЬ: +PrismaSessionStore, PrismaService providers
```

---

## 2. Backend

### 2.1. `schema.prisma` — +SessionRecord

```prisma
model SessionRecord {
  id           String   @id           // = Session.id (не auto-gen)
  name         String
  projectId    String
  currentPhase String                 // GSDPhase as string (enum в БД требует отдельной Prisma enum, string проще)
  rounds       Json                   // Round[] embedded (как payload в DomainEventRecord)
  createdAt    DateTime
  updatedAt    DateTime

  @@index([projectId])
  @@index([currentPhase])
  @@index([updatedAt])
}
```

**Ключевые моменты:**
- `id String @id` (без @default) — Session.id генерит GsdEngine.
- `currentPhase String` — GSDPhase это TS union type, в БД храним как string (extensible для
  новых фаз без Prisma enum migration). Mapping при read: `record.currentPhase as GSDPhase`.
- `rounds Json` — Round[] embedded. Pattern как DomainEventRecord.payload (8d-1).
- `createdAt/updatedAt` — DateTime, **без @default**. Session уже содержит эти поля (генерит
  GsdEngine), храним как есть (не перегенерируем).

### 2.2. `prisma-session-store.ts` — НОВЫЙ adapter

```typescript
import { Injectable, Logger } from '@nestjs/common';
import type { Session, SessionId, Round } from '@orchestra/domain';
import type { GSDPhase } from '@orchestra/domain';
import type { SessionStorePort } from '@orchestra/gsd-engine';
import { PrismaService } from '../prisma.service.js';
import type { Prisma } from '@prisma/client';

/**
 * Prisma-backed impl of SessionStorePort.
 *
 * Заменяет InMemorySessionStore в GsdEngineService. Сессии persist'ятся в PostgreSQL, переживают
 * рестарт API. Соответствует Architecture §3 Decision Repository = PostgreSQL.
 *
 * Полный switch (не dual-write): SessionStore — critical-path GSD. Dual-write = inconsistency
 * risk. При БД-down API валидно падает на session operation (понятная ошибка, не silent loss).
 *
 * rounds хранятся как embedded Json (aggregate root pattern), не separate table. Соответствует
 * DomainEventRecord.payload pattern (Phase 8d-1).
 */
@Injectable()
export class PrismaSessionStore implements SessionStorePort {
  private readonly logger = new Logger(PrismaSessionStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(session: Session): Promise<void> {
    await this.prisma.sessionRecord.create({
      data: {
        id: session.id,
        name: session.name,
        projectId: session.projectId,
        currentPhase: session.currentPhase,
        rounds: session.rounds as unknown as Prisma.InputJsonValue,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      },
    });
  }

  async get(sessionId: SessionId): Promise<Session | null> {
    const record = await this.prisma.sessionRecord.findUnique({
      where: { id: sessionId },
    });
    if (!record) return null;
    return this.toSession(record);
  }

  async update(session: Session): Promise<void> {
    await this.prisma.sessionRecord.update({
      where: { id: session.id },
      data: {
        name: session.name,
        projectId: session.projectId,
        currentPhase: session.currentPhase,
        rounds: session.rounds as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(session.updatedAt),
      },
    });
  }

  async listRounds(sessionId: SessionId): Promise<Round[]> {
    const record = await this.prisma.sessionRecord.findUnique({
      where: { id: sessionId },
      select: { rounds: true },
    });
    return record ? (record.rounds as unknown as Round[]) : [];
  }

  /**
   * Список всех сессий (для listSessions в GsdEngineService).
   * Заменяет knownSessionIds Set workaround из Phase 8b-02.
   */
  async list(): Promise<Session[]> {
    const records = await this.prisma.sessionRecord.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((r) => this.toSession(r));
  }

  private toSession(record: {
    id: string;
    name: string;
    projectId: string;
    currentPhase: string;
    rounds: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): Session {
    return {
      id: record.id,
      name: record.name,
      projectId: record.projectId,
      currentPhase: record.currentPhase as GSDPhase,
      rounds: record.rounds as unknown as Round[],
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
```

**Ключевые моменты:**
- `implements SessionStorePort` — 4 метода interface + `list()` (extension для listSessions).
- `toSession` — mapping record → Session domain type. `currentPhase as GSDPhase` cast.
- `rounds as unknown as Prisma.InputJsonValue` / `as unknown as Round[]` — Json ↔ Round[].
- `list()` — НЕ часть SessionStorePort (port only per-session), но extension для GsdEngineService.
  Технически — public method на adapter, вне port contract.

### 2.3. `gsd-engine.service.ts` — DI store, remove knownSessionIds

**Изменения:**
1. Убрать `import { InMemorySessionStore }` (больше не используется в сервисе).
2. Добавить `import { PrismaSessionStore } from './prisma-session-store.js'`.
3. Убрать `private readonly store: SessionStorePort = new InMemorySessionStore();` (hardcoded).
4. Добавить `constructor(..., private readonly store: PrismaSessionStore)` (DI).
5. Убрать `private readonly knownSessionIds = new Set<SessionId>();`.
6. В `startSession` убрать `this.knownSessionIds.add(session.id);`.
7. `listSessions` — переписать: `return this.store.list();` (вместо knownSessionIds loop).

```typescript
import { Injectable } from '@nestjs/common';
import { GsdEngine, InMemoryAuditLog } from '@orchestra/gsd-engine';
import type { AdvancePhaseResult, SessionStorePort } from '@orchestra/gsd-engine';
import type { Session, Round, SessionId } from '@orchestra/domain';
import { ContextService } from '../context/context.service.js';
import { RoleRouterService } from '../roles/role-router.service.js';
import { ConsensusService } from '../consensus/consensus.service.js';
import { ManifestLoaderAdapter } from '../roles/manifest-loader.adapter.js';
import { RoundOrchestratorGatingAdapter } from './round-orchestrator-gating.adapter.js';
import { RedisEventPublisher } from '../event-bus/redis-event-publisher.js';
import { PrismaSessionStore } from './prisma-session-store.js';

@Injectable()
export class GsdEngineService {
  private readonly audit = new InMemoryAuditLog();
  private readonly engine: GsdEngine;

  constructor(
    private readonly context: ContextService,
    private readonly router: RoleRouterService,
    private readonly consensus: ConsensusService,
    private readonly roles: ManifestLoaderAdapter,
    private readonly publisher: RedisEventPublisher,
    private readonly store: PrismaSessionStore,  // ← НОВОЕ: DI вместо hardcoded InMemory
  ) {
    const gating = new RoundOrchestratorGatingAdapter(context, router, consensus, roles, this.store);
    this.engine = new GsdEngine({
      store: this.store,
      gating,
      audit: this.audit,
      events: this.publisher,
    });
  }

  async startSession(name: string, projectId: string): Promise<Session> {
    return this.engine.startSession({ name, projectId });
    // knownSessionIds.add убран — listSessions теперь из БД
  }

  // ... startRound, advancePhase, approveTransition, overrideGate, getSession, listRounds без изменений ...

  async listSessions(): Promise<Session[]> {
    return this.store.list();  // ← НОВОЕ: из БД, не knownSessionIds Set
  }
}
```

> **Кодер:** `SessionStorePort` import type остаётся (type-only, для RoundOrchestratorGatingAdapter
> constructor). Но в `private readonly store` тип `PrismaSessionStore` (concrete, для `list()`).
> GsdEngine получает `store: this.store` — PrismaSessionStore implements SessionStorePort, так
> что GsdEngine видит его как SessionStorePort (port contract).

### 2.4. `gsd.module.ts` — providers

```typescript
import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { ContextModule } from '../context/context.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { EventBusModule } from '../event-bus/event-bus.module.js';
import { PrismaService } from '../prisma.service.js';
import { PrismaSessionStore } from './prisma-session-store.js';
import { GsdEngineService } from './gsd-engine.service.js';
import { ObjectiveSeedService } from './objective-seed.service.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule, EventBusModule],
  // RoundOrchestratorGatingAdapter убран из providers: ... (существующий comment)
  providers: [PrismaService, PrismaSessionStore, GsdEngineService, ObjectiveSeedService],
  exports: [GsdEngineService],
})
export class GsdModule {}
```

> **PrismaService** добавлен в providers (KgModule уже имеет свой instance, но GsdModule нужен
> свой для PrismaSessionStore). NestJS DI создаст новый PrismaClient instance. Не идеально
> (3 instances: Kg, Events, Gsd), но `@Global() PrismaService` refactor — отдельная задача,
> не трогаем prisma.service.ts.

---

## 3. must_haves.truths (D-критерии)

### Prisma

- **D-01** `apps/api/prisma/schema.prisma` содержит `model SessionRecord`:
  - `id String @id` (без @default).
  - `name String`, `projectId String`, `currentPhase String`, `rounds Json`.
  - `createdAt DateTime`, `updatedAt DateTime` (без @default).
  - `@@index([projectId])`, `@@index([currentPhase])`, `@@index([updatedAt])`.
- **D-02** `prisma migrate dev --name add_sessions` создал миграцию + применена.
  Evidence: copy-paste вывода.

### Backend code

- **D-03** `apps/api/src/gsd/prisma-session-store.ts` НОВЫЙ:
  - `@Injectable PrismaSessionStore implements SessionStorePort`.
  - constructor `PrismaService` DI.
  - `create`, `get`, `update`, `listRounds` — через prisma.sessionRecord.
  - `list()` — extension для listSessions (findMany orderBy updatedAt desc).
  - `toSession` mapping (record → Session, currentPhase as GSDPhase cast).
- **D-04** `apps/api/src/gsd/gsd-engine.service.ts`:
  - Убран `import { InMemorySessionStore }`.
  - Убран `private readonly knownSessionIds = new Set<SessionId>()`.
  - Constructor += `private readonly store: PrismaSessionStore` (DI).
  - `startSession` — убран `this.knownSessionIds.add(...)`.
  - `listSessions()` — `return this.store.list()` (вместо knownSessionIds loop).
  - Остальные методы без изменений по сигнатуре.
- **D-05** `apps/api/src/gsd/gsd.module.ts`:
  - providers += `PrismaService`, `PrismaSessionStore`.

### Build

- **D-06** `pnpm -r typecheck` → 10 пакетов green.
- **D-07** `pnpm --filter @orchestra/api build` → green. `prisma-session-store.js` compiled.

### Regression

- **D-08** `pnpm --filter @orchestra/gsd-engine test` → green (7/7).
- **D-09** `pnpm --filter @orchestra/consensus-engine test` → green (6/6).
- **D-10** `pnpm --filter @orchestra/api test` → green (5/5).
- **D-11** `pnpm --filter @orchestra/api test:e2e` → green (8/8).

### Runtime (УСИЛЕННЫЙ evidence-rule, главный D-18)

- **D-12** `docker compose up -d` → Redis + Postgres running.
- **D-13** `prisma migrate deploy` applied (SessionRecord table exists).
  Evidence: `\dt` psql output.
- **D-14** API start: `[GsdModule] dependencies initialized`, `listening`.
  Evidence: copy-paste лога.
- **D-15** `GET /sessions` (empty до create) → 200, `[]`.
- **D-16** `POST /sessions` → 201, session created.
- **D-17** `GET /sessions` → 200, array с созданной session. DB row exists.
  Evidence: curl + psql `SELECT id, name FROM "SessionRecord"`.
- **D-18** **ГЛАВНЫЙ — persistence survives restart:**
  1. `POST /sessions` → session created.
  2. `POST /sessions/:id/rounds` → round started.
  3. `GET /sessions` → session with 1 round.
  4. **Stop API.**
  5. **Start API.**
  6. `GET /sessions` → **session still there with round** (persisted).
  7. `GET /sessions/:id` → full session detail with rounds.

  Evidence: copy-paste всей последовательности. Лично техлид.
- **D-19** Events persist (Phase 8d-1) continues to work (regression — events + sessions both persisted).
  Evidence: trigger mutation → GET /events → event there.
- **D-20** Real-time UI (Phase 8c-2) не сломан.
  Evidence: pub/sub SUBSCRIBE → JSON event (бонус проверка).

### Anti-conflict

- **D-21** `packages/**` (всё): 0 изменений.
- **D-22** `apps/api/src/`: изменения ТОЛЬКО в `gsd/` (`prisma-session-store.ts` НОВЫЙ,
  `gsd-engine.service.ts` modified, `gsd.module.ts` modified). Другие — 0.
- **D-23** `apps/api/src/{sessions,kg,context,roles,consensus,providers,prompts,event-bus,events,prisma.service,main,app.module}.ts`:
  0 изменений.
- **D-24** `apps/api/{tsconfig.json,nest-cli.json,test/,package.json}`: 0 изменений.
- **D-25** `apps/web/**`, `docs/`, `role-manifests/`, `prompts/`: 0 изменений.
- **D-26** Root config + `docker-compose.yml`: 0 изменений.

### Discipline

- **D-27** SUMMARY содержит evidence для каждого runtime-D (D-12..20). Главный D-18 —
  copy-paste restart sequence с timestamps.
- **D-28** Все процессы остановлены. `docker compose stop`. PID + kill commands.
- **D-29** SUMMARY честно описывает: full switch (не dual-write), knownSessionIds удалён,
  AuditLog in-memory остаётся.

---

## 4. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-29 PASS (с evidence).
2. PrismaSessionStore implements SessionStorePort (4 port methods + list extension).
3. Sessions persist'ятся, переживают рестарт API (D-18 — главный).
4. knownSessionIds Set удалён (больше не нужен).
5. Events persist (8d-1) продолжает работать.
6. Regression Phase 5/6/7/8 green.
7. Anti-conflict: только gsd/ + prisma schema/migration.

**Фаза НЕ выполнена, если:**
- Prisma migrate упала (D-02 FAIL).
- Sessions не persist'ятся (D-17 FAIL).
- Persistence не переживает рестарт (D-18 FAIL).
- Events persist сломан (D-19 FAIL).
- Кодер тронул что-то вне разрешённых зон (D-21..26 FAIL).

---

## 5. Порядок работы кодера

1. **Прочитать PLAN.** Особенно §0.3 (rounds Json embedded), §0.4 (full switch, не dual),
   §2.2 PrismaSessionStore, §2.3 GsdEngineService changes, §3 D-18 (главный — restart).
2. **Prisma schema (§2.1):** +SessionRecord model.
3. **Prisma migration (D-02):**
   - `docker compose up -d postgres`.
   - `DATABASE_URL=postgresql://orchestra:orchestra@localhost:5433/orchestra pnpm --filter @orchestra/api prisma migrate dev --name add_sessions`.
4. **PrismaSessionStore (§2.2):** НОВЫЙ.
5. **GsdEngineService (§2.3):** DI store, remove knownSessionIds, listSessions из БД.
6. **GsdModule (§2.4):** +PrismaSessionStore, PrismaService providers.
7. **Build (D-06, D-07):** typecheck + build.
8. **Runtime verifier (D-12..20) с УСИЛЕННЫМ evidence:**
   - D-12: docker compose up.
   - D-13: prisma migrate deploy, SessionRecord table exists.
   - D-14: API start.
   - D-15: GET /sessions empty.
   - D-16: POST /sessions.
   - D-17: GET /sessions + DB row.
   - **D-18: restart persistence — create → round → stop → start → GET sessions still there.**
   - D-19: events still persisted.
   - D-20: pub/sub still works.
   - Cleanup.
9. **Regression (D-08..11):** 4 spec'а.
10. **Anti-conflict (D-21..26):** git diff.
11. **`8d-2-SUMMARY.md`** с evidence.

**Оценка:** ~4-6 часов (Prisma + adapter + verification с restart).

---

## 6. Design notes

1. **Full switch, не dual-write.** SessionStore = critical-path. Dual-write = inconsistency.
   При БД-down → API валидно падает на session operation (понятная ошибка).
2. **rounds Json embedded (Вариант B), не separate table (A).** Session = aggregate root,
   rounds = embedded collection. 1 query vs 2. Pattern как DomainEventRecord.payload (8d-1).
3. **currentPhase String, не Prisma enum.** GSDPhase — TS union type. Prisma enum требует
   migration при добавлении фазы. String — extensible без migration. Mapping `as GSDPhase`.
4. **knownSessionIds удалён.** Был workaround для listSessions в Phase 8b-02 (когда InMemory
   не имел list). Теперь PrismaSessionStore.list() — proper solution.
5. **`list()` extension на adapter.** Не часть SessionStorePort (port = per-session only).
   Но PrismaSessionStore имеет public `list()` для GsdEngineService.listSessions. Acceptable:
   adapter может иметь methods вне port contract.
6. **createdAt/updatedAt без @default.** Session уже содержит эти поля (GsdEngine генерит
   ISO8601 timestamps). Храним как есть, не перегенерируем.
7. **3 PrismaClient instances (Kg, Events, Gsd).** Не идеально (connection pool), но
   `@Global() PrismaService` refactor — отдельная задача. Не трогаем prisma.service.ts.
8. **Не persist approvals.** `private readonly approvals = new Map()` в GsdEngine — internal
   state, требует правки packages/gsd-engine. Wave 8d+.
9. **Не persist audit log.** InMemoryAuditLog → отдельная фаза (D-8d-2-3).
10. **Не migration existing sessions.** In-memory sessions не переносим в БД (dev, не критично).

---

## 7. Долги, которые фаза ЗАКРЫВАЕТ

- **D-8d-1** SessionStore persistence — Phase 8d-2 закрывает.
- **D-F1** Prisma persistence — полностью закрывается (events 8d-1 + sessions 8d-2).
- **knownSessionIds workaround** — удалён, replaced proper `store.list()`.

## 8. Долги, которые фаза ОТКРЫВАЕТ

- **D-8d-2-1** Connection pooling (3 PrismaClient instances).
- **D-8d-2-2** Session pagination (когда > 100 сессий).
- **D-8d-2-3** AuditLog persistence (InMemoryAuditLog → Prisma).
- **D-8d-2-4** Approvals persistence (Map в GsdEngine → Prisma, требует правки packages).

---

## 9. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| PrismaSessionStore не совместим с GsdEngine (interface mismatch) | низкая | SessionStorePort 4 метода, PrismaSessionStore implements все. Typecheck (D-06) ловит. |
| rounds Json mapping теряет данные (Round[] → any → Round[]) | низкая | `as unknown as Round[]` cast — type-safe, Prisma хранит JSON as-is. |
| Session create падает на unique constraint (тот же id) | исключено | GsdEngine генерит уникальные id (projectId+timestamp+counter). |
| БД-down → API не стартует (store critical-path) | средняя | expected behavior (full switch). Error handling: GsdEngine выбрасывает понятную ошибку. |
| knownSessionIds references остаются (забыт cleanup) | средняя | Code review D-04. typecheck ловит unused import. |
| PrismaClient instances превышают connection pool | низкая | Default pool 10. 3 instances × 1-2 connections = OK. |
| Process zombies после verification | средняя (8d-1 precedent) | D-28. Рекомендуется verification script вместо interactive. |
| Кодер зависает на PowerShell runtime-тестах (8d-1 precedent) | высокая | Техлид рекомендует Git Bash + `kill $PID`. Или self-execute. |

---

## 10. Что получает Orchestra после Phase 8d-2

**Persistent sessions.** Сессии переживают рестарт API. UI SessionList не пустой после рестарта.

1. **Full persistence layer** — events (8d-1) + sessions (8d-2). Orchestra state survives restart.
2. **Production-ready** — можно деплоить, сессии не теряются.
3. **Multi-instance safe** — несколько API instances могут работать с одной БД (horisontal scaling).
4. **knownSessionIds workaround удалён** — чистый код, proper `store.list()`.
5. **Foundation для SessionStore cleanup/TTL** (D-8d-2-2 pagination).

**Phase 8d-2 = Orchestra state persistent.** Architecture §3 полностью материализована:
KG + Event Bus + Decision Repository + Session Store — все в PostgreSQL.

---

**Конец PLAN 8d-2.** Ждёт `/gsd-execute-phase 8d.2` (mimo) → `/gsd-validate-phase 8d.2`.
После PASS — README-CONTRACT-PHASE-8d-2.md → Wave 8d persistence полностью закрыта.
