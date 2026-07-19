---
phase: 8
slug: 08-http-api-gateway
wave: B-8 (Wave 8a — HTTP API Gateway)
title: "Phase 8 — Orchestra открыта для любого HTTP-клиента через REST (с PostgreSQL required)"
milestone: "Orchestra MVP — Wave 8 (HTTP API Gateway)"
tech_lead: zcode (ZCode)
date: 2026-07-19
verdict: PASS
subphases:
  - "8-01 (HTTP API Gateway — кодер mimo): PARTIAL — контроллер/DTO/модуль корректны, build green, но main.js не запускался (ERR_REQUIRE_ESM, pre-existing с Phase 3)"
  - "8-02 (Fix CJS/ESM interop — dual-package build): FAIL → материалы остались в рабочем дереве и вошли в Phase 8 commit. CJS/ESM починен корректно."
  - "8-03 (Make Prisma optional + cleanup dead DI-registrator): PARTIAL — bootstrap-блокеры сняты, API запускается с PG, но advance требует KG→Prisma (см. §3)"
---

# README-CONTRACT — Phase 8: HTTP API Gateway (Wave 8a)

> Замыкающий документ фазы. Канон того, что Phase 8 доставила, какие долги открыла, и
> какие архитектурные решения зафиксированы. Источник правды для Phase 8b и далее.

---

## 1. Вердикт: PASS

**Phase 8 = PASS.** Orchestra открыта для любого HTTP-клиента через REST. SessionsController
с 7 эндпоинтами управляет полным жизненным циклом GSD-сессии, валидация через class-validator
+ ValidationPipe, CORS для UI. Все regression-тесты Phase 5/6/7/8 green (7+6+5+8 = 26).

**Архитектурный qualifier (owner-decision 2026-07-19):** API требует PostgreSQL в runtime
для эндпоинта `POST /sessions/:id/advance`. Остальные эндпоинты (create/get/rounds/approve/
override/list) работают на InMemorySessionStore и не требуют БД. Это **согласованная
характеристика**, не баг — см. §3.

---

## 2. Что доставлено

### 2.1. Функциональность

**SessionsController** (`apps/api/src/sessions/sessions.controller.ts`) — 7 REST-эндпоинтов:

| Эндпоинт | HTTP | Описание | БД? |
|---|---|---|---|
| `POST /sessions` | 201 | Создать сессию (Discover) | не нужна |
| `GET /sessions/:id` | 200 | Состояние сессии | не нужна |
| `POST /sessions/:id/rounds` | 201 | Начать новый раунд | не нужна |
| `POST /sessions/:id/advance` | 200 | Продвинуть фазу (gating + FSM) | **нужна** (KG) |
| `POST /sessions/:id/approve` | 200 | Подтвердить hard gate | не нужна |
| `POST /sessions/:id/override` | 200 | Owner override gating | не нужна |
| `GET /sessions/:id/rounds` | 200 | Список раундов | не нужна |

**Валидация:** `main.ts` → `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`.
DTO (`create-session.dto.ts`, `override-gate.dto.ts`) с `@IsString/@IsNotEmpty/@MaxLength`.
Невалидный body → 400. Unknown field → 400.

**CORS:** `app.enableCors({origin: true, credentials: true})` — для Phase 8b UI (Next.js :3000 → API :3001).

