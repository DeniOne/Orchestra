---
phase: 8d.2
slug: 08d-decision-repository
wave: B-8 (Wave 8d-2 — SessionStore persistence)
title: "Phase 8d-2 — PrismaSessionStore: сессии переживают рестарт API, D-F1 полностью закрыта"
milestone: "Orchestra MVP — Wave 8d (Decision Repository → SessionStore persistence)"
tech_lead: zcode (ZCode)
date: 2026-07-22
verdict: PASS
---

# README-CONTRACT — Phase 8d-2: SessionStore persistence

> Замыкающий документ. Wave 8d persistence полностью закрыта (events 8d-1 + sessions 8d-2).
> D-F1 Prisma persistence закрыта полностью.

---

## 1. Вердикт: PASS

**Phase 8d-2 = PASS.** PrismaSessionStore заменяет InMemorySessionStore. Сессии persist'ятся в
PostgreSQL, переживают рестарт API. `knownSessionIds` Set удалён — `listSessions()` читает из БД.

**Главный критерий D-18 лично верифицирован техлидом:**
```
Instance 1: POST /sessions + /rounds → session (persist-8d2, Discover, rounds:1), DB row exists
STOP API
Instance 2: restart → GET /sessions → 1 session still there with round ✅
GET /sessions/:id → full detail, round1.status: in_progress ✅
```

---

## 2. Что доставлено

### 2.1. Prisma

- **`schema.prisma`** + `model SessionRecord`:
  - `id String @id` (без @default — Session.id от GsdEngine).
  - `name String`, `projectId String`, `currentPhase String` (GSDPhase as string, extensible).
  - `rounds Json` (Round[] embedded, pattern как DomainEventRecord.payload).
  - `createdAt DateTime`, `updatedAt DateTime` (без @default, от Session).
  - Indexы: `projectId`, `currentPhase`, `updatedAt`.
- **`migrations/20260722195440_add_sessions/migration.sql`** — CREATE TABLE + 3 indexа.

### 2.2. PrismaSessionStore

- **`prisma-session-store.ts`** (НОВЫЙ) — `@Injectable PrismaSessionStore implements SessionStorePort`:
  - `create/get/update/listRounds` — через `prisma.sessionRecord`.
  - `list()` — extension для `GsdEngineService.listSessions` (findMany orderBy updatedAt desc).
  - `toSession()` — mapping record → Session, `currentPhase as GSDPhase` cast.
  - rounds `as unknown as Round[]` / `Prisma.InputJsonValue` — Json ↔ Round[].

### 2.3. GsdEngineService

- **`gsd-engine.service.ts`**:
  - `private readonly store: PrismaSessionStore` (DI, вместо hardcoded `new InMemorySessionStore()`).
  - `knownSessionIds Set` **удалён** — workaround из Phase 8b-02 больше не нужен.
  - `listSessions()` → `this.store.list()` (из БД, не knownSessionIds loop).

### 2.4. GsdModule

- **`gsd.module.ts`** — providers += `PrismaService`, `PrismaSessionStore`.

---

## 3. Architecture decisions

1. **Full switch (не dual-write).** SessionStore = critical-path GSD. Dual-write = inconsistency.
   При БД-down → API валидно падает на session operation.
2. **rounds Json embedded.** Session = aggregate root. 1 query vs 2 (separate Round table).
   Pattern как DomainEventRecord.payload (8d-1).
3. **currentPhase String, не Prisma enum.** GSDPhase TS union, extensible без migration.
4. **knownSessionIds удалён.** Workaround из Phase 8b-02 (когда InMemory не имел list). Теперь
   PrismaSessionStore.list() — proper solution.
5. **`list()` extension на adapter.** Не часть SessionStorePort (port = per-session only).
   Acceptable — adapter может иметь methods вне port contract.

---

## 4. Verifier

| Verifier | Результат |
|---|---|
| `pnpm -r typecheck` | ✅ 10/10 green |
| `pnpm --filter @orchestra/api build` | ✅ green, prisma-session-store.js compiled |
| `pnpm --filter @orchestra/gsd-engine test` | ✅ 7/7 (Phase 6) |
| `pnpm --filter @orchestra/consensus-engine test` | ✅ 6/6 (Phase 5) |
| `pnpm --filter @orchestra/api test` | ✅ 5/5 (Phase 7) |
| `pnpm --filter @orchestra/api test:e2e` | ✅ 8/8 (Phase 8) |
| `prisma migrate deploy` | ✅ SessionRecord table exists |
| **D-18 ГЛАВНЫЙ: restart persistence** | ✅ **create+round → stop → start → GET sessions still there** (лично) |
| Anti-conflict | ✅ packages/ 0; apps/api только gsd/ (2 modified + 1 new) |

---

## 5. Открытые долги

| ID | Приоритет | Что | Когда |
|---|---|---|---|
| D-8d-2-1 | P3 | Connection pooling (3 PrismaClient instances) | позже |
| D-8d-2-2 | P3 | Session pagination | при росте |
| D-8d-2-3 | P2 | AuditLog persistence | Wave 8d+ |
| D-8d-2-4 | P2 | Approvals persistence (требует правки packages) | Wave 8d+ |
| D-H1 | P2 | Auth | Wave 8+ |

---

## 6. Wave 8d полностью закрыта

Wave 8d = Persistence layer:
- **8d-1** (`f9e7f29`): Persist DomainEvents в PostgreSQL.
- **8d-2** (этот commit): Persist Sessions в PostgreSQL.

**D-F1 Prisma persistence полностью закрыта.** Orchestra state (events + sessions) survives restart.
Architecture §3 Decision Repository = PostgreSQL материализована.

---

**Phase 8d-2 закрыта. Wave 8d завершена.**
