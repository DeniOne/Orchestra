---
phase: 02-knowledge-graph
plan: "01"
slice: 02-01
type: execute
wave: 2
depends_on:
  - phase-01-monorepo-skeleton
requirements:
  - ORCH-02-01
  - ORCH-02-02
  - ORCH-02-03
autonomous: true
files_modified:
  - apps/api/package.json
  - apps/api/tsconfig.json
  - apps/api/src/app.module.ts
  - packages/domain/src/index.ts
files_created:
  - packages/knowledge-graph/package.json
  - packages/knowledge-graph/tsconfig.json
  - packages/knowledge-graph/prisma/schema.prisma
  - packages/knowledge-graph/src/index.ts
  - packages/knowledge-graph/src/types.ts
  - apps/api/prisma/schema.prisma
  - apps/api/src/prisma.service.ts
  - apps/api/src/kg/kg.module.ts
  - apps/api/src/kg/kg.service.ts
must_haves:
  truths:
    - "D-01: packages/knowledge-graph содержит Prisma-схему с моделями KgNode и KgRelationship, типы узлов и отношений соответствуют docs/Architecture.md §6"
    - "D-02: Prisma Client генерируется без ошибок (`npx prisma generate` в packages/knowledge-graph)"
    - "D-03: packages/domain/src/kg.ts экспортирует доменные типы Knowledge Graph (NodeType, RelationshipType, KgNode, KgRelationship) — чистые type/interface, без Prisma-зависимостей"
    - "D-04: apps/api интегрирует Prisma через PrismaService (NestJS lifecycle), schema.prisma в apps/api ссылается на @orchestra/knowledge-graph через пакет"
    - "D-05: apps/api/src/kg/ содержит KgModule и KgService с базовыми CRUD-методами (createNode, getNode, createRelationship, getNeighbors)"
    - "D-06: `pnpm -r typecheck` зелёный во всех пакетах"
    - "D-07: `pnpm --filter @orchestra/knowledge-graph build` компилируется"
    - "D-08: `pnpm --filter @orchestra/api build` компилируется с новыми модулями"
  artifacts:
    - path: packages/knowledge-graph/prisma/schema.prisma
      provides: Prisma-модели KgNode и KgRelationship для Knowledge Graph
    - path: packages/domain/src/kg.ts
      provides: Доменные типы Knowledge Graph (без Prisma-зависимости)
    - path: apps/api/src/kg/kg.service.ts
      provides: NestJS-сервис для работы с Knowledge Graph
  key_links:
    - from: packages/domain/src/kg.ts
      to: packages/knowledge-graph/prisma/schema.prisma
      via: типы domain отражают Prisma-модели
      pattern: domain types ↔ Prisma schema sync
    - from: apps/api/src/kg/kg.service.ts
      to: packages/knowledge-graph
      via: PrismaService → @prisma/client
      pattern: NestJS service wrapping Prisma
---

# Plan 02-01 — Knowledge Graph: Prisma-схема + доменные типы + NestJS-сервис (Wave 2)

**Phase:** 02 — knowledge-graph
**Wave:** B-2
**Author (Tech Lead):** @zcode-assistant
**Coder:** mimo (через `/gsd-execute-phase 2`)

## Контекст (почему эта фаза)

Phase 1 создала монорепо-каркас и доменные типы контрактов (ContextPacket, GSDPhase, RoleManifest и др.). Но Orchestra не может функционировать без **Knowledge Graph** — внутреннего графа знаний проекта, из которого Context Service извлекает релевантные узлы для каждой роли.

Architecture.md §6 определяет типы узлов (Goals, Requirements, Architecture, ADR, Tasks, Decision, ...) и типы отношений (depends_on, replaces, implements, validates, blocks, supersedes, conflicts_with, references). Context Protocol.md §4 описывает алгоритм извлечения подграфа. Всё это требует материализации в Prisma-схему и доменные типы.

Это **первая фаза Wave 2** — она закладывает data layer, на котором будут строиться Context Service, GSD Engine и Consensus Engine.

## Что делает кодер (пофайлово)

### 1. `packages/knowledge-graph/` — новый пакет (Prisma-схема + типы)

**Назначение:** автономный пакет с Prisma-схемой для Knowledge Graph. Содержит только data layer — никакой бизнес-логики.

#### 1a. `packages/knowledge-graph/package.json` (новый)

```json
{
  "name": "@orchestra/knowledge-graph",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:push": "prisma db push"
  },
  "dependencies": {
    "@prisma/client": "^6"
  },
  "devDependencies": {
    "prisma": "^6",
    "typescript": "~5.6"
  }
}
```

#### 1b. `packages/knowledge-graph/tsconfig.json` (новый)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

#### 1c. `packages/knowledge-graph/prisma/schema.prisma` (новый)

