---
phase: 8.02
slug: 08-http-api-gateway
wave: B-8
title: "Fix CJS/ESM interop — dual-package build пакетов @orchestra/* (cleanup-фаза для Phase 8 PASS)"
milestone: "Orchestra MVP — Wave 8 (HTTP API Gateway)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-19
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build) + runtime-gate (live curl-цикл по success-criteria Phase 8 §9 п.5) + regression-gate (Phase 6/7/8 unit-тесты green)
baseline_before: "Phase 8 PARTIAL (commit 78b1f85): SessionsController/DTO/Module архитектурно корректны, build green, unit-тесты 8/8 PASS. НО node dist/main.js падает ERR_REQUIRE_ESM при require('@orchestra/prompt-registry') — pre-existing баг с Phase 3, наследован 6 фазами. Делает success-criterion Phase 8 §9 п.5 (curl-cycle) невыполнимым. Phase 8 не закрыта."
depends_on:
  - "Phase 8 (78b1f85) — SessionsController, нужен рабочий рантайм для verifier'а)"
  - "Phase 3 (f2d2cac) — где впервые появился prompts.service → импорт prompt-registry"
closes_debts:
  - "DEBT-8-01 (P0 BLOCKER Phase 8 exit): main.js не запускается (ERR_REQUIRE_ESM)"
  - "DEBT-8-02 (P1 BLOCKER Phase 8 exit): D-12 (400 на невалидный body) — ValidationPipe не покрывается тестом, т.к. рантайм падает"
  - "DEBT-8-03 (P2): D-18 (e2e через TestingModule+supertest) — становится возможным после починки interop"
opens_debts_expected:
  - "Нет. Это cleanup-фаза, не открывает новых долгов. Закрывает 3 существующих."
---

# PLAN 8-02 — Fix CJS/ESM interop (dual-package build)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8-02-SUMMARY.md`. Tech Lead делает code review против `must_haves.truths` ниже.

## 0. Контекст фазы (почему и что)

### 0.1. Что сломано

`apps/api` — единственный CommonJS-модуль в monorepo (`package.json` → `"type":"commonjs"`).
Все 8 пакетов `packages/@orchestra/*` — чистый ESM (`"type":"module"`, наследуют root
`tsconfig.base.json` с `module:NodeNext`, используют `.js` extensions в импортах).

Когда `apps/api/src/**/*.ts` импортирует `@orchestra/*` пакеты, TypeScript CJS-сборка
(`tsconfig.json: module:"CommonJS"`) компилирует эти `import` в `require()`.

Node запрещает `require()` ESM-модулей → `dist/main.js` падает при bootstrap:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module F:\Orchestra\packages\prompt-registry\dist\index.js
from F:\Orchestra\apps\api\dist\prompts\prompts.service.js not supported.
```

**Этот баг существует с Phase 3** (commit `f2d2cac` — появление `prompts.service.ts`).
6 фаз (3–8) закрывались по build-gate без live-run → никто не замечал.

Phase 8 добавила `"default":"./dist/index.js"` в exports пакетов — но это **не лечит** корень:
проблема не в exports-map, а в том что `require(ESM)` запрещён Node'ом на уровне рантайма.

### 0.2. Почему миграция apps/api на ESM отвергается

Tech lead провёл эксперимент (prototype-verify): `apps/api` + `"type":"module"` + `module:NodeNext`
+ `import 'reflect-metadata'` в `main.ts`. Build green, `ERR_REQUIRE_ESM` ушёл, NestFactory
стартует — **но вскрылся второй скрытый баг**: `emitDecoratorMetadata` под ESM не выдаёт
type-metadata для type-only параметров (интерфейсов `SessionStorePort`, `RoleRegistryPort`,
`ProviderRegistryPort`, `HttpPort`). NestJS DI падает:

```
Nest can't resolve dependencies of the RoundOrchestratorGatingAdapter
  (..., ?)  ← index [4] = SessionStorePort, type-erased под ESM
