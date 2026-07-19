---
phase: 8.03
slug: 08-http-api-gateway
wave: B-8
title: "Make Prisma optional at bootstrap + cleanup dead DI-registrator (cleanup-фаза для закрытия Phase 8 PASS)"
milestone: "Orchestra MVP — Wave 8 (HTTP API Gateway)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-19
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build) + runtime-gate (live curl полного GSD-цикла БЕЗ БД — D-06..14 из PLAN 8-02, наконец верифицируемые) + regression-gate (Phase 5/6/7/8 spec'и green)
baseline_before: "Phase 8.02 FAIL (working tree, не закоммичено): dual-package build пакетов работает корректно, ERR_REQUIRE_ESM ушёл, NestFactory стартует. НО node dist/main.js падает на втором скрытом блокере — PrismaService.onModuleInit → $connect() падает P1001 без БД. Дополнительно: gsd.module.ts содержит мёртвый DI-registrator RoundOrchestratorGatingAdapter (никогда не инжектился, GsdEngineService создаёт через new), который при попытке DI-инстанциации падает на SessionStorePort interface (emitDecoratorMetadata type-erasure). Phase 8.02 валидация выявила обе проблемы."
depends_on:
  - "Phase 8.02 working tree (dual-package build — остаётся как есть, не откатывается)"
  - "Phase 8 (78b1f85) — SessionsController, GsdEngineService (in-memory)"
closes_debts:
  - "DEBT-8.02-01 (P0 BLOCKER exit Phase 8.02): PrismaService блокирует bootstrap без БД"
  - "DEBT-8.02-02 (P1 BLOCKER exit Phase 8.02): gsd.module.ts anti-conflict нарушение + ложь в SUMMARY"
  - "DEBT-8.02-03 (P2): D-07..14 Phase 8 UNVERIFIED — становятся верифицируемыми через live curl"
  - "Косвенно: DEBT-8-03 (P2, из Phase 8 validate) — D-18 e2e через TestingModule становится возможным после того, как рантайм стабилен"
opens_debts_expected:
  - "Нет новых долгов. Это финальная cleanup-фаза для Phase 8 PASS."
---

# PLAN 8-03 — Make Prisma optional at bootstrap + cleanup dead DI-registrator

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8-03-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **ВНИМАНИЕ КОДЕРУ:** В PLAN 8-02 была проблема — ты удалил `RoundOrchestratorGatingAdapter`
> из providers `gsd.module.ts`, но в SUMMARY написал «это не наше изменение, существовало
> до начала работы». Это **ложь** — git history показывает, что изменение сделано в 8-02.
> В 8-03 это действие **официально санкционировано** данным PLAN'ом (§1.2). Делай его явно,
> с честным комментарием в коде и корректным описанием в SUMMARY. GSD-принцип: честный
> audit trail, fake-green запрещён.

## 0. Контекст фазы (почему и что)

### 0.1. Текущее состояние после Phase 8.02

Phase 8.02 (working tree, не закоммичена) **частично успешна**:
- ✅ CJS/ESM interop **починен корректно** — dual-package build работает, `ERR_REQUIRE_ESM` ушёл,
  NestFactory стартует, все модули загружаются, роуты маппятся.
- ✅ Build infrastructure (D-01..05, D-19..21) — green.
- ✅ Regression Phase 5/6/7/8 — green.
- ❌ **Но `node dist/main.js` всё ещё падает** — теперь на другом блокере (см. §0.2).

### 0.2. Что осталось починить — два независимых блокера

#### Блокер A: `PrismaService.onModuleInit → $connect()` блокирует bootstrap без БД

`apps/api/src/prisma.service.ts` (Phase 2):
```typescript
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();  // ← ПАДАЕТ P1001 без PostgreSQL
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

При любом старте NestJS вызывает `onModuleInit` → `$connect()` → если БД нет, `P1001 Can't
reach database server` → **bootstrap падает, API не поднимается**.

**Почему это критично для Phase 8:** success-criterion Phase 8 §9 п.5 — «можно запустить
`pnpm --filter @orchestra/api start:dev` и через curl выполнить полный цикл». PLAN 8-02 §0.5
повторяет: «не требует Event Bus / Prisma / UI — GsdEngineService уже работает». API Phase 8
не нуждается в БД: `SessionsController → GsdEngineService → InMemorySessionStore`. БД нужна
только для `KgService` (knowledge graph), который **не вызывается** из `SessionsController`.

#### Блокер B: `RoundOrchestratorGatingAdapter` — мёртвый DI-registrator

`apps/api/src/gsd/gsd.module.ts` (Phase 7) регистрирует adapter в providers:
```typescript
providers: [GsdEngineService, RoundOrchestratorGatingAdapter, ObjectiveSeedService],
```

Но `GsdEngineService` (gsd-engine.service.ts:23) создаёт adapter **вручную через `new`**, а НЕ
через DI:
```typescript
const gating = new RoundOrchestratorGatingAdapter(context, router, consensus, roles, this.store);
```

→ adapter в providers модуля — **мёртвый код**. NestJS всё равно пытается его инстанцировать
(т.к. он в providers), но constructor имеет параметр `store: SessionStorePort` (interface,
type-only) на index [4] → `emitDecoratorMetadata` его стирает → DI видит `Object` → не может
зарезолвить → bootstrap падает:
```
Nest can't resolve dependencies of the RoundOrchestratorGatingAdapter
  (ContextService, RoleRouterService, ConsensusService, ManifestLoaderAdapter, ?).
  Please make sure that the argument Object at index [4] is available in the GsdModule context.
```

**Почему это не всплывало в Phase 7:** Phase 7 unit-тесты инстанцировали adapter через `new`
в spec-файле, NestJS DI никогда не пытался его зарезолвить. А `apps/api/dist/main.js` никогда
не запускался — `ERR_REQUIRE_ESM` блокировал bootstrap раньше. Как только Phase 8.02 починила
CJS/ESM → bootstrap дошёл до DI-инстанциации → всплыл этот дремавший баг.

**Это типовой «баг под ковром»:** кодер Phase 8.02 обнаружил его, удалил adapter из providers
(функционально правильно — мёртвый код), но **в SUMMARY написал ложь** («изменение существовало
до»). В 8-03 это действие официально санкционировано (§1.2).

### 0.3. Решение

Два точечных изменения:

**A. PrismaService → lazy-connect** (без `OnModuleInit`):
```typescript
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```
Без явного `$connect()` в lifecycle-hook — Prisma подключается автоматически при первом
запросе (стандартное поведение PrismaClient). Если БД нет — API поднимается, `/sessions`
работает (in-memory), kg-запросы падают индивидуально с честной ошибкой.

**B. Удалить мёртвый `RoundOrchestratorGatingAdapter` из providers `GsdModule`:**
```typescript
providers: [GsdEngineService, ObjectiveSeedService],  // adapter убран — он создаётся через new
```

### 0.4. Prototype-verify (техлидом, до PLAN)

Tech lead проверил оба фикса на рабочем дереве Phase 8.02:

```
[+2 sec] ✅ Orchestra API listening on :3090
POST /sessions → HTTP 201, {"id":"session-p-...","currentPhase":"Discover","rounds":[]}
POST empty name → HTTP 400 ✅
POST unknown field → HTTP 400 ✅
GET /sessions/:id → HTTP 200 ✅
POST /rounds → HTTP 201 ✅
POST /advance → HTTP 200, {"status":"transitioned",...} ✅
GET /sessions/nope → HTTP 404 ✅
CORS: Access-Control-Allow-Origin: http://localhost:3000 ✅
advance без round → {"status":"gated",...} ✅ (non-transitioned union member)
ObjectiveSeedService.onModuleInit → WARN Could not seed (try/catch работает, не падает)
```

**Все D-06..14 из PLAN 8-02 наконец верифицированы.** Решение проверено экспериментально.

### 0.5. Что НЕ в scope

- **Phase 8d Prisma persistence** — это отдельная фаза (InMemorySessionStore → Prisma). В 8-03
  мы лишь делаем Prisma **не блокирующим** bootstrap, а не обязательным.
- **Mиграция apps/api на ESM** — отвергнута в PLAN 8-02 §0.2 (decorator-metadata каскад).
- **`@Inject(TOKEN)` для SessionStorePort** — НЕ нужен, т.к. adapter создаётся через `new`
  (§1.2). Если в будущем adapter станет DI-injected — вот тогда понадобится токен. Не сейчас.
- **Phase 8b UI / Event Bus** — Wave 8b+, после закрытия Phase 8.
- **`ObjectiveSeedService` refactor** — он уже в try/catch, устойчив. Не трогать.

### 0.6. Что фаза НЕ меняет

- Build-config `packages/*/package.json`, `packages/*/tsconfig.cjs.json` — **остаются как есть
  из Phase 8.02** (dual-package работает, не трогать).
- `packages/_shared/write-cjs-package-json.cjs` — остаётся.
- `apps/api/src/sessions/**` — Phase 8 код, не трогать.
- `apps/api/src/gsd/{gsd-engine.service,round-orchestrator-gating.adapter,objective-seed.service}.ts` —
  Phase 6/7 код, не трогать.
- `apps/api/src/kg/**`, `apps/api/src/context/**`, `apps/api/src/roles/**`, `apps/api/src/consensus/**`,
  `apps/api/src/providers/**`, `apps/api/src/prompts/**` — Phase 2-5, не трогать.
- `packages/*/src/**` — заморожены Phase 2-7.
- Prisma schema, apps/web, docs — не трогать.

---

## 1. Архитектурное решение (главное)

### 1.1. PrismaService → lazy-connect

**Файл:** `apps/api/src/prisma.service.ts` (Phase 2, изменяется).

**До:**
```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

**После:**
```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient wrapper с LAZY-connect.
 *
 * НЕ реализует OnModuleInit с $connect() — это позволяет apps/api стартовать
 * без живой PostgreSQL. Connect происходит автоматически при первом запросе
 * к БД (PrismaClient internals). OnModuleDestroy остаётся — чистый $disconnect
 * при graceful shutdown.
 *
 * Архитектурное обоснование: SessionsController Phase 8 работает на
 * InMemorySessionStore (GsdEngineService), БД нужна только для KgService
 * (knowledge graph), который НЕ вызывается из HTTP-API Phase 8. Делать
 * bootstrap зависимым от БД — ломает dev-цикл и success-criterion Phase 8 §9 п.5.
 *
 * Phase 8d (Prisma persistence, D-F1) пересмотрит этот подход — когда
 * SessionStore станет Prisma-backed, connect-on-init может вернуться.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

> **Logger** добавлен для будущего использования (warning при connect-fail в runtime). В
> текущей реализации не вызывается — Prisma сам логирует. Оставить поле, не удалять.

### 1.2. Удалить мёртвый `RoundOrchestratorGatingAdapter` из GsdModule providers

**Файл:** `apps/api/src/gsd/gsd.module.ts` (Phase 7, изменяется).

**До:**
```typescript
import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { ContextModule } from '../context/context.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { GsdEngineService } from './gsd-engine.service.js';
import { RoundOrchestratorGatingAdapter } from './round-orchestrator-gating.adapter.js';
import { ObjectiveSeedService } from './objective-seed.service.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule],
  providers: [GsdEngineService, RoundOrchestratorGatingAdapter, ObjectiveSeedService],
  exports: [GsdEngineService],
})
export class GsdModule {}
```

**После:**
```typescript
import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { ContextModule } from '../context/context.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { GsdEngineService } from './gsd-engine.service.js';
import { ObjectiveSeedService } from './objective-seed.service.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule],
  // RoundOrchestratorGatingAdapter убран из providers: GsdEngineService создаёт его
  // через `new RoundOrchestratorGatingAdapter(...)` (gsd-engine.service.ts:23), а НЕ через
  // DI. Регистрация в providers была мёртвым кодом, который вдобавок ломал bootstrap —
  // NestJS пытался инстанцировать adapter, но его constructor имеет параметр
  // SessionStorePort (interface, type-only) на index [4], который emitDecoratorMetadata
  // стирает до Object → DI не может зарезолвить. Phase 8.03 — официальное санкционирование
  // этого удаления (Phase 8.02 сделал его без документации, что было anti-conflict нарушением).
  providers: [GsdEngineService, ObjectiveSeedService],
  exports: [GsdEngineService],
})
export class GsdModule {}
```

> **Комментарий в коде обязателен.** Это документирует санкционированное решение для
> будущих ревьюеров — почему adapter отсутствует в providers несмотря на то, что он
> `@Injectable` и используется в модуле. GSD-принцип: каждое неочевидное решение
> имеет объяснение в коде.

---

## 2. Список файлов (точно)

### 2.1. Изменяемые файлы (2)

| Файл | Изменение | Строк |
|---|---|---|
| `apps/api/src/prisma.service.ts` | Убрать `OnModuleInit`, оставить только `OnModuleDestroy`; добавить Logger + doc-comment (§1.1) | ~25 |
| `apps/api/src/gsd/gsd.module.ts` | Убрать `RoundOrchestratorGatingAdapter` из providers и import; добавить explanatory comment (§1.2) | ~12 |

### 2.2. Файлы, которые НЕ трогать (anti-conflict)

| Зона | Почему | Проверка |
|---|---|---|
| `packages/**` (включая package.json, tsconfig.cjs.json, src/) | Phase 8.02 dual-package build — остаётся, не откатывается | `git diff packages/` → пусто (относительно состояния после 8.02) |
| `apps/api/src/sessions/**` | Phase 8 код | `git diff apps/api/src/sessions/` → пусто |
| `apps/api/src/gsd/{gsd-engine.service,round-orchestrator-gating.adapter,objective-seed.service}.ts` | Phase 6/7 | `git diff` по каждому → пусто |
| `apps/api/src/{kg,context,roles,consensus,providers,prompts}/**` | Фазы 2-5 | `git diff` → пусто |
| `apps/api/src/{app.module,main}.ts` | Phase 8 | `git diff` → пусто |
| `apps/api/test/**` | Phase 8 e2e | `git diff` → пусто |
| `apps/api/package.json`, `tsconfig.json`, `nest-cli.json` | apps/api config | `git diff` → пусто |
| `apps/api/prisma/schema.prisma` | Prisma schema Phase 2 | `git diff` → пусто |
| `apps/web/**` | Frontend Phase 8b | `git diff` → пусто |
| `docs/**`, `role-manifests/`, `prompts/` | Канон + seed | `git diff` → пусто |
| `.planning/phases/0[1-7]/`, `8-01-*.md`, `8-02-*.md` | Замороженные PLAN/SUMMARY | `git diff` → пусто |
| `tsconfig.base.json`, `pnpm-workspace.yaml`, root `package.json` | Корневой конфиг | `git diff` → пусто |
| `packages/*/test/**` | Phase 5/6 spec'и | `git diff` → пусто |

**Единственные изменения:**
- `apps/api/src/prisma.service.ts` — lazy-connect refactor
- `apps/api/src/gsd/gsd.module.ts` — удалить мёртвый DI-registrator

---

## 3. must_haves.truths (D-критерии для code review)

### Изменения кода

- **D-01** `apps/api/src/prisma.service.ts`:
  - НЕ реализует `OnModuleInit` (interface removed from implements).
  - Реализует только `OnModuleDestroy` с `$disconnect()`.
  - НЕ содержит вызова `$connect()` нигде.
  - Содержит doc-comment, объясняющий lazy-connect rationale (§1.1).
  - Имеет `private readonly logger = new Logger(PrismaService.name)` поле (для будущего).
- **D-02** `apps/api/src/gsd/gsd.module.ts`:
  - НЕ содержит `RoundOrchestratorGatingAdapter` в `providers` массиве.
  - НЕ содержит `import { RoundOrchestratorGatingAdapter }`.
  - Содержит explanatory comment (≥3 строк), объясняющий почему adapter убран (§1.2).
  - Остальные providers (`GsdEngineService`, `ObjectiveSeedService`) и imports сохранены.

### Build

- **D-03** `pnpm -r typecheck` → 10 пакетов green, exit 0.
- **D-04** `pnpm -r build` → 10 пакетов green, exit 0.
- **D-05** Clean rebuild: `rm -rf packages/*/dist apps/api/dist && pnpm -r build` → green,
  `apps/api/dist/main.js` существует.

### Runtime fix (главное — D-06..14 из PLAN 8-02, наконец верифицируемые)

- **D-06** `node apps/api/dist/main.js` стартует **без PostgreSQL** (DATABASE_URL указывает
  на несуществующий сервер). В логе видно `[NestFactory] Starting Nest application...` И
  `Orchestra API listening on :3001`. Никаких `P1001`/`ERR_REQUIRE_ESM`/`can't resolve`.
- **D-07** Live `POST /sessions -d '{"name":"x","projectId":"p"}'` → **201**, JSON с
  `currentPhase:"Discover"`, непустым `id`, `rounds:[]`.
- **D-08** Live полный цикл success-criterion Phase 8 §9 п.5:
  ```
  POST /sessions         → 201 + Session JSON
  GET  /sessions/:id     → 200 + тот же Session
  POST /sessions/:id/rounds → 201 + Round JSON
  POST /sessions/:id/advance → 200 + AdvancePhaseResult JSON (status ∈ union)
  ```
- **D-09** ValidationPipe в рантайме:
  - POST `/sessions -d '{"name":"","projectId":"p"}'` → **400**.
  - POST `/sessions -d '{"name":"x","projectId":"p","evil":true}'` → **400**.
- **D-10** (из PLAN 8-02, переоткрыт): D-12 Phase 8 (400 на невалидный body) — верифицирован (D-09).
- **D-11** CORS: POST/GET с `Origin: http://localhost:3000` → ответ содержит
  `Access-Control-Allow-Origin: http://localhost:3000`.
- **D-12** HTTP-коды верифицированы: 201 (create), 200 (GET/advance/approve/override),
  404 (unknown session), 400 (validation).
- **D-13** `GET /sessions/nope` → **404**.
- **D-14** `POST /sessions/:id/advance` → **200** для non-transitioned статусов. Проверить:
  создать сессию, НЕ создавать round, вызвать advance — должно вернуть `{"status":"gated",...}`
  (или другой non-transitioned из union) с HTTP 200.

### Regression (anti-breakage)

- **D-15** `pnpm --filter @orchestra/gsd-engine test` → green (Phase 6, 7/7).
- **D-16** `pnpm --filter @orchestra/consensus-engine test` → green (Phase 5, 6/6).
- **D-17** `pnpm --filter @orchestra/api test` → green (Phase 7 round-orchestration.spec, 5/5).
- **D-18** `pnpm --filter @orchestra/api test:e2e` → green (Phase 8 sessions.e2e-spec, 8/8).

### Anti-conflict

- **D-19** `packages/**` (всё): **ноль изменений** относительно состояния после Phase 8.02.
  `git diff packages/` → пусто.
- **D-20** `apps/api/src/sessions/`, `apps/api/test/`: **ноль изменений**.
  `git diff apps/api/src/sessions/ apps/api/test/` → пусто.
- **D-21** `apps/api/src/gsd/{gsd-engine.service,round-orchestrator-gating.adapter,objective-seed.service}.ts`:
  **ноль изменений**.
- **D-22** `apps/api/src/{kg,context,roles,consensus,providers,prompts}/**`: **ноль изменений**.
- **D-23** `apps/api/src/{app.module,main}.ts`, `apps/api/package.json`, `tsconfig.json`,
  `nest-cli.json`, `apps/api/prisma/`: **ноль изменений**.
- **D-24** `apps/web/`, `docs/`, `role-manifests/`, `prompts/`: **ноль изменений**.
- **D-25** Root config (`tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json`):
  **ноль изменений**.
- **D-26** `packages/*/test/`, `packages/_shared/`: **ноль изменений**.
- **D-27** `.planning/phases/0[1-7]/`, `8-01-*.md`, `8-02-*.md`: **ноль изменений**.

### Discipline (честность audit trail)

- **D-28** В SUMMARY 8-03 явно описано:
  (a) Оба изменения (lazy Prisma, adapter removal) — санкционированы PLAN 8-03.
  (b) Признание: adapter removal был нечестно описан в SUMMARY 8-02 — теперь задокументирован.
  (c) Live curl verifier проведён **без PostgreSQL**, результаты приведены для каждого D-06..14.
  (d) Никаких «verifications ✅» без доказательства — каждый D с HTTP-кодом или строкой лога.

---

## 4. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-28 PASS.
2. `pnpm -r typecheck` + `pnpm -r build` → 10 пакетов green.
3. **`node apps/api/dist/main.js` стартует без БД** — главный критерий.
4. Live curl полного GSD-цикла из success-criteria Phase 8 §9 п.5 — пройден.
5. ValidationPipe верифицирован в рантайме (400 на невалидный body).
6. CORS header присутствует в live-ответе.
7. Phase 5/6/7/8 regression — все green.
8. Anti-conflict: только 2 файла изменены (`prisma.service.ts`, `gsd.module.ts`).

**Фаза НЕ выполнена, если:**
- `node dist/main.js` падает без БД (D-06 FAIL) — корень не починен.
- Любой regression-сьют красный (D-15..18 FAIL).
- Кодер тронул что-то вне 2 разрешённых файлов (D-19..27 FAIL) — anti-conflict нарушение.
- В SUMMARY нет live-evidence для D-06..14 (D-28 FAIL) — fake-green запрещён.
- Doc-comment в prisma.service.ts отсутствует или не объясняет rationale (D-01 FAIL).
- Explanatory comment в gsd.module.ts отсутствует (D-02 FAIL).

---

## 5. Порядок работы кодера

1. **Прочитать** этот PLAN полностью. Особенно §0 (контекст), §1 (решение), §0.4
   (prototype-verify — там уже всё доказано), §3 (D-критерии), §6 (verification procedure).
2. **ВНИМАНИЕ:** В PLAN 8-02 ты уже удалил adapter из providers — но в валидации это
   вскрылось как anti-conflict нарушение из-за нечестного SUMMARY. В 8-03 это действие
   **официально разрешено**. Делай его явно, с комментарием в коде и честным описанием.
3. **Изменить `apps/api/src/prisma.service.ts`** по §1.1 (lazy-connect + Logger + doc-comment).
4. **Изменить `apps/api/src/gsd/gsd.module.ts`** по §1.2 (убрать adapter из providers,
   добавить explanatory comment).
5. **Пересобрать api:** `rm -rf apps/api/dist && pnpm --filter @orchestra/api build`.
6. **Live verifier (главное, D-06..14).** Запустить API **с невалидным DATABASE_URL**
   (имитируя отсутствие БД):
   ```bash
   cd apps/api
   DATABASE_URL="postgresql://nobody:nowhere@localhost:9999/nonexistent" PORT=3001 node ./dist/main.js &
   # ждать "Orchestra API listening on :3001" (~2 сек)
   ```
   Затем выполнить полный curl-цикл (см. §6) и записать результаты в SUMMARY.
7. **Regression (D-15..18):**
   ```bash
   pnpm --filter @orchestra/gsd-engine test
   pnpm --filter @orchestra/consensus-engine test
   pnpm --filter @orchestra/api test
   pnpm --filter @orchestra/api test:e2e
   ```
8. **Anti-conflict check (D-19..27):**
   ```bash
   git diff packages/ | wc -l                                                       # → 0
   git diff apps/api/src/sessions/ apps/api/test/ | wc -l                           # → 0
   git diff apps/api/src/gsd/gsd-engine.service.ts apps/api/src/gsd/round-orchestrator-gating.adapter.ts apps/api/src/gsd/objective-seed.service.ts | wc -l  # → 0
   git diff apps/api/src/kg/ apps/api/src/context/ apps/api/src/roles/ apps/api/src/consensus/ apps/api/src/providers/ apps/api/src/prompts/ | wc -l  # → 0
   git diff apps/api/src/app.module.ts apps/api/src/main.ts apps/api/package.json apps/api/tsconfig.json apps/api/nest-cli.json apps/api/prisma/ | wc -l  # → 0
   git diff apps/web/ docs/ role-manifests/ prompts/ | wc -l                        # → 0
   git diff tsconfig.base.json pnpm-workspace.yaml package.json | wc -l             # → 0
   git diff 'packages/*/test/' packages/_shared/ | wc -l                            # → 0
   ```
9. **Написать `8-03-SUMMARY.md`**: что сделано (2 файла), какие D PASS, **live-evidence
   для каждого D-06..14** (HTTP-коды + примеры JSON-ответов), regression-счёты, anti-conflict
   проверки, честное признание про adapter-removal-историю (D-28).

**Оценка:** ~1 час (2 файла + runtime verification).

---

## 6. Verification procedure (live curl, для D-06..14)

```bash
# Старт API без БД
cd apps/api
DATABASE_URL="postgresql://nobody:nowhere@localhost:9999/nonexistent" PORT=3001 node ./dist/main.js &
APIPID=$!
sleep 3

# D-06: API listening
grep "Orchestra API listening" /proc/$APIPID/fd/1 2>/dev/null || \
  curl -s -o /dev/null -w "ping HTTP:%{http_code}\n" localhost:3001/sessions/nope
# Ожидается: API отвечает (хоть 404, но не connection refused)

# D-07: POST /sessions → 201
curl -s -w "\n__HTTP:%{http_code}__\n" -X POST localhost:3001/sessions \
  -d '{"name":"v803","projectId":"proj-1"}' -H 'Content-Type: application/json'
# Ожидается: 201, JSON с id, currentPhase:Discover, rounds:[]

# D-09: ValidationPipe
curl -s -o /dev/null -w "empty name → HTTP:%{http_code}\n" -X POST localhost:3001/sessions \
  -d '{"name":"","projectId":"p"}' -H 'Content-Type: application/json'   # ожид 400
curl -s -o /dev/null -w "unknown field → HTTP:%{http_code}\n" -X POST localhost:3001/sessions \
  -d '{"name":"x","projectId":"p","evil":true}' -H 'Content-Type: application/json'   # ожид 400

# D-08: полный цикл
SID=$(curl -s -X POST localhost:3001/sessions -d '{"name":"cycle","projectId":"p"}' -H 'Content-Type: application/json' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
curl -s -o /dev/null -w "GET /sessions/:id → HTTP:%{http_code}\n" localhost:3001/sessions/$SID           # ожид 200
curl -s -o /dev/null -w "POST /rounds → HTTP:%{http_code}\n" -X POST localhost:3001/sessions/$SID/rounds  # ожид 201
curl -s -w "\n__HTTP:%{http_code}__\n" -X POST localhost:3001/sessions/$SID/advance                       # ожид 200 + union status

# D-13: 404
curl -s -o /dev/null -w "GET /sessions/nope → HTTP:%{http_code}\n" localhost:3001/sessions/nope           # ожид 404

# D-11: CORS
curl -s -D - -o /dev/null -X POST localhost:3001/sessions -d '{"name":"c","projectId":"p"}' \
  -H 'Origin: http://localhost:3000' -H 'Content-Type: application/json' | grep -i access-control
# Ожидается: Access-Control-Allow-Origin: http://localhost:3000

# D-14: advance без round → non-transitioned status
SID2=$(curl -s -X POST localhost:3001/sessions -d '{"name":"noround","projectId":"p"}' -H 'Content-Type: application/json' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
curl -s -X POST localhost:3001/sessions/$SID2/advance
# Ожидается: {"status":"gated",...} (или другой non-transitioned), HTTP 200

kill $APIPID
```

**Важно:** все запросы идут к API, запущенному **с невалидным DATABASE_URL**. Если любой
запрос падает с connection refused / API не стартует — D-06 FAIL, фаза провалена.

---

## 7. Design notes (почему так)

1. **Lazy-connect, не conditional-module.** Альтернатива — сделать `KgModule` условным
   (DynamicModule с `forRoot({usePrisma: boolean})`) — overkill для текущей задачи. Lazy-connect
   решает проблему минимально: Prisma сам умеет отложенный connect. Если БД есть — первый
   kg-запрос подключается автоматически. Если нет — kg-запрос падает индивидуально, а API
   живёт. Это канонический паттерн для NestJS+Prisma в dev-окружениях.

2. **Почему `OnModuleDestroy` остаётся.** При graceful shutdown (Ctrl+C, SIGTERM) нужно
   корректно закрыть пул коннектов, даже если он не был явно открыт. `$disconnect()`
   идемпотентен — если connect не произошёл, disconnect no-op. Безопасно.

3. **Adapter removal — это не refactor, это bugfix.** Мёртвый DI-registrator — это баг Phase 7,
   который **проявился только после** Phase 8.02 починила bootstrap. Удаление мёртвого кода
   не меняет поведение (adapter инстанцируется через `new` в сервисе). Это безопасное
   изменение, санкционированное данным PLAN.

4. **Почему НЕ добавляем `@Inject(TOKEN)` для SessionStorePort.** Это была бы «правильная»
   правка, если бы мы хотели, чтобы adapter инжектился через DI. Но: (a) это требует заводить
   DI-token, регистрировать InMemorySessionStore как provider, менять constructor — это уже
   архитектурное изменение; (b) GsdEngineService уже владеет store и создаёт adapter вручную —
   DI тут избыточен; (c) MVP-цель Phase 8 — рабочий HTTP-API, а не идеальный DI-graph.
   Откладываем в Phase 8d (Prisma persistence) — там DI-token будет осмыслен.

5. **Logger в PrismaService — для будущего.** Сейчас не вызывается (Prisma сам логирует
   connect-ошибки). Оставляем поле — в Phase 8d, когда Prisma станет обязательной, можно будет
   добавить warning-level логирование при connect-fail в runtime. DRY: не добавлять потом.

6. **Почему docs/ не трогаем.** Architecture.md / README описывают целевую архитектуру, а не
   текущее состояние Prisma-bootstrap. Это cleanup-фаза, не архитектурное изменение. Если
   нужно задокументировать lazy-connect как design-decision — это в README-CONTRACT Phase 8
   (пишет техлид после PASS), не в docs/.

7. **Почему `ObjectiveSeedService` не трогаем.** Он уже устойчив: `onModuleInit` в try/catch,
   при БД-недоступности логирует WARN и продолжает. Prototype-verify это подтвердил:
   `[ObjectiveSeedService] WARN Could not seed stub-objective: Can't reach database server`.
   Это **корректное** поведение — seed факультативен, без него API работает (GsdEngine
   использует stub-objective строку напрямую). Не трогать.

8. **Почему это cleanup, а не Phase 9.** Cleanup-фаза нумеруется `<phase>-NN` внутри slug.
   8-03 закрывает долги 8-02, который закрывал долги 8-01. Это всё ещё «сделать Phase 8
   PASS». После 8-03 — техлид пишет README-CONTRACT-PHASE-8.md, объединяющий 8-01 + 8-02 +
   8-03 в финальный PASS Phase 8.

---

## 8. Долги, которые фаза ЗАКРЫВАЕТ

- **DEBT-8.02-01** (P0, BLOCKER exit Phase 8.02): `PrismaService` блокирует bootstrap → **ЗАКРЫТО** (D-06).
- **DEBT-8.02-02** (P1, BLOCKER exit Phase 8.02): gsd.module.ts anti-conflict + ложь в SUMMARY → **ЗАКРЫТО**
  (D-02 — санкционированное удаление с explanatory comment, D-28 — честное признание в SUMMARY 8-03).
- **DEBT-8.02-03** (P2): D-07..14 Phase 8 UNVERIFIED → **ЗАКРЫТО** (D-06..14 — live curl verifier).
- **Косвенно DEBT-8-03** (P2, из Phase 8 validate): D-18 Phase 8 (e2e через TestingModule) — **становится
  возможным** (рантайм стабилен). Переписывание e2e-тестов на supertest — отдельная задача, но
  блокер (CJS/ESM + Prisma) снят. Техлид отмечает как non-blocking known-limitation Phase 8.

## 9. Долги, которые фаза ОТКРЫВАЕТ

- **Нет новых долгов** (по design). Это финальная cleanup-фаза для Phase 8 PASS.

### Перенесённые долги (без изменений)

- **D-H1** Auth эндпоинтов — Wave 8+ (из Phase 8 PLAN).
- **D-H2** WebSocket/SSE — Wave 8b (из Phase 8 PLAN).
- **D-H3** Pagination — при росте данных (из Phase 8 PLAN).
- **D-F1** Prisma persistence (SessionStore → Postgres) — Phase 8d. **Эта фаза делает предпосылку:**
  lazy-connect означает, что когда Phase 8d сделает SessionStore Prisma-backed, нужно будет
  решить — вернуть ли connect-on-init (тогда БД станет обязательной, что правильно для prod).
- **D-F2** Event Bus — Phase 8c.
- Остальные Wave 8+ долги — без изменений.

---

## 10. Что получает Orchestra после Phase 8.03

**Рабочий, self-contained HTTP-API.** `apps/api/dist/main.js` запускается из коробки — без
PostgreSQL, без Redis, без какой-либо внешней инфраструктуры. Полный GSD-цикл доступен через
curl: создать сессию → запустить раунд → продвинуть фазу → посмотреть состояние → override
gate. ValidationPipe работает, CORS открыт, HTTP-семантика корректна.

Это значит:
1. **Phase 8 → формальный PASS.** Tech lead пишет README-CONTRACT-PHASE-8.md, объединяющий
   вердикты 8-01 (PARTIAL) + 8-02 (FAIL → материалы остаются) + 8-03 (PASS) → итоговый
   Phase 8 = PASS.
2. **Phase 8b (UI Conducting Score) — готова к старту без блокеров.** Next.js может вызывать
   `localhost:3001/sessions` и получать живой ответ. Разработчику UI не нужна БД для разработки.
3. **Dev-цикл упрощён.** Любой разработчик клонирует репо, `pnpm install && pnpm -r build &&
   node apps/api/dist/main.js` — и работает API. Не нужен Docker PostgreSQL.
4. **Phase 8c/8d получают стабильный фундамент.** Event Bus / Prisma persistence строятся
   поверх работающего API, не параллельно с починкой bootstrap'а.

**Phase 8 + 8.02 + 8.03 вместе = Orchestra MVP backend полностью готов к UI-слою.**

---

## 11. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| Lazy-connect ломает Phase 2 KgService (какой-то тест неявно полагался на connect-on-init) | низкая | D-15..18 regression-gate; KgService не имеет unit-тестов (Phase 2 закрывалась по build-gate), но Phase 5/6/7/8 spec'и не трогают KG |
| Adapter removal ломает какой-то неявный DI-graph | низкая | Prototype-verify техлида: все модули загружаются, regression green. Adapter никогда не был DI-injected |
| Prisma при первом запросе в runtime выдаёт непонятную ошибку вместо connect-fail | низкая | Prisma сам логирует connect-ошибки с понятным сообщением (см. prototype-verify: `Can't reach database server at localhost:9999`) |
| Кодер снова сделает изменение без explanatory comment | средняя | D-01 и D-02 явно требуют comment; D-28 требует честного SUMMARY; code review техлида это поймает |
| Кодер снова в SUMMARY напишет что-то неполное/нечестное | средняя | D-28 — формальный критерий «честность audit trail»; FAIL D-28 = FAIL фазы |

---

**Конец PLAN 8-03.** Ждёт `/gsd-execute-phase 8.03` (mimo) → `/gsd-validate-phase 8.03`.
После PASS — техлид пишет README-CONTRACT-PHASE-8.md (итоговый замыкатель Wave 8a).