Prisma-схема, модели KgNode и KgRelationship. Типы узлов и отношений из Architecture.md §6.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum NodeType {
  Goal
  Requirement
  Architecture
  API
  Module
  Entity
  Repository
  Service
  Risk
  Test
  ADR
  Task
  Research
  Code
  Documentation
  Decision
}

enum RelationshipType {
  depends_on
  replaces
  implements
  validates
  blocks
  supersedes
  conflicts_with
  references
}

model KgNode {
  id          String     @id @default(cuid())
  type        NodeType
  title       String
  description String?
  metadata    Json?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  // Relationships where this node is source
  outgoing    KgRelationship[] @relation("source")
  // Relationships where this node is target
  incoming    KgRelationship[] @relation("target")

  @@index([type])
  @@index([createdAt])
}

model KgRelationship {
  id          String           @id @default(cuid())
  type        RelationshipType
  sourceId    String
  targetId    String
  metadata    Json?
  createdAt   DateTime         @default(now())

  source      KgNode           @relation("source", fields: [sourceId], references: [id], onDelete: Cascade)
  target      KgNode           @relation("target", fields: [targetId], references: [id], onDelete: Cascade)

  @@index([sourceId])
  @@index([targetId])
  @@index([type])
}
```

#### 1d. `packages/knowledge-graph/src/types.ts` (новый)

Доменные типы Knowledge Graph — **без Prisma-зависимостей**. Чистые TypeScript interface/type, которые могут использоваться в любом пакете (включая frontend) без подключения Prisma Client.

```typescript
/** Типы узлов Knowledge Graph. См. docs/Architecture.md §6. */
export type KgNodeType =
  | 'Goal' | 'Requirement' | 'Architecture' | 'API' | 'Module' | 'Entity'
  | 'Repository' | 'Service' | 'Risk' | 'Test' | 'ADR' | 'Task'
  | 'Research' | 'Code' | 'Documentation' | 'Decision';

/** Типы отношений Knowledge Graph. См. docs/Architecture.md §6. */
export type KgRelationshipType =
  | 'depends_on' | 'replaces' | 'implements' | 'validates'
  | 'blocks' | 'supersedes' | 'conflicts_with' | 'references';

export interface KgNodeData {
  id: string;
  type: KgNodeType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string; // ISO8601
  updatedAt: string;
}

