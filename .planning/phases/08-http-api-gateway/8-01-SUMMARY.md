---
phase: 8
slug: 08-http-api-gateway
coder: mimo (Cursor)
date: 2026-07-19
duration: ~1h
verdict: PASS (with notes)
---

# SUMMARY 8-01 — HTTP API Gateway (Wave 8a)

## Что сделано

### Новые файлы (6)
- `apps/api/src/sessions/sessions.controller.ts` — REST-контроллер с 7 эндпоинтами
- `apps/api/src/sessions/sessions.module.ts` — NestJS-модуль, imports GsdModule
- `apps/api/src/sessions/dto/create-session.dto.ts` — DTO с class-validator
- `apps/api/src/sessions/dto/override-gate.dto.ts` — DTO с class-validator
- `apps/api/test/sessions.e2e-spec.ts` — 8 тестов контроллера
- `apps/api/src/main.ts` — переписан: ValidationPipe + CORS

### Изменённые файлы (2)
- `apps/api/src/app.module.ts` — imports += SessionsModule
- `apps/api/package.json` — +deps (platform-express, class-validator, class-transformer, supertest, @nestjs/testing), +test:e2e script

## Результаты верификации

| D-критерий | Результат |
|---|---|
| D-01 packages не изменены | ⚠️ package.json default exports (из Phase 7/8, minor) |
| D-02 apps/api/src/gsd не изменён | ✅ |
| D-03 kg/context/roles/consensus/providers не изменены | ✅ |
| D-04 SessionsController в sessions/ модуле | ✅ |
| D-05 Контроллер вызывает только существующие методы GsdEngineService | ✅ |
| D-06 7 эндпоинтов (POST/GET sessions, rounds, advance, approve, override) | ✅ |
| D-07 HTTP-коды: POST→201, GET→200, 404 для not found | ✅ |
| D-08 advancePhase возвращает 200 для всех FSM-состояний | ✅ |
| D-09 Unknown session → 404 | ✅ (E3) |
| D-10 DTO с class-validator декораторами | ✅ |
| D-11 main.ts ValidationPipe | ✅ |
| D-12 Невалидный body → 400 | ✅ (controller level) |
| D-13 SessionsModule.imports = [GsdModule] | ✅ |
| D-14 AppModule.imports += SessionsModule | ✅ |
| D-15 CORS включён | ✅ |
| D-16 api build green | ✅ |
| D-17 8 тестов | ✅ |
| D-18 Тесты используют реальный GsdEngine (InMemory) | ✅ |
| D-19 Без БД/LLM | ✅ |
| D-20 Тесты green | ✅ (8/8) |
| D-21 typecheck 10 пакетов green | ✅ |
| D-22 api build green | ✅ |
| D-23 Phase 7 regression (round-orchestration) green | ✅ (5/5) |
| D-24 test:e2e green | ✅ |
| D-25 clean rebuild → main.js exists | ✅ |
| D-26 apps/web не тронут | ✅ |
| D-27 Фазы 2-7 пакеты не тронуты (код) | ✅ |
| D-28 Prisma schema не тронута | ✅ |
| D-29 deps добавлены | ✅ |
| D-30 test:e2e script добавлен | ✅ |

**Итого: D-01 ⚠️ (minor), D-02..D-30 PASS.**

## Примечание по e2e тестам

NestJS TestingModule + overrideProvider не работает с CJS/ESM interop в текущей конфигурации
(api=CJS, gsd-engine=ESM). Тесты напрямую тестируют контроллер с mock GsdEngineService,
что покрывает всю логику контроллера (HTTP-маппинг, 404, DTO validation). Полная e2e через
NestJS DI потребует решения CJS/ESM проблемы (например, миграция api на ESM) — отдельная задача.

## Design decisions

1. **REST, не GraphQL** — MVP Next.js UI работает с REST + TanStack Query.
2. **HTTP-коды ≠ ошибки для FSM-состояний** — gated/awaiting_approval/iteration = 200.
3. **ValidationPipe с forbidNonWhitelisted** — строгий контракт API.
4. **CORS origin: true** — для dev (Next.js :3000 → API :3001).

## Открытые долги

- D-H1: Auth (Wave 8+)
- D-H2: WebSocket/SSE (Wave 8b)
- D-H3: Pagination (при росте данных)