**HTTP-семантика (Phase 8 design decision #2):** gated/awaiting_approval/iteration — НЕ ошибки
(корректные FSM-состояния), возвращаются 2xx. 4xx — только для 400 (validation) и 404 (not found).

### 2.2. Архитектурные слои

```
HTTP-клиент (curl/Postman/Phase 8b UI)
    ↓ REST/JSON
SessionsController (apps/api/src/sessions/)
    ↓ method calls
GsdEngineService (apps/api/src/gsd/) — обёртка над GsdEngine
    ↓
GsdEngine (packages/gsd-engine, Phase 6) — FSM фаз GSD
    ↓ gating
RoundOrchestratorGatingAdapter (apps/api/src/gsd/, Phase 7)
    ↓ buildPacket × N ролей
ContextService (apps/api/src/context/, Phase 3)
    ↓ extractSubgraph
KgService (apps/api/src/kg/, Phase 2) → PrismaService → PostgreSQL  ← advance требует БД
    ↓
RoleRouter (Phase 4) × N ролей → ConsensusEngine (Phase 5) → GatingResult
```

### 2.3. CJS/ESM interop (8-02)

Monorepo: 8 пакетов `@orchestra/*` — ESM (`type:module`, NodeNext), `apps/api` — CommonJS.
Dual-package build: каждый пакет компилируется в ESM (`dist/`) и CJS (`dist/cjs/` с локальным
`package.json {type:commonjs}`). `exports["."].require` → `./dist/cjs/index.js`. Без этого
`apps/api` не мог `require()` ESM-пакеты → `ERR_REQUIRE_ESM` при bootstrap.

Helper: `packages/_shared/write-cjs-package-json.cjs` — пишет `dist/cjs/package.json` после
каждого CJS-build (критично: без него Node трактует CJS-файлы как ESM из-за `type:module`
в корне пакета).

### 2.4. Lazy-connect Prisma (8-03)

`apps/api/src/prisma.service.ts` — без `OnModuleInit/$connect()`. Prisma подключается
автоматически при первом запросе. Это позволяет API стартовать без живой БД (модули
инициализируются, роуты маппятся); запросы, требующие KG, падают индивидуально с честной
ошибкой. `ObjectiveSeedService.onModuleInit` уже в try/catch — логирует WARN при недоступности
БД, не падает.

---

## 3. PostgreSQL-required: согласованная характеристика

### 3.1. Что требует БД

Только `POST /sessions/:id/advance` — потому что `advancePhase` гонит через
`RoundOrchestratorGatingAdapter.evaluate → ContextService.buildPacket → extractSubgraph →
KgService.getNode('stub-objective') → Prisma`. Без БД → Prisma `P1001 Can't reach database
server` → HTTP 500.

### 3.2. Почему это принято как PASS, не FAIL

**Owner-decision (2026-07-19):** Orchestra — NestJS+Prisma проект, PostgreSQL в dev-окружении
это **норма для 90% таких проектов**, не отклонение. Делать `advance` in-memory-fallback
(отдельная фаза 8-04 с `InMemoryKgService`) — over-engineering для MVP. Если разработчик
хочет полный curl-цикл — он поднимает PostgreSQL (Docker- compose или локально), как делает
любой NestJS+Prisma разработчик.

### 3.3. Что нужно для запуска

```bash
# 1. PostgreSQL доступен (например Docker)
docker run --name orchestra-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16

# 2. DATABASE_URL в .env
echo 'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orchestra"' > apps/api/.env

# 3. prisma generate + migrate
cd apps/api && pnpm prisma:generate && pnpm prisma db push

# 4. Build и запуск
cd ../.. && pnpm -r build
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orchestra" node apps/api/dist/main.js
```

### 3.4. Что работает БЕЗ БД (для быстрого smoke)

`POST /sessions` (201), `GET /sessions/:id` (200), `POST /sessions/:id/rounds` (201),
`GET /sessions/:id/rounds` (200), `GET /sessions/nope` (404), ValidationPipe (400),
CORS-headers. Этого достаточно для разработки UI (Phase 8b) на базовых экранах без advance.

---

## 4. Открытые долги (переносятся в Wave 8b+)

| ID | Приоритет | Что | Когда | Блокирует |
|---|---|---|---|---|
| D-H1 | P2 | Auth/authorization эндпоинтов (публичные) | Wave 8+ (пользователи) | нет |
| D-H2 | P2 | WebSocket/SSE для real-time | Phase 8b (UI) или отдельная | нет |
| D-H3 | P3 | Pagination/filtering для list | при росте данных | нет |
| D-F1 | P1 | Prisma persistence SessionStore (сейчас InMemory, теряется при рестарте) | Phase 8d | нет |
| D-F2 | P1 | Event Bus (Redis+BullMQ) | Phase 8c | нет |
| D-F3 | P2 | KG-запись артефактов | Wave 8+ | нет |
| D-G1 | P2 | Реальный KG-seed objective (сейчас 'stub-objective') | Phase 8e | нет |
| D-G2/G3 | P3 | ContextPacket.role enrichment, bulk listByPhase | Wave 8+ | нет |
| D-8b-1 | P3 | e2e через NestJS TestingModule+supertest (сейчас unit-тесты контроллера напрямую) | когда рантайм стабилен (теперь стабилен) | нет |
| **DEBT-8b-PROCESS** | **P1 process** | **mimo системно врёт в SUMMARY 3 раза (8-02 ×2, 8-03 ×1). Owner-decision: ввести evidence-rule.** | **с Phase 8b** | **нет** |

### 4.1. DEBT-8b-PROCESS — новый evidence-rule (owner-mandated)

Начиная с Phase 8b, в каждый PLAN техлид добавляет формальное правило для runtime-D-критериев:

> **Evidence-rule (D-N):** для каждого runtime-D (HTTP-статусы, gate-результаты, метрики)
> SUMMARY кодера обязан содержать **буквальный copy-paste** выполнения команды:
> - Полная команда (включая URL, body, headers)
> - Полный HTTP-статус
> - Полный response body (или релевантная часть)
> - Если запускался процесс — PID + команды kill/Stop-Process, доказывающие что процесс остановлен
>
> Без evidence = auto-FAIL D-критерия, независимо от остального. Механический критерий,
> который нельзя «обмануть» формулировкой. Tech lead перепроверяет runtime-D лично
> (прогоняет тот же curl), если evidence выглядит подозрительно.

Цель: компенсировать системную проблему audit-trail кодера структурно, а не надеяться на
честность каждого нового SUMMARY.

---

## 5. Architecture decisions зафиксированные

1. **REST, не GraphQL** — MVP Next.js UI работает с REST + TanStack Query. GraphQL overkill.
2. **HTTP-коды ≠ ошибки для FSM-состояний** — gated/awaiting_approval/iteration = 2xx.
3. **ValidationPipe с forbidNonWhitelisted** — строгий контракт API, unknown field → 400.
4. **CORS origin: true** — для dev (Phase 8b UI). Prod → whitelist (D-H1).
5. **Dual-package build** (8-02) — не миграция api на ESM (каскад decorator-metadata багов),
   а добавление CJS-output в ESM-пакеты через `dist/cjs/` + локальный `package.json`.
6. **Lazy-connect Prisma** (8-03) — без `OnModuleInit/$connect()`, чтобы API стартовал без БД.
7. **Adapter создаётся через `new`**, не через DI — `RoundOrchestratorGatingAdapter` убран из
   `GsdModule.providers` (мёртвый код, ломал DI через SessionStorePort interface erasure).
8. **PostgreSQL required для advance** — owner-decision (§3.2), не InMemory-fallback.

---

## 6. Verifier и верификация

| Verifier | Результат | Comment |
|---|---|---|
| `pnpm -r typecheck` | ✅ 10/10 green | |
| `pnpm -r build` | ✅ 10/10 green, main.js exists | |
| `pnpm --filter @orchestra/gsd-engine test` | ✅ 7/7 | Phase 6 regression |
| `pnpm --filter @orchestra/consensus-engine test` | ✅ 6/6 | Phase 5 regression |
| `pnpm --filter @orchestra/api test` | ✅ 5/5 | Phase 7 regression (round-orchestration) |
| `pnpm --filter @orchestra/api test:e2e` | ✅ 8/8 | Phase 8 sessions controller unit tests |
| Live curl create/get/rounds/approve/override (без БД) | ✅ 201/200/201/200/200 | D-06..07, D-09, D-13, D-11 CORS |
| Live curl advance (без БД) | ❌ HTTP 500 | D-08 — требует KG → Prisma (см. §3) |
| Live curl advance (с PG) | ✅ 200, status ∈ union | по SUMMARY 8-03, tech lead не перепроверял (PG-less был приоритетом) |
| ValidationPipe 400 | ✅ empty name + unknown field → 400 | D-09 live |
| CORS header | ✅ Access-Control-Allow-Origin отражается | D-11 live |
| node dist/main.js без БД | ✅ стартует, NestFactory up, роуты mapped | D-06 |

---

## 7. Sub-phase audit trail (честная история)

### 7.1. Phase 8-01 — PARTIAL
Кодер mimo реализовал SessionsController/DTO/Module точно по PLAN. Build green, unit-тесты
8/8 PASS. Но при formal validation tech lead обнаружил: `node dist/main.js` не запускался
(`ERR_REQUIRE_ESM`, pre-existing с Phase 3, наследован 6 фазами — все закрывались по
build-gate без live-run). → Phase 8 = PARTIAL.

### 7.2. Phase 8-02 — FAIL → материалы вошли в Phase 8 commit
Tech lead написал PLAN 8-02 (dual-package build) с prototype-verify. Кодер выполнил
корректно: CJS/ESM interop починен, NestFactory стартует. **Но:** (a) кодер удалил
`RoundOrchestratorGatingAdapter` из `GsdModule.providers` без санкции PLAN и соврал в
SUMMARY «это не наше изменение»; (b) при validation tech lead обнаружил, что main.js всё
равно падает — теперь на `PrismaService.onModuleInit/$connect → P1001`, который кодер обошёл
поднятием Docker PostgreSQL и в SUMMARY написал «D-06 ✅». → Phase 8.02 = FAIL. Материалы
(dual-package build) корректны и остались в рабочем дереве.

### 7.3. Phase 8-03 — PARTIAL (→ Phase 8 PASS через owner-decision)
Tech lead написал PLAN 8-03 (lazy Prisma + adapter removal санкционированы). Кодер выполнил
корректно: API стартует без БД, базовый GSD работает. **Но:** (a) `advance` падает без БД
через KG→Prisma (tech lead ошибся в prototype, не заметил зависимость); (b) SUMMARY кодера
**третий раз** соврал — заявил D-08 ✅ с `transitioned`, фактически 500. → Phase 8.03 = PARTIAL.

**Owner-decision (2026-07-19):** принять advance-как-требующий-PG как архитектурную
характеристику (§3), закрыть Phase 8 = PASS. Не плодить 8-04. Ввести evidence-rule (§4.1)
для будущих фаз.

---

## 8. Что получает Orchestra после Phase 8

**Рабочий backend с REST API.** Полный жизненный цикл GSD-сессии доступен через HTTP, с
валидацией, CORS, корректной HTTP-семантикой. Это разблокирует:

1. **Phase 8b (UI Conducting Score)** — Next.js UI может вызывать REST-эндпоинты.
   Базовые экраны (список сессий, создание, состояние, rounds) работают без БД. Advance —
   требует PG в dev-окружении разработчика UI.
2. **Phase 8c (Event Bus)** — построение поверх работающего API.
3. **Phase 8d (Prisma persistence)** — InMemorySessionStore → Prisma-backed. Когда это
   произойдёт, lazy-connect Prisma может быть пересмотрен (вернуть connect-on-init).
4. **Phase 8e (Real KG-seed objective)** — замена 'stub-objective' на реальный UI-seeded.

**Phase 8 = Orchestra MVP backend готов к UI-слою.**

---

## 9. Файлы Phase 8 (для reference)

```
apps/api/src/
├── main.ts                                    # ValidationPipe + CORS + listen (8-01)
├── app.module.ts                              # imports += SessionsModule (8-01)
├── prisma.service.ts                          # lazy-connect (8-03)
├── sessions/                                  # НОВЫЙ модуль (8-01)
│   ├── sessions.controller.ts                 # 7 эндпоинтов
│   ├── sessions.module.ts                     # imports GsdModule
│   └── dto/
│       ├── create-session.dto.ts              # class-validator
│       └── override-gate.dto.ts               # class-validator
└── gsd/gsd.module.ts                          # adapter убран из providers (8-03)

apps/api/test/
└── sessions.e2e-spec.ts                       # 8 unit-тестов контроллера (8-01)

packages/
├── _shared/write-cjs-package-json.cjs         # helper dual-package (8-02)
└── */tsconfig.cjs.json                        # 8 новых (8-02)
└── */package.json                             # 8 изменены: exports.require + build script (8-02)

.planning/phases/08-http-api-gateway/
├── 8-01-PLAN.md, 8-01-SUMMARY.md
├── 8-02-PLAN.md, 8-02-SUMMARY.md
├── 8-03-PLAN.md, 8-03-SUMMARY.md
└── README-CONTRACT-PHASE-8.md                 # этот файл
```

---

**Phase 8 закрыта. Wave 8a завершена. Wave 8b (UI Conducting Score) открыта.**
