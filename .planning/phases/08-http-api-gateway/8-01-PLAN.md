---
phase: 8
slug: 08-http-api-gateway
wave: B-8
title: "HTTP API Gateway (Wave 8a) — REST-эндпоинты поверх GsdEngineService, Orchestra открыта для любого клиента"
milestone: "Orchestra MVP — Wave 8 (HTTP API Gateway)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-19
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build, 10 пакетов green) + spec-gate (sessions.e2e-spec.ts, supertest end-to-end по всем 6 эндпоинтам)
baseline_before: "Phase 7 заморожена PASS (commit 6de6845): advancePhase реально оркестрирует Context→Router→Consensus через RoundOrchestratorGatingAdapter, 10 пакетов typecheck green, 5/5 round-orchestration.spec.ts green. GsdEngineService уже обёртка над GsdEngine с 7 методами — но НЕ вызвана ни одним HTTP-роутом (нет ни одного контроллера в apps/api/src)."
depends_on:
  - "Phase 7 (GsdEngineService — 7 public методов: startSession/startRound/advancePhase/approveTransition/overrideGate/getSession/listRounds)"
  - "Phase 6 (GsdEngine FSM, AdvancePhaseResult union: transitioned/gated/awaiting_approval/terminal/iteration)"
  - "Phase 2 (KgService — для валидации projectId в DTO, опционально)"
closes_debts:
  - "Открывает Orchestra для любого HTTP-клиента (curl/Postman/позже UI Phase 8b). До Phase 8 система была неисполнима извне — только программно через NestJS DI."
opens_debts_expected:
  - "D-H1: Аутентификация/авторизация эндпоинтов (сейчас публичные, без auth guard) — Wave 8+ когда появятся пользователи."
  - "D-H2: WebSocket/SSE для live-обновлений (Conducting Score UI хочет real-time) — Wave 8b (UI) или отдельная фаза."
  - "D-H3: Pagination/filtering для list-эндпоинтов (сейчас listRounds возвращает все) — при росте данных."
---

# PLAN 8-01 — HTTP API Gateway (Wave 8a)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8-01-SUMMARY.md`. Tech Lead делает code review против `must_haves.truths` ниже.

## 0. Контекст фазы (почему и что)

Phase 7 заморозила реальную wiring Context→Router→Consensus (PASS). `GsdEngineService` имеет
7 public методов и работает in-memory. **Но у Orchestra нет ни одного HTTP-эндпоинта** —
систему нельзя запустить извне (curl/Postman/UI). Это блокирует всю Wave 8 инфраструктуру
(особенно UI Conducting Score Phase 8b) и не даёт пользователю-дирижёру управлять сессиями.

Phase 8 = **открытие Orchestra через HTTP**. Минимальный, самодостаточный слой REST-контроллеров
поверх `GsdEngineService`. **Не требует Event Bus / Prisma / UI** — GsdEngineService уже работает.
Это точно тот минимальный шаг, после которого Orchestra становится **используемой** (можно
создать сессию через curl, запустить раунд, посмотреть gating verdict).

### Архитектурный инвариант (Architecture.md §3, §4)

> «Conductor инициирует раунд через Web App → API Gateway. API Gateway → phase commands →
> GSD Engine.»

Phase 8 материализует стрелку `Web App → API → GSD Engine` (Architecture.md §3 контейнер
«API Gateway», §4 шаг 1-2). REST — протокол conduct'а. **Сам GsdEngineService НЕ меняется** —
контроллеры лишь вызывают его методы и маппят результат в HTTP. Это соблюдается: Phase 6/7
методы + AdvancePhaseResult union уже спроектированы как ответ (Phase 6 README §91:
«Wave 8 добавит контроллеры»).

### Что НЕ в scope (забор на Wave 8b/8c/8d/8e)