export interface KgRelationshipData {
  id: string;
  type: KgRelationshipType;
  sourceId: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

#### 1e. `packages/knowledge-graph/src/index.ts` (новый)

Barrel export. Реэкспортирует типы из `./types.js` и Prisma Client (для использования в apps/api).

```typescript
export * from './types.js';
export { PrismaClient, NodeType, RelationshipType } from '@prisma/client';
```

### 2. `packages/domain/src/kg.ts` (новый) — доменные типы KG

**Назначение:** доменные типы Knowledge Graph в пакете domain (единый источник истины для типов). Дублирует типы из knowledge-graph/src/types.ts, чтобы apps и packages без Prisma-зависимости могли использовать типы через `@orchestra/domain`.

```typescript
export type { KgNodeType, KgRelationshipType, KgNodeData, KgRelationshipData } from '@orchestra/knowledge-graph/types.js';
```

**Альтернатива (если не хочется зависимости domain от knowledge-graph):** определить типы прямо в domain, а knowledge-graph/src/types.ts импортировать оттуда. Кодер выбирает cleaner вариант — domain не должен зависеть от knowledge-graph (циклическая ссылка). Поэтому **типы определяются в domain, а knowledge-graph их реэкспортирует**.

**Правильный порядок:**
- `packages/domain/src/kg.ts` — определяет KgNodeType, KgRelationshipType, KgNodeData, KgRelationshipData
- `packages/domain/src/index.ts` — добавляет `export * from './kg.js'`
- `packages/knowledge-graph/src/types.ts` — `export type { KgNodeType, KgRelationshipType, KgNodeData, KgRelationshipData } from '@orchestra/domain'`
- `packages/knowledge-graph/src/index.ts` — реэкспортирует типы + PrismaClient

### 3. `apps/api/prisma/schema.prisma` (новый) — ссылка на схему пакета

**Назначение:** NestJS-приложение использует Prisma. Schema.prisma в apps/api — это копия или symlink на packages/knowledge-graph/prisma/schema.prisma.

**Реализация:** кодер использует `prisma` в apps/api напрямую, с собственным schema.prisma (копия содержимого из packages/knowledge-graph). Это стандартный паттерн для NestJS + Prisma в монорепо — каждый deployable app несёт свою schema.

### 4. `apps/api/src/prisma.service.ts` (новый) — NestJS PrismaService

**Назначение:** глобальный сервис для доступа к Prisma Client в NestJS. Использует lifecycle hooks для подключения/отключения.

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

### 5. `apps/api/src/kg/kg.module.ts` и `apps/api/src/kg/kg.service.ts` (новые)

**Назначение:** NestJS-модуль для Knowledge Graph с базовыми CRUD-операциями.

**KgModule** — регистрирует KgService и PrismaService.
**KgService** — методы:
- `createNode(data: { type: KgNodeType; title: string; description?: string })` → KgNodeData
- `getNode(id: string)` → KgNodeData | null
- `listNodes(type?: KgNodeType)` → KgNodeData[]
- `createRelationship(data: { type: KgRelationshipType; sourceId: string; targetId: string })` → KgRelationshipData
- `getNeighbors(nodeId: string, direction?: 'in' | 'out' | 'both')` → KgNodeData[]

### 6. Обновление существующих файлов

- `apps/api/package.json` — добавить `@prisma/client: "^6"` в dependencies, `prisma: "^6"` в devDependencies, скрипты `prisma:generate`, `prisma:migrate`
- `apps/api/src/app.module.ts` — импортировать KgModule
- `packages/domain/src/index.ts` — добавить `export * from './kg.js'`

### 7. pnpm install + prisma generate

- `pnpm install` в корне
- `npx prisma generate` в packages/knowledge-graph (для генерации Prisma Client)
- `npx prisma generate` в apps/api

## Anti-conflict (важно для кодера)

**НЕ ТРОГАТЬ:**
- `docs/**` — вся документация заморожена.
- `README.md`, `LICENSE`, `CONTRIBUTING.md` в корне — заморожены.
- `.planning/phases/01-monorepo-skeleton/` — не редактировать артефакты Phase 1.
- `packages/domain/src/gsd.ts`, `decision.ts`, `context.ts`, `agent.ts`, `consensus.ts` — не менять существующие типы. Только **добавить** новый файл `kg.ts` и строчку в `index.ts`.
- **Не создавать** runtime-логику Context Service, Role Router, Consensus Engine — это будущие фазы.
- **Не подключать** реальную PostgreSQL — DATABASE_URL будет .env placeholder. Prisma generate работает без БД.
- **Не добавлять** миграции (`prisma migrate dev`) — только schema + generate. Миграции будут в фазе подключения БД.

## Готово, когда (success criteria)

- [ ] `pnpm install` из корня выполняется без ошибок.
- [ ] `npx prisma generate` в packages/knowledge-graph генерирует Prisma Client.
- [ ] `npx prisma generate` в apps/api генерирует Prisma Client.
- [ ] `pnpm -r typecheck` зелёный во всех пакетах (domain, knowledge-graph, api, web).
- [ ] `pnpm --filter @orchestra/knowledge-graph build` компилируется.
- [ ] `pnpm --filter @orchestra/api build` компилируется с KgModule.
- [ ] packages/domain/src/kg.ts экспортирует 4 типа (KgNodeType, KgRelationshipType, KgNodeData, KgRelationshipData).
- [ ] Prisma schema содержит модели KgNode и KgRelationship с enum NodeType (16 значений) и RelationshipType (8 значений).
- [ ] KgService содержит 5 методов (createNode, getNode, listNodes, createRelationship, getNeighbors).
- [ ] `git status` показывает только новые/изменённые файлы Phase 2, ни одного изменения в docs/ или корневых .md.

## Не готово, когда

- `pnpm install` падает — зависимости не резолвятся.
- `prisma generate` падает — ошибка в schema.prisma.
- `pnpm -r typecheck` красный — типы не совместимы.
- Кодер добавил бизнес-логику Context Service или Consensus Engine.
- Кодер отредактировал docs/ или существующие файлы domain (кроме добавления kg.ts + index.ts barrel).
- KgService содержит Prisma-запросы с реальной БД без guard (должен работать с generate, но миграции — будущие фазы).

## Что даёт эта фаза для Orchestra

- **Data layer для Knowledge Graph:** Prisma-схема с полным набором типов узлов и отношений из Architecture.md §6. Context Service будет строить Context Packets поверх этого графа.
- **Доменные типы KG в @orchestra/domain:** любой пакет может использовать KgNodeData/KgRelationshipType без зависимости от Prisma.
- **NestJS-интеграция:** PrismaService + KgModule — готовая инфраструктура для будущих фаз (Context Service, GSD Engine).
- **Контракт для Wave 3:** Context Service будет вызывать KgService.getNeighbors() для извлечения релевантного подграфа (Context Protocol.md §4).

## Следующий шаг

После PASS этой фазы Wave 3 продолжит наполнение каркаса:
- `packages/context-service` (Context Packet Builder, использующий KgService для запроса подграфа).
- Prompt Registry (hot-reload системных промптов из файловой системы).
- GSD Engine (конечный автомат фаз, использующий gating через Consensus).

Безопасно стартовать Wave 3 когда D-06 (typecheck) стабильно зелёный и Prisma Client генерируется без ошибок.
