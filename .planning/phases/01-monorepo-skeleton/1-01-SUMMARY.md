---
phase: 01-monorepo-skeleton
plan: "01"
slice: 01-01
subsystem: monorepo
tags: [skeleton, types, monorepo]
requires: []
provides:
  - pnpm workspace monorepo
  - @orchestra/domain TypeScript contracts
  - NestJS API shell
  - Next.js web shell
affects:
  - all-future-phases
tech-stack:
  added:
    - pnpm 10.34.5 workspaces
    - TypeScript ~5.6
    - NestJS ^10
    - Next.js 15
    - React 19
  patterns:
    - monorepo workspace with @orchestra/domain barrel export
    - TS path mapping via tsconfig.base.json
key-files:
  created:
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
    - apps/api/README.md
    - packages/domain/package.json
    - packages/domain/tsconfig.json
    - packages/domain/src/index.ts
    - packages/domain/src/gsd.ts
    - packages/domain/src/context.ts
    - packages/domain/src/agent.ts
    - packages/domain/src/consensus.ts
    - packages/domain/src/decision.ts
  modified: []
key-decisions:
  - "pnpm version set to 10.34.5 (10.9.4 from PLAN does not exist)"
  - "tsconfig.base.json needs baseUrl: '.' for path mappings to work"
  - "NestJS nest build outputs to dist/apps/api/src/ (monorepo tsc behavior) — main.js functional but nested"
  - "agent.ts uses import('./context.js') type-only imports to avoid circular dependency with context.ts"
patterns-established:
  - "workspace dependency: @orchestra/domain: workspace:*"
  - "domain package = pure type declarations, no runtime"
  - "apps consume domain via workspace link + TS path mapping"
requirements-completed:
  - ORCH-01-01
  - ORCH-01-02
  - ORCH-01-03
duration: 35min
completed: 2026-07-18
---

# Summary 01-01 — Монорепо-каркас Orchestra + base domain types

## Что сделано

Создан полный монорепо-каркас Orchestra с тремя workspace-пакетами:

1. **Корневые конфиги**: pnpm-workspace.yaml, tsconfig.base.json (с path mappings), .gitignore, .editorconfig, .npmrc.
2. **packages/domain/**: 5 файлов доменных типов (gsd.ts, decision.ts, context.ts, agent.ts, consensus.ts) + barrel index.ts. Все типы переведены дословно из docs/* Protocol.
3. **apps/api/**: Минимальный NestJS-контейнер (main.ts + app.module.ts), импортирующий @orchestra/domain.
4. **apps/web/**: Next.js 15 App Router с заглушкой страницы, импортирующей @orchestra/domain.
5. **Git**: репозиторий инициализирован.

## D-критерии (верификация)

| Критерий | Статус | Доказательство |
|---|---|---|
| D-01: pnpm install | PASS | exit 0, 315 packages, workspace links |
| D-02: pnpm -r typecheck | PASS | все 3 пакета green (domain, api, web) |
| D-03: Domain types | PASS | 5 файлов: gsd, decision, context, agent, consensus — все типы из Protocol |
| D-04: Domain barrel | PASS | index.ts реэкспортирует все 5 модулей |
| D-05: API build | PASS | nest build exit 0, main.js существует |
| D-06: Web build | PASS | Next.js compiled successfully, static pages generated |
| D-07: Config files | PASS | .gitignore, .editorconfig, .npmrc, tsconfig.base.json |
| D-08: Git init | PASS | .git существует, working tree чистый (только untracked Phase 1) |

## Key decisions

- **pnpm 10.34.5** вместо 10.9.4 из PLAN (версия не существует в registry).
- **baseUrl: "."** добавлен в tsconfig.base.json — необходим для работы paths mappings.
- **NestJS nest build** с tsc в монорепо кладёт output в `dist/apps/api/src/main.js` (вложенно). Функционально корректно, main.js существует.
- **Type-only imports** в agent.ts для ContextPacket —避免 циклических зависимостей между модулями domain.

## Duration

~35 минут.