- **UI Conducting Score** (Next.js) → Phase 8b. Потребляет эти REST-эндпоинты.
- **Event Bus публикация** (RoundStarted/PhaseChanged на Redis+BullMQ) → Phase 8c, D-F2.
  Контроллеры НЕ публикуют события напрямую — GsdEngine уже формирует DomainEvent, publish =
  no-op default (Phase 6 design decision #6).
- **Prisma/PostgreSQL персистенция SessionStore** → Phase 8d, D-F1. Сейчас InMemorySessionStore
  (теряется при рестарте). Для HTTP API это прозрачно — тот же порт `SessionStorePort`.
- **Реальный KG-seed objective через UI** → Phase 8e, D-G1. Сейчас stub `'stub-objective'`.
- **Аутентификация** → D-H1 (Wave 8+). Эндпоинты публичные, как в MVP-sprint'ах GSD
  Integration.md §7 (авторизация — Sprint 1+, но MVP API может быть открытым для dev).

### Что закрывает фаза

- `apps/api/src/sessions/sessions.controller.ts` — REST-контроллер с 6 эндпоинтами.
- `apps/api/src/sessions/dto/` — DTO с class-validator декораторами (input validation).
- `apps/api/src/sessions/sessions.module.ts` — NestJS-модуль, импортирует GsdModule.
- `apps/api/test/sessions.e2e-spec.ts` — end-to-end supertest по всем 6 эндпоинтам.
- `apps/api/src/main.ts` — `app.useGlobalPipes(new ValidationPipe())` + CORS + listen.
- `apps/api/package.json` — deps: `@nestjs/platform-express`, `class-validator`,
  `class-transformer`; devDeps: `supertest`, `@types/supertest`.
- `apps/api/src/app.module.ts` — imports += SessionsModule.

---

## 1. Архитектурное решение (главное)

**REST-контроллеры в новом `sessions/`-модуле NestJS. GsdEngineService НЕ трогать** — он
уже спроектирован как обёртка над GsdEngine с публичными методами (Phase 6/7). Контроллеры
маппят HTTP → method-call → HTTP.

Обоснование:
- `GsdEngineService` (apps/api/src/gsd/gsd-engine.service.ts) — `@Injectable`, уже в DI через
  `GsdModule.exports` (Phase 6). Идеальный потребитель для контроллера.
- `AdvancePhaseResult` — 5-вариантный discriminated union (Phase 6). Контроллер маппит каждый
  вариант → свой HTTP-код: `transitioned`→200, `gated`→200 (с gaps), `awaiting_approval`→202,
  `terminal`→200, `iteration`→200 (consensus fail — корректное поведение).
- **HTTP-коды ≠ ошибки для корректных FSM-состояния.** `gated`/`awaiting_approval`/`iteration` —
  это НЕ ошибки (система работает как задумано), а информационные состояния. 4xx/5xx — только
  для валидационных ошибок (400) и «session not found» (404).

**Альтернативы отвергаются:**
- GraphQL вместо REST → overkill для MVP, UI Next.js прекрасно работает с REST + TanStack Query.
- DTO без class-validator → ручная валидация = шум, NestJS-канон — ValidationPipe + class-validator.
- Маппить `gated`→422 → ломает семантику (gating fail — корректный результат Consensus, не
  ошибка запроса).

---

## 2. Целевая структура (файлы, которые создаёт кодер)

```
apps/api/
├── src/
│   ├── app.module.ts                              # ИЗМЕНИТЬ: imports += SessionsModule
│   ├── main.ts                                    # ИЗМЕНИТЬ: ValidationPipe + CORS
│   └── sessions/                                  # НОВЫЙ модуль
│       ├── sessions.module.ts                     # НОВЫЙ: imports GsdModule, exports SessionsController
│       ├── sessions.controller.ts                 # НОВЫЙ: 6 REST-эндпоинтов
│       └── dto/                                   # НОВЫЙ
│           ├── create-session.dto.ts              # НОВЫЙ: { name, projectId }
│           ├── override-gate.dto.ts               # НОВЫЙ: { reason: string }
│           └── advance-response.dto.ts            # НОВЫЙ (опц.): typed-ответ advancePhase
│
├── test/                                          # НОВАЯ директория (вне src, не typecheck-попадает в build)
│   └── sessions.e2e-spec.ts                       # НОВЫЙ: supertest end-to-end
│
└── package.json                                   # ИЗМЕНИТЬ: +deps/devDeps, +test:e2e script
```

### Файлы, которые НЕ трогать (anti-conflict)

| Зона | Почему | Проверка |
|---|---|---|
| `packages/**` | Все пакеты заморожены (Phase 2-7) | `git diff packages/` → пусто |
| `apps/api/src/gsd/**` | Phase 6/7 — GsdEngineService/adapter/seed | `git diff apps/api/src/gsd/` → пусто |
| `apps/api/src/{kg,context,roles,consensus,providers}/**` | Фазы 2-5 модули | `git diff` → пусто по каждой |
| `apps/api/prisma/schema.prisma` | Prisma schema — Phase 2, не трогать (persistence → Phase 8d) | `git diff` → пусто |
| `apps/web/` | Frontend — Phase 8b | `git diff apps/web/` → пусто |
| `docs/**` | Канон | `git diff docs/` → пусто |
| `role-manifests/`, `prompts/` | Seed-данные | `git diff` → пусто |
| `.planning/phases/0[1-7]/` | Замороженные фазы | `git diff` → пусто |
| `tsconfig.base.json`, `pnpm-workspace.yaml`, `apps/api/tsconfig.json` | Корневой/пакетный конфиг | `git diff` → пусто |

**Единственные изменения:**
- `apps/api/src/app.module.ts` — imports += SessionsModule
- `apps/api/src/main.ts` — ValidationPipe + CORS
- `apps/api/src/sessions/**` — НОВЫЙ модуль (controller + module + dto/)
- `apps/api/test/sessions.e2e-spec.ts` — НОВЫЙ
- `apps/api/package.json` — deps/devDeps/test:e2e

---

## 3. sessions.controller.ts (главный файл фазы)

```typescript
import { Body, Controller, Get, Param, Post, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { GsdEngineService } from '../gsd/gsd-engine.service.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { OverrideGateDto } from './dto/override-gate.dto.js';

/**
 * REST API Gateway для GSD-сессий (Architecture.md §3 API Gateway, §4 шаги 1-2).
 *
 * 6 эндпоинтов управляют полным жизненным циклом сессии:
 *   POST   /sessions               — создать сессию (Discover)
 *   GET    /sessions/:id           — состояние сессии (фаза, раунды)
 *   POST   /sessions/:id/rounds    — начать новый раунд в текущей фазе
 *   POST   /sessions/:id/advance   — продвинуть фазу (gating + FSM)
 *   POST   /sessions/:id/approve   — подтвердить hard gate (Architecture/Consensus)
 *   POST   /sessions/:id/override  — owner override gating (audit)
 *   GET    /sessions/:id/rounds    — список раундов сессии
 *
 * HTTP-семантика: gated/awaiting_approval/iteration — НЕ ошибки (корректные FSM-состояния),
 * возвращаются 2xx. 4xx — только для валидационных ошибок (NestJS ValidationPipe → 400)
 * и «session not found» (404). 5xx — внутренние ошибки.
 */
@Controller('sessions')
export class SessionsController {
  constructor(private readonly gsd: GsdEngineService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Body() dto: CreateSessionDto) {
    return this.gsd.startSession(dto.name, dto.projectId);
  }

  @Get(':id')
  async getSession(@Param('id') id: string) {
    const session = await this.gsd.getSession(id);
    if (!session) throw new NotFoundException(`Session not found: ${id}`);
    return session;
  }

  @Post(':id/rounds')
  @HttpCode(HttpStatus.CREATED)
  async startRound(@Param('id') id: string) {
    try {
      return await this.gsd.startRound(id);
    } catch (e) {
      throw this.mapEngineError(e);
    }
  }

  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  async advancePhase(@Param('id') id: string) {
    try {
      // AdvancePhaseResult — 5-вариантный union. Возвращаем как есть (status-дискриминатор).
      // HTTP-код 200 для ВСЕХ вариантов: transitioned/gated/awaiting_approval/terminal/iteration
      // — это корректные FSM-состояния, не ошибки.
      return await this.gsd.advancePhase(id);
    } catch (e) {
      throw this.mapEngineError(e);
    }
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approveTransition(@Param('id') id: string) {
    try {
      return await this.gsd.approveTransition(id);
    } catch (e) {
      throw this.mapEngineError(e);
    }
  }

  @Post(':id/override')
  @HttpCode(HttpStatus.OK)
  async overrideGate(@Param('id') id: string, @Body() dto: OverrideGateDto) {
    try {
      return await this.gsd.overrideGate(id, dto.reason);
    } catch (e) {
      throw this.mapEngineError(e);
    }
  }

  @Get(':id/rounds')
  async listRounds(@Param('id') id: string) {
    const session = await this.gsd.getSession(id);
    if (!session) throw new NotFoundException(`Session not found: ${id}`);
    return this.gsd.listRounds(id);
  }

  /** Маппинг ошибок GsdEngine (Error с сообщением 'Unknown session') → NotFoundException. */
  private mapEngineError(e: unknown) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('Unknown session')) return new NotFoundException(msg);
    return e; // проброс — NestJS вернёт 500
  }
}
```

> **Порядок эндпоинтов:** `@Get(':id')` и `@Get(':id/rounds')` — разные пути, конфликта нет.
> Но `@Post(':id/rounds')` и `@Get(':id/rounds')` — разные HTTP-методы, NestJS резолвит по методу.
> Кодер: убедиться, что статических роутов нет冲突 (здесь их нет — все динамические по `:id`).

---

## 4. DTO (validation)

```typescript
// apps/api/src/sessions/dto/create-session.dto.ts
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  projectId!: string;
}
```

```typescript
// apps/api/src/sessions/dto/override-gate.dto.ts
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class OverrideGateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
```

> **ValidationPipe в main.ts** (см. §5) применяет декораторы автоматически — невалидный body
> → 400 Bad Request с детальным сообщением. DTO — это контракт между клиентом и API.

---

## 5. main.ts (global pipes + CORS)

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  // Global validation: DTOs с class-validator декораторами → 400 на невалидный body.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // strip unknown properties
      forbidNonWhitelisted: true, // 400 если есть неизвестные поля (строгий контракт)
      transform: true,            // auto-transform payload в DTO instance
    }),
  );

  // CORS: Phase 8b UI (Next.js, порт 3000) сможет вызывать API (порт 3001).
  app.enableCors({ origin: true, credentials: true });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`Orchestra API listening on :${port}`);
}
bootstrap();
```

> **CORS origin: true** — отражает `Origin` запроса. Для dev (Next.js на :3000 → API на :3001)
> достаточно. Для prod — заменить на whitelist доменов (долг D-H1, auth-фаза).

---

## 6. sessions.module.ts + app.module.ts

```typescript
// apps/api/src/sessions/sessions.module.ts
import { Module } from '@nestjs/common';
import { GsdModule } from '../gsd/gsd.module.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  imports: [GsdModule],                  // GsdModule.exports = [GsdEngineService] (Phase 6)
  controllers: [SessionsController],
})
export class SessionsModule {}
```

```typescript
// apps/api/src/app.module.ts — ИЗМЕНИТЬ
import { Module } from '@nestjs/common';
import { KgModule } from './kg/kg.module.js';
import { ContextModule } from './context/context.module.js';
import { RolesModule } from './roles/roles.module.js';
import { ConsensusModule } from './consensus/consensus.module.js';
import { GsdModule } from './gsd/gsd.module.js';
import { SessionsModule } from './sessions/sessions.module.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule, GsdModule, SessionsModule],
})
export class AppModule {}
```

---

## 7. Тестовый сьют (часть verifier'а)

`apps/api/test/sessions.e2e-spec.ts` — end-to-end через NestJS TestingModule + supertest.
**Не мокает** GsdEngineService — использует реальный (in-memory), как Phase 6/7 spec'и.

> **Почему e2e через TestingModule, а не mock:** проверяем **всю цепочку** HTTP → controller →
> GsdEngineService → GsdEngine FSM → RoundOrchestratorGatingAdapter → Context/Router/Consensus.
> Это самая ценная проверка — что публичный контракт API действительно работает. In-memory store
> + MockHttpPort (Phase 4) делают это детерминированным без БД/LLM. Если mock GsdEngineService,
> тест проверяет только маппинг, а не реальную работу системы.
>
> **Location:** `apps/api/test/` (НЕ `src/`) — вне `tsconfig.include: ["src"]`, чтобы не
> попадать в production build. Запуск через tsx. Это повторяет канон Phase 6 (`packages/gsd-engine/test/`).

```typescript
// apps/api/test/sessions.e2e-spec.ts (минимум 7 сценариев)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';