```

Миграция api на ESM требует каскадного рефакторинга: каждый constructor-injection интерфейса
потребует явного `@Inject(TOKEN)` декоратора. Это **отдельная большая волна** с высоким риском
регрессий Phase 6/7. Не подходит под cleanup-фазу.

### 0.3. Выбранное решение: dual-package build пакетов

Каждый `packages/@orchestra/*` пакет получает:
1. **Существующий ESM-build** в `dist/` (как сейчас — не трогать, остаётся `type:module` primary).
2. **Новый CJS-build** в `dist/cjs/` с локальным `dist/cjs/package.json` (`"type":"commonjs"`).
3. **Расширенный `exports` map** с condition `require` → `./dist/cjs/index.js`.

Node-разрешение для CJS-consumer (`apps/api`): `require("@orchestra/x")` → condition `require`
→ `./dist/cjs/index.js` (CJS, локальный `package.json` перекрывает `type:module` родителя) → работает.

ESM-consumer (будущие, если появятся): condition `import` → `./dist/index.js` (как раньше).

### 0.4. Prototype-verify (техлидом, до PLAN)

Tech lead проверил решение на одном пакете (`@orchestra/prompt-registry`):
1. `npx tsc src/index.ts --module commonjs --moduleResolution node --outDir dist/cjs` — green.
2. `echo '{"type":"commonjs"}' > dist/cjs/package.json`.
3. `package.json.exports["."].require = "./dist/cjs/index.js"`.
4. `apps/api` rebuild → `node dist/main.js` стартует, NestFactory поднимается.
5. Ошибка перепрыгнула на следующий пакет (`@orchestra/context-service`) — это ожидаемо,
   доказывает что паттерн работает, нужно применить ко всем 8 пакетам.

**Решение проверено экспериментально.** Паттерн канонический (Node docs: dual-package
via nested package.json, https://nodejs.org/api/packages.html#dual-package-hazard-avoided-via-packagejson).

### 0.5. Что НЕ в scope

- **Миграция apps/api на ESM** — отвергается (§0.2), отдельная фаза если понадобится.
- **Decorator-metadata refactor** (`@Inject(TOKEN)` для интерфейсов) — не нужен при CJS-api.
- **tsup / esbuild bundle** — не нужен, обычный `tsc` справляется.
- **Phase 8b UI / Event Bus / Prisma** — Wave 8b+, после закрытия Phase 8.
- **apps/web** — Next.js, отдельный сборщик, не трогать.

### 0.6. Что фаза НЕ меняет

- Исходники пакетов `packages/*/src/**/*.ts` — **нулевые изменения**. Кодер трогает только
  build-config и package.json. Это делает dual-build безопасным: семантика ESM-сборки не
  меняется, добавляется только параллельный CJS-output.
- Семантика ESM-exports (`import` condition) — сохраняется.
- API кода `apps/api` — ноль изменений. Контроллер/DTO/модули Phase 8 не трогать.

---

## 1. Архитектурное решение (главное)

**Каждый из 8 пакетов `@orchestra/*` становится dual-package:**

```
packages/<pkg>/
├── package.json              # ИЗМЕНИТЬ: exports.require += ./dist/cjs/index.js
├── tsconfig.json             # НЕ ТРОГАТЬ (ESM-build, как сейчас)
├── tsconfig.cjs.json         # НОВЫЙ: extends tsconfig.json, module:CommonJS, outDir:dist/cjs
└── dist/                     # build-output (gitignored)
    ├── index.js              # ESM (как сейчас)
    ├── index.d.ts            # ESM types
    └── cjs/                  # НОВЫЙ: CJS-output
        ├── package.json      # НОВЫЙ: {"type":"commonjs"} — override
        ├── index.js          # CJS
        └── *.js              # CJS
```

**Build pipeline (каждый пакет):**
```json
"scripts": {
  "build": "tsc && tsc -p tsconfig.cjs.json && node -e \"require('fs').writeFileSync('dist/cjs/package.json','{\\\"type\\\":\\\"commonjs\\\"}\\n')\""
}
```

Или (чище) через отдельный npm-script:
```json
"build": "tsc && pnpm build:cjs",
"build:cjs": "tsc -p tsconfig.cjs.json && node scripts/write-cjs-package-json.js"
```

> Кодер: `dist/cjs/package.json` **обязательно** создаётся после каждого CJS-build, иначе
> Node будет трактовать `dist/cjs/*.js` как ESM (из-за `type:module` в корне пакета) и снова
> упадёт с ERR_REQUIRE_ESM. Это критический шаг — prototype-verify его подтвердил.

**Exports map (каждый пакет):**
```json
"exports": {
  "./package.json": "./package.json",
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "require": "./dist/cjs/index.js"
  }
}
```

Условия `import`/`require` Node-стандартные. CJS-consumer (`apps/api`) получит `require`
condition, ESM-consumer — `import`. `default` поле из Phase 8 (commit 78b1f85) — можно
**оставить** (backward-compat, не мешает) или **убрать** (на усмотрение кодера; не критично).
Рекомендация: оставить для каноничности Node exports map.

---

## 2. Список файлов (точно)

### 2.1. Изменяемые файлы (8 пакетов × 2 файла = 16 изменений)

| Файл | Изменение |
|---|---|
| `packages/domain/package.json` | `exports["."].require` += `./dist/cjs/index.js`; `scripts.build` += CJS-step |
| `packages/domain/tsconfig.cjs.json` | **НОВЫЙ** |
| `packages/consensus-engine/package.json` | то же |
| `packages/consensus-engine/tsconfig.cjs.json` | **НОВЫЙ** |
| `packages/context-service/package.json` | то же |
| `packages/context-service/tsconfig.cjs.json` | **НОВЫЙ** |
| `packages/gsd-engine/package.json` | то же |
| `packages/gsd-engine/tsconfig.cjs.json` | **НОВЫЙ** |
| `packages/knowledge-graph/package.json` | то же |
| `packages/knowledge-graph/tsconfig.cjs.json` | **НОВЫЙ** |
| `packages/prompt-registry/package.json` | то же |
| `packages/prompt-registry/tsconfig.cjs.json` | **НОВЫЙ** |
| `packages/providers/package.json` | то же |
| `packages/providers/tsconfig.cjs.json` | **НОВЫЙ** |
| `packages/role-router/package.json` | то же |
| `packages/role-router/tsconfig.cjs.json` | **НОВЫЙ** |

### 2.2. Вспомогательный скрипт (опционально, рекомендовано)

| Файл | Назначение |
|---|---|
| `packages/_shared/write-cjs-package-json.cjs` | общий helper: пишет `dist/cjs/package.json` (`{"type":"commonjs"}`). CJS-расширение обязательно (запускается до создания локального override). Один на все пакеты, вызывается из каждого `build:cjs`. |

> Альтернатива: встроить запись `dist/cjs/package.json` прямо в build-скрипт через `node -e`.
> Tech lead рекомендует отдельный `.cjs` helper для читаемости и DRY. Но inline-вариант допустим.

### 2.3. Файлы, которые НЕ трогать (anti-conflict)

| Зона | Почему | Проверка |
|---|---|---|
| `packages/*/src/**/*.ts` | Исходники пакетов заморожены Phase 2-7 | `git diff 'packages/*/src/'` → пусто |
| `apps/api/src/**` | Phase 8 код (контроллер/DTO/модули) | `git diff apps/api/src/` → пусто |
| `apps/api/test/**` | Phase 8 e2e-тест | `git diff apps/api/test/` → пусто |
| `apps/api/package.json`, `tsconfig.json`, `nest-cli.json` | apps/api остаётся CJS | `git diff apps/api/` (всё вне src/test) → пусто |
| `apps/api/prisma/schema.prisma` | Prisma schema Phase 2 | `git diff apps/api/prisma/` → пусто |
| `apps/web/**` | Frontend Phase 8b | `git diff apps/web/` → пусто |
| `docs/**` | Канон | `git diff docs/` → пусто |
| `role-manifests/`, `prompts/` | Seed-данные | `git diff` → пусто |
| `.planning/phases/0[1-7]/` | Замороженные фазы | `git diff` → пусто |
| `tsconfig.base.json`, `pnpm-workspace.yaml` | Корневой конфиг | `git diff` → пусто |
| `packages/gsd-engine/test/**`, `packages/consensus-engine/test/**` | Phase 6/5 spec'и | `git diff 'packages/*/test/'` → пусто |

