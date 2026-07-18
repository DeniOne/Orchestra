---
phase: 02-knowledge-graph
plan: "01"
slice: 02-01
subsystem: knowledge-graph
tags: [prisma, data-layer, knowledge-graph]
requires:
  - phase: phase-01-monorepo-skeleton
    provides: monorepo skeleton with domain types
provides:
  - Prisma schema for Knowledge Graph (KgNode + KgRelationship)
  - Domain types KG in @orchestra/domain
  - NestJS KgModule with CRUD service
affects:
  - context-service (future)
  - gsd-engine (future)
tech-stack:
  added:
    - Prisma ^6
    - @prisma/client ^6
  patterns:
    - PrismaService with NestJS lifecycle (OnModuleInit/OnModuleDestroy)
    - domain types → knowledge-graph re-export (no circular dependency)
    - Prisma InputJsonValue cast for Json fields
key-files:
  created:
    - packages/knowledge-graph/package.json
    - packages/knowledge-graph/tsconfig.json
    - packages/knowledge-graph/prisma/schema.prisma
    - packages/knowledge-graph/src/index.ts
    - packages/knowledge-graph/src/types.ts
    - packages/domain/src/kg.ts
    - apps/api/prisma/schema.prisma
    - apps/api/src/prisma.service.ts
    - apps/api/src/kg/kg.module.ts
    - apps/api/src/kg/kg.service.ts
  modified:
    - apps/api/package.json
    - apps/api/src/app.module.ts
    - packages/domain/src/index.ts
    - package.json (pnpm.onlyBuiltDependencies)
    - pnpm-lock.yaml
key-decisions:
  - "Types defined in domain/src/kg.ts, re-exported from knowledge-graph/src/types.ts — avoids circular dependency"
  - "Prisma schema duplicated in apps/api (standard NestJS+Prisma monorepo pattern)"
  - "Prisma InputJsonValue cast needed for Json fields — Prisma's type is stricter than Record<string, unknown>"
  - "pnpm.onlyBuiltDependencies added to root package.json for Prisma build scripts"
patterns-established:
  - "KgService wraps Prisma with domain types (KgNodeData/KgRelationshipData) — decouples from Prisma at API boundary"
  - "PrismaService as global NestJS provider with lifecycle hooks"
requirements-completed:
  - ORCH-02-01
  - ORCH-02-02
  - ORCH-02-03
duration: 30min
completed: 2026-07-18
---

# Summary 02-01 — Knowledge Graph: Prisma-схема + доменные типы + NestJS-сервис

## Что сделано

1. **packages/domain/src/kg.ts**: Доменные типы Knowledge Graph — KgNodeType (16 значений), KgRelationshipType (8 значений), KgNodeData, KgRelationshipData. Без Prisma-зависимостей.

2. **packages/knowledge-graph/**: Новый пакет с Prisma-схемой (KgNode + KgRelationship), barrel export с Prisma Client. Типы реэкспортируются из @orchestra/domain.

3. **apps/api/**: PrismaService (NestJS lifecycle), KgModule, KgService с 5 методами (createNode, getNode, listNodes, createRelationship, getNeighbors). AppModule обновлён с импортом KgModule.

## D-критерии (верификация)

| Критерий | Статус | Доказательство |
|---|---|---|
| D-01: Prisma schema | PASS | KgNode + KgRelationship, NodeType (16), RelationshipType (8) |
| D-02: prisma generate | PASS | Оба пакета сгенерировали Prisma Client v6.19.3 |
| D-03: domain types | PASS | kg.ts экспортирует 4 типа |
| D-04: PrismaService | PASS | NestJS lifecycle, AppModule imports KgModule |
| D-05: KgService CRUD | PASS | 5 методов |
| D-06: typecheck | PASS | Все 4 пакета green |
| D-07: knowledge-graph build | PASS | tsc exit 0 |
| D-08: api build | PASS | nest build exit 0 |

## Key decisions

- Типы определены в domain, knowledge-graph их реэкспортирует — нет циклической зависимости.
- Prisma schema продублирована в apps/api (стандартный NestJS+Prisma паттерн).
- `pnpm.onlyBuiltDependencies` добавлен в root package.json для Prisma build scripts.
- Prisma InputJsonValue cast для Json полей — Prisma строже чем Record<string, unknown>.

## Duration

~30 минут.
