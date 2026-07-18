---
phase: 01-monorepo-skeleton
plan: "01"
slice: 01-01
type: execute
wave: 1
depends_on: []
requirements:
  - ORCH-01-01
  - ORCH-01-02
  - ORCH-01-03
autonomous: true
files_modified: []
files_created:
  - package.json
  - pnpm-workspace.yaml
  - tsconfig.base.json
  - tsconfig.json
  - .gitignore
  - .editorconfig
  - .npmrc
  - apps/web/package.json
  - apps/web/tsconfig.json
  - apps/web/next.config.ts
  - apps/web/src/app/layout.tsx
  - apps/web/src/app/page.tsx
  - apps/api/package.json
  - apps/api/tsconfig.json
  - apps/api/nest-cli.json
  - apps/api/src/main.ts
  - apps/api/src/app.module.ts
  - packages/domain/package.json
  - packages/domain/tsconfig.json
  - packages/domain/src/index.ts
  - packages/domain/src/gsd.ts
  - packages/domain/src/context.ts
  - packages/domain/src/agent.ts
  - packages/domain/src/consensus.ts
  - packages/domain/src/decision.ts
must_haves:
  truths:
    - "D-01: Команда `pnpm install` из корня выполняется без ошибок и создаёт единый node_modules через pnpm workspaces"
    - "D-02: Команда `pnpm -r typecheck` завершается с exit code 0 во ВСЕХ пакетах (apps/web, apps/api, packages/domain)"
    - "D-03: Все TypeScript-типы из Protocol-документов реализованы в packages/domain/src: GSDPhase (gsd.ts), ContextPacket + MemoryLayers (context.ts), RoleManifest + AIProvider + Plugin (agent.ts), DecisionConfidence + ConsensusReport (consensus.ts), Decision + RoleRef + общие reference-типы (decision.ts)"
    - "D-04: packages/domain экспортирует всё через src/index.ts barrel; импорт из других пакетов работает как `@orchestra/domain`"
    - "D-05: apps/api — NestJS-приложение, `pnpm --filter @orchestra/api build` компилируется, main.ts слушает порт из env PORT (default 3001)"
    - "D-06: apps/web — Next.js 15 приложение, стартовая страница рендерит заглушку 'Orchestra' без ошибок"
    - "D-07: Существуют .gitignore (node_modules, .next, dist, .env, *.local), .editorconfig, .npmrc (shamefully-hoist=false, strict-peer-dependencies=false), tsconfig.base.json с путевыми маппингами @orchestra/*"
    - "D-08: `git init` выполнен, все файлы Phase 1 закоммичены, working tree чистый после фазы"
  artifacts:
    - path: pnpm-workspace.yaml
      provides: определение воркспейсов apps/* и packages/*
    - path: packages/domain/src/
      provides: доменная TypeScript-модель Orchestra (контракты из docs/* Protocol)
    - path: apps/api/src/main.ts
      provides: пустой NestJS-контейнер API Gateway
    - path: apps/web/src/app/page.tsx
      provides: пустой Next.js контейнер (будущий Conducting Score UI)
  key_links:
    - from: packages/domain/src/index.ts
      to: apps/api, apps/web
      via: workspace dependency @orchestra/domain
      pattern: monorepo workspace import
    - from: tsconfig.base.json paths
      to: packages/domain
      via: "@orchestra/domain": ["packages/domain/src"]
      pattern: TS path mapping для typecheck-time resolution
---

# Plan 01-01 — Монорепо-каркас Orchestra + base domain types (Wave 1)

**Phase:** 01 — monorepo-skeleton
**Wave:** B-1
**Author (Tech Lead):** @zcode-assistant
**Coder:** mimo (через `/gsd-execute-phase 1`)

## Контекст (почему эта фаза)

Orchestra сейчас — только документация (`docs/` + README/LICENSE/CONTRIBUTING). Кода нет, git не инициализирован (`git rev-parse` → fatal). Это **первая** фаза разработки: нужно создать фундамент, на котором будут строиться все последующие фазы (Context Service, GSD Engine, Role Router, Consensus Engine, Conducting Score UI).

Источники истины — документы в `docs/`:
- `docs/Architecture.md` §10 (техстек): Next.js 15, React 19, NestJS, TypeScript, PostgreSQL+Prisma, Redis+BullMQ.
- `docs/Context Protocol.md` §2 (ContextPacket контракт), §3 (Memory Layers).
- `docs/Agent Protocol.md` §3 (RoleManifest), §7 (AIProvider), §8 (Plugin SDK).
- `docs/Consensus Protocol.md` §1 (ConsensusReport), §5 (DecisionConfidence).
- `docs/GSD Integration.md` §1 (GSDPhase enum: Discover→Goal→Specification→Architecture→Implementation→Review→Consensus→Iteration).

Эта фаза **НЕ** реализует runtime-логику — только каркас и типы. Цель: доказать, что архитектурные контракты из docs/* переводимы в код, и подготовить безопасную базу для wave 2 (где начнётся реальная функциональность).

## Что делает кодер (пофайлово)

### 1. Корневые конфиги монорепо (новые)

**Сейчас:** файлов нет, git не инициализирован.
**Задача:** создать pnpm-workspace монорепо.
**Точные точки правки:**
- `package.json` (root) — `name: "orchestra"`, `private: true`, `packageManager: "pnpm@10.9.4"`, scripts: `typecheck: "pnpm -r typecheck"`, `build: "pnpm -r build"`, `dev: "pnpm -r --parallel dev"`, `lint: "pnpm -r lint"`. Версия Node engines: `">=20.0.0"`.
- `pnpm-workspace.yaml` — `packages:` с `apps/*` и `packages/*`.
- `tsconfig.base.json` — `compilerOptions`: `target: "ES2022"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `strict: true`, `esModuleInterop: true`, `skipLibCheck: true`, `declaration: true`, `declarationMap: true`, `sourceMap: true`, `resolveJsonModule: true`. `paths`: `"@orchestra/domain": ["packages/domain/src"]`, `"@orchestra/domain/*": ["packages/domain/src/*"]`.
- `tsconfig.json` (root) — `extends: ./tsconfig.base.json`, пустой `references`-блок.
- `.gitignore` — `node_modules/`, `dist/`, `.next/`, `coverage/`, `.env`, `.env.local`, `*.local`, `.turbo/`, `pnpm-debug.log*`, `.DS_Store`.
- `.editorconfig` — стандартный (UTF-8, LF, 2-space indent для ts/json/md, final newline).
- `.npmrc` — `shamefully-hoist=false`, `strict-peer-dependencies=false`, `auto-install-peers=true`.

### 2. `packages/domain/` — доменные типы (новый, ключевой пакет)

**Назначение:** единственный источник истины для TypeScript-контрактов Orchestra. Все типы переводятся дословно из `docs/* Protocol`. **Никакой runtime-логики — только `type`/`interface`/`enum`/const-объекты.** Это позволяет верифицировать, что документация ↔ код синхронны.

**Точные точки правки:**

- `packages/domain/package.json` — `name: "@orchestra/domain"`, `version: "0.0.0"`, `type: "module"`, `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`, `exports` со списком `"./package.json"` и `"."`. `scripts`: `build: "tsc"`, `typecheck: "tsc --noEmit"`. `devDependencies`: `typescript ~5.6`.

- `packages/domain/tsconfig.json` — `extends: ../../tsconfig.base.json`, `compilerOptions.outDir: "./dist"`, `rootDir: "./src"`, `include: ["src"]`.

- `packages/domain/src/gsd.ts`:
  ```typescript
  /** Фазы жизненного цикла GSD. См. docs/GSD Integration.md §1. */
  export type GSDPhase =
    | 'Discover' | 'Goal' | 'Specification' | 'Architecture'
    | 'Implementation' | 'Review' | 'Consensus' | 'Iteration';
  ```

- `packages/domain/src/decision.ts` — общие reference-типы + Decision:
  ```typescript
  export type ISO8601 = string;
  export interface RoleRef { id: string; displayName: string; responsibilities: readonly string[]; }
  export interface DecisionRef { id: string; version: string; }
  export interface QuestionRef { id: string; }
  export interface RiskRef { id: string; }
  export interface ArtifactRef { id: string; type: string; version: string; }

  /** См. docs/Orchestra_TC.md §5 (сущность Decision). */
  export type DecisionStatus = 'proposed' | 'accepted' | 'rejected';
  export interface Decision {
    id: string;
    roundId: string;
    title: string;
    description: string;
    status: DecisionStatus;
    acceptedBy: RoleRef[];
    rejectedBy: RoleRef[];
  }
  ```

- `packages/domain/src/context.ts` — ContextPacket + MemoryLayers (дословно из docs/Context Protocol.md §2 и §3):
  - `OutputType` union (`'ADR' | 'Architecture' | 'Review' | 'Code' | 'Specification' | 'Research' | 'Decision' | 'Consensus' | 'Task'`).
  - `OutputSpec` interface (тип ожидаемого артефакта).
  - `Summary` type (агрегированная сводка).
  - `Constraint` interface.
  - `MemoryLayer` enum/const (`System=1, Project=2, Working=3, Conversation=4, Scratch=5`).
  - `ContextPacket` interface (дословно по полям из Context Protocol.md §2: sessionId, projectId, roundId, phase, role, objective, relevantDecisions, openQuestions, knownRisks, constraints, artifacts, conversationSummary, systemPrompt, expectedOutput, outputFormat, builtAt, modelTarget, contextPolicyId, contentHash).
  - `ContextPacketRecord` (для воспроизводимости, §7): packet + kgSnapshotRef + promptVersion + `replayable: true`.

- `packages/domain/src/agent.ts` — роли, манифесты, провайдеры, плагины (из docs/Agent Protocol.md §3, §7, §8):
  - `OutputType` re-export если дублирует — лучше держать в decision.ts, здесь импортировать.
  - `RoleManifest` interface (id, displayName, provider, model, responsibilities, allowedOutputs, contextPolicy {profile, max_tokens}, generation {temperature, systemPromptRef}, activePhases?).
  - `ProviderHealth` interface (status: 'up'|'degraded'|'down', latencyMs, rateLimitRemaining?).
  - `Response`, `Token` base types.
  - `AIProvider` interface (send, stream: AsyncIterable<Token>, cancel, estimateTokens, estimateCost, health) — дословно из §7.
  - `PluginType` union (`'AI Provider'|'Context Provider'|'Consensus Strategy'|'Knowledge Extractor'|'Exporter'|'Reviewer'|'Notification Provider'|'GSD Phase Extension'`).
  - `Plugin` interface (id, name, version, type, initialize, dispose).
  - `AIProviderPlugin` interface (extends Plugin, type:'AI Provider', provider: AIProvider).

- `packages/domain/src/consensus.ts` — ConsensusReport + DecisionConfidence (из docs/Consensus Protocol.md §1 и §5):
  - `Question`, `Risk`, `Conflict` interfaces.
  - `GSDAction` type (предлагаемый следующий шаг; MVP: строка-описание).
  - `GatingVerdict = 'pass' | 'fail'`.
  - `DecisionConfidence` interface (architecture, implementation, researchCoverage, riskCoverage, testCoverage, overall — все `number` 0..100).
  - `ConsensusReport` interface (id, roundId, summary, agreedDecisions: Decision[], disagreements: Conflict[], openQuestions: Question[], risks: Risk[], nextAction: GSDAction, confidence: DecisionConfidence, gatingVerdict: GatingVerdict).

- `packages/domain/src/index.ts` — barrel, реэкспортирующий всё из `./gsd`, `./decision`, `./context`, `./agent`, `./consensus`.

### 3. `apps/api/` — пустой NestJS-контейнер (новый)

**Назначение:** будущий API Gateway. Сейчас — минимальный NestJS-старт, импортирующий `@orchestra/domain` (доказательство workspace-связки).
**Точные точки правки:**
- `apps/api/package.json` — `name: "@orchestra/api"`, `private: true`, `type: "commonjs"` (NestJS по умолчанию CommonJS). `dependencies`: `@orchestra/domain: "workspace:*"`, `@nestjs/common ^10`, `@nestjs/core ^10`, `reflect-metadata ^0.2`, `rxjs ^7`. `devDependencies`: `@nestjs/cli ^10`, `typescript ~5.6`, `ts-node`, `@types/node`. `scripts`: `build: "nest build"`, `start: "nest start"`, `start:dev: "nest start --watch"`, `typecheck: "tsc --noEmit"`.
- `apps/api/tsconfig.json` — `extends: ../../tsconfig.base.json`, `compilerOptions`: `outDir: "./dist"`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `module: "CommonJS"`, `moduleResolution: "Node"`, `target: "ES2022"`. `include: ["src"]`.
- `apps/api/nest-cli.json` — `{"collection": "@nestjs/schematics", "sourceRoot": "src"}`.
- `apps/api/src/main.ts` — bootstrap NestJS, `app.listen(process.env.PORT ?? 3001)`, `logger: ['log','error','warn']`.
- `apps/api/src/app.module.ts` — пустой `@Module({})` AppModule, импортирует `@orchestra/domain` где-то (например, type-only импорт `import type { GSDPhase } from '@orchestra/domain'` и использует в комментарии/placeholder — доказательство workspace link).

### 4. `apps/web/` — пустой Next.js контейнер (новый)

**Назначение:** будущий Conducting Score UI. Сейчас — Next.js 15 App Router старт с заглушкой.
**Точные точки правки:**
- `apps/web/package.json` — `name: "@orchestra/web"`, `private: true`. `dependencies`: `@orchestra/domain: "workspace:*"`, `next ^15`, `react ^19`, `react-dom ^19`. `devDependencies`: `typescript ~5.6`, `@types/react ^19`, `@types/react-dom ^19`, `@types/node`. `scripts`: `dev: "next dev"`, `build: "next build"`, `start: "next start"`, `typecheck: "tsc --noEmit"`.
- `apps/web/tsconfig.json` — `extends: ../../tsconfig.base.json`, `compilerOptions`: `jsx: "preserve"`, `lib: ["DOM","DOM.Iterable","ES2022"]`, `plugins: [{"name":"next"}]`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `incremental: true`. `include: ["src", "next-env.d.ts", ".next/types"]`.
- `apps/web/next.config.ts` — минимальный конфиг, `transpilePackages: ['@orchestra/domain']`.
- `apps/web/src/app/layout.tsx` — root layout, `<html lang="ru">`, `<body>` с children.
- `apps/web/src/app/page.tsx` — стартовая страница, рендерит `<main><h1>Orchestra</h1><p>Conducting Score UI — в разработке</p></main>`. Type-only импорт из `@orchestra/domain` (доказательство связи).

### 5. Git + финализация

- `git init` в корне `F:\Orchestra`.
- Проверить `git status` — `.planning/` и `docs/` и все новые файлы должны быть untracked.
- **НЕ коммитить** — коммит делает Tech Lead на шаге 4 цикла (README-CONTRACT). Кодер оставляет чистый staged-tree.
- Написать `apps/api/README.md` и `apps/web/README.md` (одна строка назначение + ссылка на docs).

## Anti-conflict (важно для кодера)

**НЕ ТРОГАТЬ:**
- `docs/**` — вся документация заморожена. Кодер НЕ редактирует .md файлы.
- `README.md`, `LICENSE`, `CONTRIBUTING.md` в корне — заморожены.
- `.planning/phases/01-monorepo-skeleton/1-01-PLAN.md` — этот PLAN не редактировать (могу править только Tech Lead).
- **Не создавать** `apps/api/src/` бизнес-логику, контроллеры, сервисы — только main.ts + app.module.ts пустые.
- **Не создавать** `prisma/`, `redis/`, `Event Bus` реализацию — это будущие фазы (Wave 2+).
- **Не добавлять** runtime-логику в `packages/domain` — только типы (`type`/`interface`/`enum`). Пакет domain = чистая декларация контрактов.
- **Не подключать** реальных провайдеров LLM — `AIProvider` это интерфейс, без имплементаций.

## Готово, когда (success criteria)

- [ ] `git init` выполнен, `F:\Orchestra\.git` существует.
- [ ] `pnpm install` из корня выполняется без ошибок (exit 0), создаёт единый `node_modules` через workspace-links.
- [ ] `pnpm -r typecheck` завершается с exit 0 во ВСЕХ пакетах (apps/web, apps/api, packages/domain) — это главный D-критерий.
- [ ] `pnpm --filter @orchestra/api build` компилируется, `dist/main.js` существует.
- [ ] `pnpm --filter @orchestra/web build` компилируется (Next.js production build зелёный).
- [ ] `packages/domain/src/index.ts` реэкспортирует типы из всех 5 файлов (gsd, decision, context, agent, consensus) — проверить через `pnpm --filter @orchestra/domain build`.
- [ ] Все 5 файлов domain соответствуют контрактам из docs/* (code review по D-03).
- [ ] `git status` показывает только новые файлы Phase 1, ни одного modified в `docs/` или корневых `.md`.
- [ ] Кодер пишет `1-01-SUMMARY.md` (frontmatter по phase-formats.md) с описанием что сделано, key-decisions, duration.

## Не готово, когда

- `pnpm install` падает — нет workspace-связки, чинить до сдачи.
- `pnpm -r typecheck` красный в любом пакете — типы не соответствуют контрактам docs/*.
- Кодер добавил runtime-логику в `packages/domain` (должны быть только декларации).
- Кодер отредактировал любой файл в `docs/` или корневой `.md`.
- NestJS/Next.js контейнеры не стартуют (bootstrap-ошибки в main.ts/app.module.ts/layout).
- Git не инициализирован или working tree «грязный» в неположенных местах.

## Что даёт эта фаза для Orchestra

- **Доказательство переводимости docs → код:** все ключевые TypeScript-контракты (ContextPacket, GSDPhase, RoleManifest, AIProvider, Plugin, ConsensusReport, DecisionConfidence) материализованы из Protocol-документов. Дальнейшие фазы ссылаются на `@orchestra/domain`, а не дублируют типы.
- **Безопасный фундамент:** monorepo-структура (apps/web, apps/api, packages/domain) с единым toolchain (pnpm + TypeScript strict). Wave 2 будет добавлять `packages/{context-service,gsd-engine,role-router,consensus-engine}` поверх этой базы.
- **Anti-conflict baseline:** чистый git-репо с замороженной документацией — любой будущий кодер сразу видит, что docs/ = immutable, код = в apps/packages.

## Следующий шаг

После PASS этой фазы Wave 2 начнёт наполнять каркас:
- `packages/knowledge-graph` (Prisma schema узлов/отношений из docs/Architecture.md §6).
- `packages/context-service` (Context Packet Builder из docs/Context Protocol.md §1).
- NestJS-модули в `apps/api/src/` (Session Manager, GSD Engine stubs).

Безопасно стартовать Wave 2 только когда D-02 (typecheck) стабильно зелёный — это контракт, на который будут опираться все следующие пакеты.