**Единственные изменения:**
- `packages/*/package.json` — exports + build-script (8 файлов)
- `packages/*/tsconfig.cjs.json` — НОВЫЕ (8 файлов)
- `packages/_shared/write-cjs-package-json.cjs` — НОВЫЙ helper (опц., 1 файл)

---

## 3. Шаблон `tsconfig.cjs.json` (для каждого пакета)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./dist/cjs",
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false
  }
}
```

> `extends: "./tsconfig.json"` наследует `rootDir`, `target`, `strict`, `include`, `lib`.
> CJS-сборка не нужна с declaration (types берутся из ESM-build `dist/*.d.ts`), не нужны
> sourcemaps/declarationMaps — экономит build-time и место.

**Подводный камень (кодер, внимание):** `moduleResolution:"Node"` обязательно для CJS,
**не** NodeNext (NodeNext в CJS-режиме ломается). Prototype-verify техлида использовал
именно эту комбинацию — работает.

---

## 4. Шаблон изменений в `packages/*/package.json`

### 4.1. До (например, domain)

```json
{
  "name": "@orchestra/domain",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
}
```

### 4.2. После

```json
{
  "name": "@orchestra/domain",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.js",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc && tsc -p tsconfig.cjs.json && pnpm build:write-cjs-pkg",
    "build:write-cjs-pkg": "node -e \"require('fs').mkdirSync('dist/cjs',{recursive:true});require('fs').writeFileSync('dist/cjs/package.json','{\\\"type\\\":\\\"commonjs\\\"}\\n')\"",
    "typecheck": "tsc --noEmit"
  }
}
```

> **Inline-вариант `build:write-cjs-pkg`** показан здесь для самодостаточности каждого пакета.
> Если кодер выбирает общий helper `packages/_shared/write-cjs-package-json.cjs` (§2.2),
> скрипт будет: `"build:write-cjs-pkg": "node ../../packages/_shared/write-cjs-package-json.cjs"`.
> Оба варианта допустимы. Техлид рекомендует helper (DRY), но не требует.

> **`default` field:** оставлен из Phase 8 (78b1f85) — backward-compat, не мешает. Кодер
> может убрать, если хочет чистый exports map — на усмотрение.

> **Для пакетов с `test` script** (`@orchestra/gsd-engine`, `@orchestra/consensus-engine`):
> `test` script НЕ ТРОГАТЬ. Только `build` расширяется CJS-step'ом.

### 4.3. Особый случай: `@orchestra/providers`

`packages/providers/src/token-counter.ts:13` содержит `await import('js-tiktoken')` —
динамический импорт внутри функции. **Это не блокер**: dynamic-import работает и в CJS,
и в ESM (Node трансилирует). CJS-build соберёт `require('js-tiktoken')`-эквивалент через
`await Promise.resolve().then(() => require('js-tiktoken'))` — но т.к. `js-tiktoken` сам
CJS или ESM dual — нужно проверить, что CJS-build providers-пакета не падает. Если падает
— отметить в SUMMARY и зафиксировать как долг (отдельная задача). Prototype-verify техлида
CJS-build на providers НЕ делал (делал только domain + prompt-registry).

**Кодер:** обязательно прогнать `tsc -p packages/providers/tsconfig.cjs.json` отдельно и
проверить отсутствие ошибок. Если `await import` ломает CJS-build — сообщить в SUMMARY.

---

## 5. CJS-package.json helper (если выбран helper-вариант)

`packages/_shared/write-cjs-package-json.cjs`:

```javascript
// Пишет dist/cjs/package.json со {"type":"commonjs"} — local override Node package-type.
// Без него Node трактует dist/cjs/*.js как ESM (из-за type:module в корне пакета).
// Запуск: node ../../packages/_shared/write-cjs-package-json.cjs  (из корня пакета)
const fs = require('fs');
const path = require('path');
const cjsDir = path.resolve(process.cwd(), 'dist', 'cjs');
fs.mkdirSync(cjsDir, { recursive: true });
fs.writeFileSync(path.join(cjsDir, 'package.json'), '{"type":"commonjs"}\n');
console.log(`✓ wrote ${path.relative(process.cwd(), path.join(cjsDir, 'package.json'))}`);
```

> Если кодер выбирает inline-вариант (§4.2, `build:write-cjs-pkg` через `node -e`), этот
> файл НЕ создаётся — `packages/_shared/` не нужен. Оба варианта валидны.

---

## 6. must_haves.truths (D-критерии для code review)

### Build infrastructure

- **D-01** Все 8 пакетов имеют новый `tsconfig.cjs.json` (extends `./tsconfig.json`,
  `module:"CommonJS"`, `moduleResolution:"Node"`, `outDir:"./dist/cjs"`, `declaration:false`).
  `ls packages/*/tsconfig.cjs.json` → 8 файлов.
- **D-02** Все 8 `packages/*/package.json` имеют `"require": "./dist/cjs/index.js"` в
  `exports["."]` (между `import` и `default`, либо после `import`).
- **D-03** Все 8 `packages/*/package.json` имеют `build`-script, который компилирует И ESM
  (существующий `tsc`), И CJS (`tsc -p tsconfig.cjs.json`), И пишет `dist/cjs/package.json`.
- **D-04** После `pnpm -r build`: каждый пакет имеет `dist/index.js` (ESM), `dist/index.d.ts`,
  **И** `dist/cjs/index.js` (CJS), **И** `dist/cjs/package.json` с содержимым `{"type":"commonjs"}`.
- **D-05** `pnpm -r typecheck` → 10 пакетов green (исходники не тронуты, typecheck не должен измениться).

### Runtime fix (главное)

- **D-06** `node apps/api/dist/main.js` стартует без ERR_REQUIRE_ESM. В логе видно
  `[NestFactory] Starting Nest application...` и `Orchestra API listening on :3001`.
- **D-07** Live curl POST `localhost:3001/sessions -d '{"name":"x","projectId":"p"}'` → 201,
  возвращает JSON с `currentPhase:"Discover"`, непустым `id`, `rounds:[]`.
- **D-08** Live curl полный цикл из success-criteria Phase 8 §9 п.5:
  ```
  POST /sessions         → 201 + Session JSON
  GET  /sessions/:id     → 200 + тот же Session
  POST /sessions/:id/rounds → 201 + Round JSON
  POST /sessions/:id/advance → 200 + AdvancePhaseResult JSON (status ∈ union)
  ```
  Все 4 запроса успешны, корректные HTTP-коды.
- **D-09** ValidationPipe работает в рантайме (раньше не проверялось): POST `/sessions`
  с пустым `name` → 400; POST `/sessions` с unknown field → 400 (forbidNonWhitelisted).

### Phase 8 D-критерии, становящиеся верифицируемыми

- **D-10** D-12 Phase 8 (400 на невалидный body) — теперь верифицирован (см. D-09).
- **D-11** D-15 Phase 8 (CORS): GET/POST с `Origin: http://localhost:3000` возвращает
  `Access-Control-Allow-Origin` header в live-запросе.
- **D-12** D-07 Phase 8 (HTTP-коды 201/200/404): верифицируются live curl (D-07, D-08, D-13).

### Regression (anti-breakage)

- **D-13** `GET /sessions/nope` → 404 (unknown session, D-09 Phase 8).
- **D-14** `POST /sessions/:id/advance` → 200 для всех вариантов AdvancePhaseResult
  (transitioned/gated/awaiting_approval/terminal/iteration). Проверить хотя бы один
  live-цикл, где status ≠ transitioned (например, override без round → engine вернёт
  что-то из union, не 4xx).
- **D-15** Phase 6 regression: `pnpm --filter @orchestra/gsd-engine test` → green
  (гsed-engine.spec.ts, существующий сьют Phase 6).
- **D-16** Phase 5 regression: `pnpm --filter @orchestra/consensus-engine test` → green.
- **D-17** Phase 7 regression: `pnpm --filter @orchestra/api test` (round-orchestration.spec)
  → green (5/5).
- **D-18** Phase 8 regression: `pnpm --filter @orchestra/api test:e2e` (sessions.e2e-spec)
  → green (8/8).

### Build / clean

- **D-19** `pnpm -r build` → все 10 пакетов green, exit 0.
- **D-20** Clean rebuild: `rm -rf packages/*/dist apps/api/dist && pnpm -r build` → green,
  `apps/api/dist/main.js` существует, `packages/domain/dist/cjs/index.js` существует.
- **D-21** `apps/web` не тронут: `git diff apps/web/` → пусто.

### Anti-conflict

- **D-22** `packages/*/src/**/*.ts` — ноль изменений: `git diff 'packages/*/src/'` → пусто.
- **D-23** `apps/api/src/**`, `apps/api/test/**` — ноль изменений: `git diff apps/api/src/ apps/api/test/` → пусто.
- **D-24** `apps/api/package.json`, `tsconfig.json`, `nest-cli.json`, `prisma/` — ноль изменений.
- **D-25** `docs/`, `role-manifests/`, `prompts/` — ноль изменений.
- **D-26** `tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json` (root) — ноль изменений.
- **D-27** `packages/*/test/**` — ноль изменений.

### Discipline

- **D-28** Если CJS-build `@orchestra/providers` падает из-за `await import('js-tiktoken')` —
  это явно отмечено в SUMMARY (долг, отдельная задача). НЕ тихо сломано.

---

## 7. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-28 PASS.
2. `pnpm -r typecheck` + `pnpm -r build` → 10 пакетов green.
3. **`node apps/api/dist/main.js` стартует и serve'ит API** — главный критерий.
4. Live curl success-criteria Phase 8 §9 п.5 (полный GSD-цикл через HTTP) — пройден.
5. ValidationPipe работает (400 на невалидный body) — D-09.
6. Phase 5/6/7/8 regression — все зелёные.
7. Anti-conflict: `git diff` по `packages/*/src/`, `apps/api/src/`, `apps/api/test/` → пусто.

**Фаза НЕ выполнена, если:**
- `node dist/main.js` всё ещё падает (D-06 FAIL) — корень не починен.
- Любой regression-сьют красный (D-15..D-18 FAIL).
- Исходники пакетов изменены (D-22 FAIL) — нарушен anti-conflict, фаза не cleanup а перепись.
- ValidationPipe не работает (D-09 FAIL) — Phase 8 D-12 остался непокрытым.

---

## 8. Порядок работы кодера

1. **Прочитать** этот PLAN полностью. Особенно §0.3 (решение), §0.4 (prototype-verify),
   §3-§5 (шаблоны), §6 (D-критерии).
2. **Создать `tsconfig.cjs.json`** в каждом из 8 пакетов (§3). Шаблон одинаковый.
3. **Изменить `package.json`** в каждом из 8 пакетов (§4.2): `exports.require` + `build`-script.
   - Решить: inline-вариант `build:write-cjs-pkg` через `node -e` (§4.2) ИЛИ общий helper
     `packages/_shared/write-cjs-package-json.cjs` (§5). Техлид рекомендует helper (DRY).
4. **Особо проверить `@orchestra/providers`** (§4.3): CJS-build не падает на `await import`.
   Если падает — отметить в SUMMARY (D-28).
5. **Полный rebuild:** `rm -rf packages/*/dist && pnpm -r build`. Проверить структуру `dist/`
   каждого пакета: `index.js` + `cjs/index.js` + `cjs/package.json` (D-04).
6. **Rebuild api:** `rm -rf apps/api/dist && pnpm --filter @orchestra/api build`.
7. **Runtime test (главное, D-06..D-09):**
   ```bash
   cd apps/api
   PORT=3001 node ./dist/main.js &
   # ждать "Orchestra API listening on :3001"
   # smoke (D-07):
   curl -X POST localhost:3001/sessions -d '{"name":"smoke","projectId":"p"}' -H 'Content-Type: application/json'
   # full cycle (D-08):
   SID=<id из ответа>
   curl localhost:3001/sessions/$SID
   curl -X POST localhost:3001/sessions/$SID/rounds
   curl -X POST localhost:3001/sessions/$SID/advance
   # validation (D-09):
   curl -X POST localhost:3001/sessions -d '{"name":"","projectId":"p"}' -H 'Content-Type: application/json'  # → 400
   curl -X POST localhost:3001/sessions -d '{"name":"x","projectId":"p","evil":true}' -H 'Content-Type: application/json'  # → 400
   # 404 (D-13):
   curl localhost:3001/sessions/nope  # → 404
   # CORS (D-11):
   curl -X POST localhost:3001/sessions -d '{"name":"c","projectId":"p"}' -H 'Origin: http://localhost:3000' -D - -o /dev/null | grep -i access-control
   ```
   Все запросы должны вернуть ожидаемые HTTP-коды.
8. **Regression (D-15..D-18):**
   ```bash
   pnpm --filter @orchestra/gsd-engine test
   pnpm --filter @orchestra/consensus-engine test
   pnpm --filter @orchestra/api test
   pnpm --filter @orchestra/api test:e2e
   ```
   Все green.
9. **Anti-conflict check (D-22..D-27):**
   ```bash
   git diff 'packages/*/src/' | wc -l     # → 0
   git diff apps/api/src/ apps/api/test/ | wc -l  # → 0
   git diff apps/api/package.json apps/api/tsconfig.json apps/api/nest-cli.json apps/api/prisma/ | wc -l  # → 0
   git diff apps/web/ docs/ role-manifests/ prompts/ | wc -l  # → 0
   git diff tsconfig.base.json pnpm-workspace.yaml package.json | wc -l  # → 0
   ```
10. **Написать `8-02-SUMMARY.md`**: что сделано, какие D PASS/FAIL, особые наблюдения
    (providers CJS-build, CORS-verification, advance-union status из live-теста).

**Оценка:** ~2-3 часа (механическая работа по 8 пакетам + runtime-верификация).

---

## 9. Design notes (почему так)

1. **Dual-package, не ESM-миграция api.** Миграция api на ESM вскрывает каскад
   decorator-metadata багов (§0.2) — каждый interface-injection потребует `@Inject(TOKEN)`.
   Это не cleanup, а большая волна рефакторинга с риском регрессий Phase 6/7. Dual-package
   изолирует проблему на build-уровне, не трогая исходники.

2. **CJS в `dist/cjs/`, не в `dist/` (перезапись ESM).** Node exports-map требует
   разделённых артефактов для `import` vs `require`. `dist/cjs/` — изоляция, ESM-build
   в `dist/` не трогается (семантика сохранена).

3. **Локальный `dist/cjs/package.json` со `"type":"commonjs"` — критичен.** Без него Node
   трактует `dist/cjs/*.js` как ESM (из-за `type:module` в корне пакета) → ERR_REQUIRE_ESM
   возвращается. Prototype-verify техлида это подтвердил эмпирически. Это не косметика,
   это функциональное требование.

4. **`declaration:false` в CJS-build.** Types берутся из ESM-build (`dist/*.d.ts`) —
   `exports.types` указывает туда. Дублировать declaration в CJS — трата места и build-time,
   без выгоды.

5. **Inline helper vs общий `.cjs`-файл.** Inline (`node -e "..."` в build-скрипте) —
   самодостаточен, но менее читаем. Общий `packages/_shared/write-cjs-package-json.cjs` —
   DRY, но вводит новую директорию. Техлид рекомендует общий, но оставляет выбор кодеру.
   Оба варианта покрываются D-критериями.

6. **Почему `default` field (из Phase 8) остаётся.** `default` — это fallback для
   не-Node resolver'ов (bundler'ы без понимания conditions). Не мешает `import`/`require`.
   Убрать можно, но не нужно — backward-compat. Рекомендация: оставить.

7. **providers/token-counter `await import` (§4.3).** Dynamic-import — единственное место,
   которое может сломать CJS-build (если `js-tiktoken` не CJS-совместим). CJS-build
   трансформирует `await import('x')` в `await Promise.resolve().then(() => require('x'))`
   (TypeScript / ts-node handling). Если `js-tiktoken` чисто-ESM — может потребоваться
   `await import` оставить как dynamic (TypeScript умеет). Кодер проверяет, если падает —
   долг, отдельная задача. НЕ блокер Phase 8.02, т.к. providers не импортируется из
   `dist/main.js` прямо в bootstrap-пути (используется в round-orchestration, не в startup).

8. **Почему это cleanup, а не Phase 9.** Это **remediation** существующей фазы (8) —
   не новая функциональность. Закрывает 3 долга Phase 8 (DEBT-8-01/02/03). По GSD-дисциплине
   cleanup-фаза нумеруется как `<phase>-02` (внутри той же slug-директории), не отдельная
   фаза. После PASS — Phase 8 закрывается полностью.

9. **Phase 8 PASS после 8-02.** После этой cleanup-фазы все FAIL-D Phase 8 (D-07, D-08,
   D-12, D-15, D-18) становятся верифицированными через live-run. Tech lead пишет
   README-CONTRACT-PHASE-8.md, объединяющий вердикты 8-01 (PARTIAL) + 8-02 (PASS) →
   итоговый Phase 8 = PASS.

---

## 10. Долги, которые фаза ЗАКРЫВАЕТ

- **DEBT-8-01** (P0, BLOCKER Phase 8 exit): `main.js` ERR_REQUIRE_ESM → **ЗАКРЫТО** (D-06).
- **DEBT-8-02** (P1, BLOCKER Phase 8 exit): D-12 Phase 8 (400 на невалидный body) не покрыт
  тестом → **ЗАКРЫТО** (D-09, D-10). ValidationPipe теперь live-верифицируется.
- **DEBT-8-03** (P2): D-18 Phase 8 (e2e через TestingModule+supertest) → **ЧАСТИЧНО ЗАКРЫТО**.
  После 8-02 TestingModule теоретически становится возможным (рантайм починен). Но
  переписывание e2e-тестов на supertest — отдельная задача. Техлид отмечает как
  non-blocking known-limitation Phase 8 (юнит-тесты 8/8 покрывают логику контроллера,
  live curl покрывает HTTP-семантику — двойное покрытие достаточно для MVP exit).

## 11. Долги, которые фаза ОТКРЫВАЕТ

- **Нет новых долгов** (по design). Это cleanup-фаза, не вводит новых известных проблем.
- Если `@orchestra/providers` CJS-build падает (D-28) → открывается DEBT-8-02-PROV
  (отдельная задача, non-blocking — providers не в startup-path).

### Перенесённые долги (без изменений)

- **D-H1** Auth эндпоинтов — Wave 8+ (из Phase 8 PLAN).
- **D-H2** WebSocket/SSE — Wave 8b (из Phase 8 PLAN).
- **D-H3** Pagination — при росте данных (из Phase 8 PLAN).
- **D-F1** Prisma persistence — Phase 8d.
- **D-F2** Event Bus — Phase 8c.
- Остальные Wave 8+ долги — без изменений.

---

## 12. Что получает Orchestra после Phase 8.02

**Рабочий рантайм.** `apps/api` запускается, serve'ит REST API, валидирует ввод, проходит
полный GSD-цикл через HTTP. Это разблокирует:

1. **Phase 8 → формальный PASS.** Tech lead пишет README-CONTRACT-PHASE-8.md, Phase 8
   закрывается полностью (8-01 PARTIAL + 8-02 PASS = Phase 8 PASS).
2. **Phase 8b (UI Conducting Score) готова к старту.** Next.js UI может вызвать
   `localhost:3001/sessions` и получить живой ответ. Без этого UI был бесполезен.
3. **Event Bus / Prisma (Phase 8c/8d) — получают рабочий рантайм-фундамент.**
4. **Live-тестирование всей Orchestra** — первый раз с Phase 3 система действительно
   запускается end-to-end.

**Phase 8 + 8.02 вместе = Orchestra MVP backend готов к UI-слою.**

---

## 13. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| `dist/cjs/package.json` забыт в каком-то пакете → ERR_REQUIRE_ESM возвращается | средняя | D-04 проверяет наличие файла в каждом пакете; `pnpm -r build` создаёт его автоматически |
| `@orchestra/providers` CJS-build падает на `await import` | низкая-средняя | D-28: кодер отдельно проверяет, при падении — долг (non-blocking) |
| pnpm-lock не обновляется после изменения package.json scripts | низкая | `pnpm install` после изменений; D-19 включает полный rebuild |
| NestJS 10 + CJS-api + dual-package имеет скрытый edge-case | низкая | Prototype-verify техлида подтвердил: ошибка перепрыгивает пакет-за-пакетом, паттерн работает |
| CJS-build дублирует declaration, раздувая `dist/` | низкая | D-01 требует `declaration:false` в `tsconfig.cjs.json` |

---

**Конец PLAN 8-02.** Ждёт `/gsd-execute-phase 8.02` (mimo) → `/gsd-validate-phase 8.02`.
