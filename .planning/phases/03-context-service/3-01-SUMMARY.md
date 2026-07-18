---
phase: 03-context-service
plan: "01"
slice: 03-01
subsystem: context-service
tags: [context-service, prompt-registry, packet-builder]
requires:
  - phase: phase-02-knowledge-graph
    provides: KgService with CRUD for Knowledge Graph
provides:
  - Context Packet Builder pipeline (extractSubgraph → applyPolicy → budget → assemble)
  - Prompt Registry (FS reader with sha256 versioning)
  - 5 default system prompts for roles
  - NestJS ContextModule + PromptsModule
  - D-A1 closed (api dist/main.js at root)
  - D-B3 closed (*.tsbuildinfo in .gitignore)
affects:
  - role-router (future, Wave 4)
  - providers (future, Wave 4)
tech-stack:
  added:
    - @orchestra/context-service (new package)
    - @orchestra/prompt-registry (new package)
  patterns:
    - Hexagonal ports (KgGraphPort, PromptPort) — context-service doesn't depend on Prisma/NestJS
    - Adapter pattern in apps/api (KgGraphAdapter, PromptAdapter)
    - Token budget approximation: char/4 ≈ tokens
key-files:
  created:
    - packages/context-service/package.json
    - packages/context-service/tsconfig.json
    - packages/context-service/src/types.ts
    - packages/context-service/src/context-policy.ts
    - packages/context-service/src/subgraph-extractor.ts
    - packages/context-service/src/packet-builder.ts
    - packages/context-service/src/index.ts
    - packages/prompt-registry/package.json
    - packages/prompt-registry/tsconfig.json
    - packages/prompt-registry/src/prompt-registry.ts
    - packages/prompt-registry/src/index.ts
    - prompts/architect.md
    - prompts/tech_lead.md
    - prompts/researcher.md
    - prompts/critic.md
    - prompts/engineer.md
    - apps/api/src/context/context.service.ts
    - apps/api/src/context/context.module.ts
    - apps/api/src/prompts/prompts.service.ts
    - apps/api/src/prompts/prompts.module.ts
  modified:
    - apps/api/package.json
    - apps/api/src/app.module.ts
    - apps/api/tsconfig.json
    - .gitignore
    - pnpm-lock.yaml
  removed-from-git:
    - apps/web/tsconfig.tsbuildinfo
key-decisions:
  - "Hexagonal ports (KgGraphPort, PromptPort) — context-service is pure logic, adapters in apps/api"
  - "paths: {} in apps/api/tsconfig.json overrides base path mappings to avoid rootDir conflict"
  - "Token budget = char/4 approximation (not tiktoken) — honest stub"
  - "Prompt Registry = read-per-call (no hot-reload) — honest stub"
  - "All 5 roles get policies + prompts (architect, tech_lead, researcher, critic, engineer)"
patterns-established:
  - "ContextPolicy with include/exclude by NodeType"
  - "BFS subgraph extraction with role-specific depth"
  - "ContextPacket assembly from KG nodes → domain fields"
  - "sha256 content hash for reproducibility"
requirements-completed:
  - ORCH-03-01
  - ORCH-03-02
  - ORCH-03-03
  - ORCH-03-04
debts-closed:
  - D-A1
  - D-B3
debts-remaining:
  - D-B2 (Prisma schema duplication)
  - D-C1 (Prompt Registry hot-reload stub)
  - D-C2 (Token compression approximation)
  - D-C3 (Memory Layers overlay simplified)
  - D-C4 (Event Bus publishing absent)
duration: 40min
completed: 2026-07-18
---

# Summary 03-01 — Context Service + Prompt Registry

## Что сделано

1. **packages/context-service**: Полный pipeline сборки ContextPacket — extractSubgraph (BFS), context-policy (5 ролей), packet-builder (18 полей + contentHash). Hexagonal ports (KgGraphPort, PromptPort) — чистая логика без Prisma/NestJS.

2. **packages/prompt-registry**: FS-ридер .md промптов с sha256 версионированием. Без hot-reload (read-per-call).

3. **prompts/*.md**: 5 seed-промптов (architect, tech_lead, researcher, critic, engineer).

4. **apps/api/src/context/**: ContextModule + ContextService с адаптерами (KgGraphAdapter → KgService, PromptAdapter → PromptService).

5. **apps/api/src/prompts/**: PromptsModule + PromptService.

6. **D-A1 закрыт**: `apps/api/dist/main.js` существует по прямому пути (rootDir: "./src" + paths: {}).

7. **D-B3 закрыт**: `*.tsbuildinfo` в .gitignore, `apps/web/tsconfig.tsbuildinfo` удалён из git-индекса.

## D-критерии

| # | Критерий | Статус |
|---|---|---|
| D-01 | extractSubgraph BFS | PASS |
| D-02 | ContextPolicy 5 ролей | PASS |
| D-03 | packet-builder → ContextPacket | PASS |
| D-04 | applyPolicy before budget | PASS |
| D-05 | PromptRegistry getPrompt + sha256 | PASS |
| D-06 | Hot-reload absent (stated) | PASS |
| D-07 | ContextModule + ContextService | PASS |
| D-08 | 5 prompts/*.md | PASS |
| D-09 | D-A1 closed | PASS |
| D-10 | D-B3 closed | PASS |
| D-11 | typecheck 6 пакетов green | PASS |
| D-12 | context-service build | PASS |
| D-13 | prompt-registry build | PASS |
| D-14 | api build с ContextModule | PASS |

## Key decisions

- Hexagonal ports — context-service не зависит от Prisma/NestJS.
- `paths: {}` в api tsconfig — переопределяет base path mappings для совместимости с rootDir.
- Token budget = char/4, Prompt Registry = read-per-call — честные заглушки.
- Все 5 ролей из Agent Protocol.md §1 получили политики и промпты.

## Duration

~40 минут.