describe('SessionsController (e2e)', () => {
  let app: INestApplication;

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  after(async () => { await app.close(); });

  // E1: POST /sessions → 201, возвращает Session{currentPhase:'Discover', rounds:[]}
  it('E1 POST /sessions creates session in Discover phase', async () => {
    const res = await request(app.getHttpServer())
      .post('/sessions')
      .send({ name: 'feature-X', projectId: 'proj-1' })
      .expect(201);
    assert.equal(res.body.currentPhase, 'Discover');
    assert.equal(res.body.name, 'feature-X');
    assert.deepEqual(res.body.rounds, []);
    assert.ok(res.body.id);
  });

  // E2: POST /sessions с невалидным body (пустое name) → 400 (ValidationPipe)
  it('E2 POST /sessions with empty name → 400', async () => {
    await request(app.getHttpServer())
      .post('/sessions')
      .send({ name: '', projectId: 'proj-1' })
      .expect(400);
  });

  // E3: POST /sessions с extra unknown field → 400 (forbidNonWhitelisted)
  it('E3 POST /sessions with unknown field → 400', async () => {
    await request(app.getHttpServer())
      .post('/sessions')
      .send({ name: 'x', projectId: 'p', evil: true })
      .expect(400);
  });

  // E4: GET /sessions/:id → 200, возвращает созданную session
  it('E4 GET /sessions/:id returns session', async () => {
    const created = await request(app.getHttpServer())
      .post('/sessions').send({ name: 'feature-Y', projectId: 'proj-1' });
    const res = await request(app.getHttpServer())
      .get(`/sessions/${created.body.id}`)
      .expect(200);
    assert.equal(res.body.id, created.body.id);
  });

  // E5: GET /sessions/:nonexistent → 404
  it('E5 GET /sessions/:nonexistent → 404', async () => {
    await request(app.getHttpServer()).get('/sessions/nope').expect(404);
  });

  // E6: полный цикл — POST /sessions → POST /rounds → POST /advance (Discover→Goal, MockHttpPort
  //     даёт достаточно responses для pass ИЛИ gated/iteration — проверить корректный union status)
  it('E6 full cycle: create → round → advance returns valid AdvancePhaseResult', async () => {
    const created = await request(app.getHttpServer())
      .post('/sessions').send({ name: 'cycle', projectId: 'proj-1' });
    const id = created.body.id;

    await request(app.getHttpServer()).post(`/sessions/${id}/rounds`).expect(201);

    const res = await request(app.getHttpServer())
      .post(`/sessions/${id}/advance`)
      .expect(200);

    // status ∈ {transitioned, gated, awaiting_approval, terminal, iteration}
    const validStatuses = ['transitioned', 'gated', 'awaiting_approval', 'terminal', 'iteration'];
    assert.ok(validStatuses.includes(res.body.status), `unexpected status: ${res.body.status}`);
  });

  // E7: POST /sessions/:id/override с reason → 200 (audit record)
  it('E7 POST /sessions/:id/override with reason → 200', async () => {
    const created = await request(app.getHttpServer())
      .post('/sessions').send({ name: 'override-test', projectId: 'proj-1' });
    const id = created.body.id;
    await request(app.getHttpServer()).post(`/sessions/${id}/rounds`).expect(201);

    const res = await request(app.getHttpServer())
      .post(`/sessions/${id}/override`)
      .send({ reason: 'owner skip gating' })
      .expect(200);
    // override продвигает фазу → currentPhase изменился
    assert.notEqual(res.body.currentPhase, 'Discover');
  });

  // E8 (опц.): POST /sessions/:id/approve до awaiting_approval → поведение engine (no approval pending)
  //           — документировать что возвращает engine. Не делать жёсткий assert.
});
```

> **Test-script в package.json:**
> ```json
> "test:e2e": "node --import tsx --test test/sessions.e2e-spec.ts"
> ```
> Запуск: `pnpm --filter @orchestra/api test:e2e`. Канон как Phase 6/7 (node:test + tsx).

> **Порт-конфликт:** e2e использует `app.init()` (не `listen`), значит реальный порт не
> открывается. supertest работает через `app.getHttpServer()` напрямую. Безопасно для CI.

---

## 8. must_haves.truths (D-критерии для code review)

### Архитектура / разделение слоёв

- **D-01** `packages/**` НЕ изменён (anti-conflict Phase 2-7).
  `git diff packages/` → пусто.
- **D-02** `apps/api/src/gsd/**` НЕ изменён (Phase 6/7 — GsdEngineService/adapter/seed).
  `git diff apps/api/src/gsd/` → пусто.
- **D-03** `apps/api/src/{kg,context,roles,consensus,providers}/**` НЕ изменены (фазы 2-5).
  `git diff` → пусто по каждой.
- **D-04** `SessionsController` в `apps/api/src/sessions/` (новый модуль), НЕ расширяет
  GsdEngineService. Только потребляет через DI.
- **D-05** Контроллер вызывает ТОЛЬКО существующие методы GsdEngineService (7 штук из Phase 6).
  Не добавляет новые методы в сервис.

### Эндпоинты / HTTP-семантика

- **D-06** 6 эндпоинтов реализованы:
  `POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/rounds`,
  `POST /sessions/:id/advance`, `POST /sessions/:id/approve`, `POST /sessions/:id/override`.
  (+`GET /sessions/:id/rounds` — опц., но рекомендуется для UI).
- **D-07** HTTP-коды: `POST /sessions`→201, `POST /sessions/:id/rounds`→201, остальные POST→200,
  GET→200. `GET /sessions/:nonexistent`→404.
- **D-08** `advancePhase` возвращает 200 для ВСЕХ вариантов AdvancePhaseResult (transitioned/
  gated/awaiting_approval/terminal/iteration) — это НЕ ошибки. Только unknown session → 404.
- **D-09** Unknown session во ВСЕХ эндпоинтах с `:id` → 404 (через `mapEngineError` или
  явный getSession check).

### Validation

- **D-10** `CreateSessionDto` и `OverrideGateDto` с class-validator декораторами
  (`@IsString`, `@IsNotEmpty`, `@MaxLength`).
- **D-11** `main.ts` включает `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`.
- **D-12** Невалидный body (пустое name) → 400. Unknown field → 400 (forbidNonWhitelisted).

### NestJS integration

- **D-13** `SessionsModule.imports` = [GsdModule] (получает GsdEngineService через
  GsdModule.exports Phase 6).
- **D-14** `AppModule.imports` += SessionsModule.
- **D-15** `main.ts`: CORS включён (`enableCors`) — для Phase 8b UI.
- **D-16** `apps/api build` green (NestJS DI резолвит controller + service).

### Тесты

- **D-17** `apps/api/test/sessions.e2e-spec.ts` существует, минимум 7 сценариев (E1-E7).
- **D-18** E2e использует NestJS TestingModule + реальный AppModule (НЕ mock GsdEngineService).
  Проверяет всю цепочку HTTP→controller→engine→adapter.
- **D-19** Тесты не требуют БД/LLM (InMemorySessionStore + MockHttpPort). Pure + determinism.
- **D-20** Test runnable: `node --import tsx --test test/sessions.e2e-spec.ts` → green.

### Build / регрессия

- **D-21** `pnpm -r typecheck` → 10 пакетов green. Exit 0.
- **D-22** `pnpm --filter @orchestra/api build` → green. Exit 0.
- **D-23** `pnpm --filter @orchestra/api test` → Phase 7 spec (round-orchestration) всё ещё
  green (регрессия исключена).
- **D-24** `pnpm --filter @orchestra/api test:e2e` → новый e2e green.
- **D-25** Clean rebuild api: `rm -rf apps/api/dist && build` → `apps/api/dist/main.js` exists.
- **D-26** `apps/web/` не тронут (git status пуст).
- **D-27** Фазы 2-7 пакеты не тронуты (`git diff packages/` → пусто).
- **D-28** Prisma schema не тронута (`git diff apps/api/prisma/` → пусто).

### deps

- **D-29** `apps/api/package.json` добавлены: `@nestjs/platform-express` (deps), `class-validator`
  (deps), `class-transformer` (deps), `supertest` (devDeps), `@types/supertest` (devDeps).
- **D-30** Добавлен `"test:e2e"` script. Существующий `"test"` (Phase 7) НЕ тронут.

---

## 9. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-30 PASS.
2. `pnpm -r typecheck` + build 10 пакетов green.
3. `test` (Phase 7 spec) + `test:e2e` (новый) → green.
4. Anti-conflict: `git diff` по всем замороженным зонам → пусто.
5. **HTTP API исполняем end-to-end:** можно запустить `pnpm --filter @orchestra/api start:dev`
   и через curl выполнить полный цикл:
   ```bash
   curl -X POST localhost:3001/sessions -d '{"name":"x","projectId":"p"}' -H 'Content-Type: application/json'
   curl localhost:3001/sessions/<id>
   curl -X POST localhost:3001/sessions/<id>/rounds
   curl -X POST localhost:3001/sessions/<id>/advance
   ```
   Все возвращают корректные JSON-ответы (Session/AdvancePhaseResult).

**Фаза НЕ выполнена, если:**
- Контроллер мутирует GsdEngineService (D-04/D-05 FAIL) — ломает разделение слоёв.
- E2e мокает GsdEngineService (D-18 FAIL) — не проверяет реальную работу системы.
- ValidationPipe отсутствует (D-11 FAIL) — нет input validation.
- advancePhase возвращает 4xx для gated/iteration (D-08 FAIL) — ломает HTTP-семантику.
- build/typecheck красный (D-21/D-22 FAIL).

---

## 10. Порядок работы кодера

1. **Прочитать** `apps/api/src/gsd/gsd-engine.service.ts` (7 методов — это твой API surface),
   `packages/gsd-engine/src/gsd-engine.ts` (AdvancePhaseResult union, Phase 6),
   `packages/domain/src/session.ts` (Session/Round типы для ответов).
2. **Установить deps:** `pnpm --filter @orchestra/api add @nestjs/platform-express class-validator
   class-transformer && pnpm --filter @orchestra/api add -D supertest @types/supertest`.
3. **DTO** (`dto/create-session.dto.ts`, `dto/override-gate.dto.ts`) — §4.
4. **sessions.controller.ts** — 6 эндпоинтов + mapEngineError (§3).
5. **sessions.module.ts** — imports GsdModule, controllers (§6).
6. **app.module.ts** — imports += SessionsModule (§6).
7. **main.ts** — ValidationPipe + CORS (§5).
8. **test/sessions.e2e-spec.ts** — 7+ сценариев через supertest (§7).
9. **package.json** — `test:e2e` script (существующий `test` не трогать) (§7).
10. Прогон verifier: `pnpm install` → `pnpm -r typecheck` → `pnpm -r build` →
    `pnpm --filter @orchestra/api test` (Phase 7 регрессия) →
    `pnpm --filter @orchestra/api test:e2e`. Всё green.
11. **Ручной smoke-test** (опц., но рекомендуется): `start:dev` + curl полный цикл (§9 п.5).
12. `8-01-SUMMARY.md`.

**Оценка:** ~2-3 часа.

---

## 11. Design notes (почему так)

1. **REST, не GraphQL.** MVP Next.js UI прекрасно работает с REST + TanStack Query. GraphQL —
   overkill (нет сложных вложенных запросов; Session→Rounds→Responses тривиальны). Wave 8b
   подтвердит или пересмотрит.

2. **HTTP-коды ≠ ошибки для корректных FSM-состояний.** `gated` (gating fail, Consensus нашёл
   пробелы), `awaiting_approval` (hard gate, ждёт дирижёра), `iteration` (Consensus-fail→loop) —
   это **информационные** состояния, система работает как задумано. Возвращать для них 4xx —
   ломает семантику (клиент думает «ошибка запроса», а это «система корректно отклонила»).
   Только 200 + `status`-дискриминатор в JSON. 4xx — для ошибок клиента (400 validation,
   404 not found), 5xx — для внутренних.

3. **Не мокать GsdEngineService в e2e.** Самая ценная проверка — что публичный HTTP-контракт
   действительно работает с реальным engine. Mock проверяет только маппинг (controller logic),
   а нам нужна уверенность, что вся цепочка HTTP→controller→engine→adapter жива. In-memory store
   + MockHttpPort делают это возможным без БД/LLM. Повторяет канон Phase 6/7 (детерминированный
   тест реального поведения).

4. **CORS origin: true.** Для dev достаточно (Next.js :3000 → API :3001). Для prod — whitelist
   доменов, но это привязано к auth-фазе (D-H1). Не premature-optimize.

5. **DTO + forbidNonWhitelisted.** Строгий контракт: unknown поля → 400. Это защищает от
   typо-багов клиента (например, `project_id` вместо `projectId` → явная ошибка, а не silent
   игнорирование). Соответствует REST-best-practices.

6. **test/ вне src/.** `apps/api/tsconfig.include: ["src"]` — значит test-файлы в `src/`
   попадают в production build (плохо). `test/` — отдельная директория, запускается через tsx,
   не компилируется в dist. Канон: test-код не должен утекать в runtime. Повторяет структуру
   Phase 6 (`packages/gsd-engine/test/`).

7. **GsdEngineService не расширяется.** Контроллер — тонкий слой HTTP→method. Если понадобится
   новая функциональность (например, list sessions), она идёт в GsdEngineService через ОТДЕЛЬНУЮ
   фазу (изменение Phase 6 зоны = anti-conflict). Phase 8 только потребляет существующий API.

8. **Phase 8b UI готов к старту после Phase 8.** UI вызывает эти 6 эндпоинтов через TanStack
   Query. Conducting Score = визуализация Session.currentPhase + Rounds[] + AdvancePhaseResult.
   Без HTTP API UI не имеет источника данных — поэтому Phase 8 ПРЕДШЕСТВУЕТ Phase 8b.

---

## 12. Долги, которые фаза ОТКРЫВАЕТ

- **D-H1** Аутентификация/авторизация эндпоинтов (сейчас публичные). **Когда:** Wave 8+
  (когда появятся пользователи/команды). **Блокирует:** НЕТ (MVP — single-user dev).
- **D-H2** WebSocket/SSE для live-обновлений (UI хочет real-time Phase Changed). **Когда:**
  Phase 8b (UI) ИЛИ отдельная real-time фаза. **Блокирует:** НЕТ (UI может polling).
- **D-H3** Pagination/filtering для list-эндпоинтов. **Когда:** при росте данных. **Блокирует:** НЕТ.

Все non-blocking, имеют явный Wave. MVP API работает с ними как known-limitations.

### Перенесённые долги (без изменений)

- **D-F1** (Prisma/PostgreSQL персистенция) — Phase 8d.
- **D-F2** (Event Bus) — Phase 8c.
- **D-F3** (KG-запись артефактов) — Wave 8+.
- **D-G1** (реальный KG-seed objective через UI) — Phase 8e.
- **D-G2** (обогащение ContextPacket.role), **D-G3** (bulk listByPhase) — Wave 8+.
- D-E1..E4 (Phase 5), D-D1..D4 (Phase 4), D-B2/D-C1/D-C3/D-C4 — Wave 8+.

---

## 13. Что получает Orchestra после Phase 8

Orchestra **открыта для любого HTTP-клиента**. Полный жизненный цикл GSD-сессии доступен через
REST:

```
# Создать сессию (Discover)
curl -X POST localhost:3001/sessions \
  -d '{"name":"feature-X","projectId":"proj-1"}' -H 'Content-Type: application/json'
# → { id: "sess-...", currentPhase: "Discover", rounds: [], ... }

# Начать раунд
curl -X POST localhost:3001/sessions/sess-.../rounds

# Продвинуть фазу (gating + FSM)
curl -X POST localhost:3001/sessions/sess-.../advance
# → { status: "transitioned", from: "Discover", to: "Goal", ... }
#   ИЛИ { status: "gated", phase: "Discover", gaps: [...] }
#   ИЛИ { status: "awaiting_approval", phase: "Architecture" }

# Подтвердить hard gate
curl -X POST localhost:3001/sessions/sess-.../approve

# Owner override (audit)
curl -X POST localhost:3001/sessions/sess-.../override \
  -d '{"reason":"owner skip"}' -H 'Content-Type: application/json'

# Состояние / история раундов
curl localhost:3001/sessions/sess-...
curl localhost:3001/sessions/sess-.../rounds
```

**Phase 6 GsdEngine + Phase 7 wiring + Phase 8 HTTP API = Orchestra используема.** Любой клиент
(скрипт, Postman, будущий UI) может провести сессию от Discover до Consensus. Backend готов к
подключению UI (Phase 8b), Event Bus (Phase 8c), Prisma persistence (Phase 8d).

**Phase 8b кандидаты (UI Conducting Score):**
- Next.js app: список сессий, создание новой.
- Conducting Score: визуализация фаз (Discover→...→Consensus), текущая фаза подсвечена.
- Round timeline: раунды сессии с confidence/gaps.
- Approve/Override buttons: вызывают POST /approve, /override.
- TanStack Query: data-fetching + cache; Zustand: UI state.
- Real-time: polling `/sessions/:id` каждые N сек (D-H2 SSE/WS — опционально).

Безопасно стартовать Phase 8b: HTTP API стабильный контракт (DTO + ValidationPipe), e2e тесты
доказывают работу, CORS открыт для Next.js. Phase 8 готова к исполнению.
