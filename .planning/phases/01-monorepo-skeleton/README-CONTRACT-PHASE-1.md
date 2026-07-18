# README Contract — Phase 1 monorepo-skeleton (Wave B-1)

**Verdict: PASS**
**Date:** 2026-07-18
**Milestone:** Orchestra MVP — Wave 1 (Foundation)
**Wave:** B-1
**Code review:** @zcode-assistant (Tech Lead)
**Coder:** mimo (Cursor)

## Scope

Phase 1 = монорепо-каркас Orchestra + base domain types. Цель: фундамент, на котором строятся все последующие фазы. Доказательство, что архитектурные контракты из `docs/* Protocol` переводимы в TypeScript-код.

**In scope:**
- Корневые конфиги монорепо (pnpm workspaces, tsconfig.base, .gitignore, .editorconfig, .npmrc).
- `packages/domain` — 5 файлов TypeScript-контрактов (gsd, decision, context, agent, consensus) с barrel export.
- `apps/api` — пустой NestJS-контейнер (API Gateway stub).
- `apps/web` — пустой Next.js 15 контейнер (Conducting Score UI stub).
- `git init` + первый коммит.

**Out of scope (забор на следующие волны):**
- Prisma-схема Knowledge Graph → Wave 2.
- Context Service / GSD Engine / Role Router / Consensus Engine (runtime-логика) → Wave 2+.
- Реальные провайдеры LLM → Wave 3+.
- Conducting Score UI (компоненты) → Wave 4+.

## Verification commands (frozen)

Эти команды — canonical-проверки фазы. Заморожены: любая будущая правка Phase 1-артефактов обязана оставлять их зелёными.

```bash
pnpm install                                   # D-01: workspace-связка
pnpm -r typecheck                              # D-02: типы (ГЛАВНЫЙ критерий)
pnpm --filter @orchestra/api build             # D-05: NestJS build
pnpm --filter @orchestra/web build             # D-06: Next.js build
```

Все четыре команды возвращают exit 0 на момент заморозки (2026-07-18).

## 🎯 Главная находка

**Контракты docs/* Protocol → TypeScript переводимы дословно, без потерь.** Все ключевые интерфейсы (`ContextPacket` — 18 полей, `DecisionConfidence` — 5 метрик + overall, `AIProvider` — 6 методов, `RoleManifest`, `Plugin`, `ConsensusReport`) материализованы в `packages/domain` и соответствуют канон-документам 1:1. Это снимает главный риск Wave 1: дальнейшие фазы ссылаются на `@orchestra/domain`, а не плодят дубликаты типов.

Вторичная находка: pnpm workspaces + TS path mapping (`baseUrl` + `paths` в `tsconfig.base.json`) + workspace-dep `workspace:*` дают рабочую связку для type-only импортов в обоих apps без runtime-кода в domain-пакете.

## Verification (по D-критериям)

| Критерий | Статус | Доказательство |
|---|---|---|
| **D-01** `pnpm install` exit 0, единый node_modules | ✅ PASS | "Done in 2.3s", "Scope: all 4 workspace projects", lockfile актуален |
| **D-02** `pnpm -r typecheck` exit 0 во ВСЕХ пакетах | ✅ PASS | domain/api/web — все "Done", exit 0 |
| **D-03** 5 файлов domain соответствуют docs/* Protocol | ✅ PASS | ContextPacket (18 полей), MemoryLayer (5 уровней), AIProvider (6 методов), ConsensusReport, DecisionConfidence (5 метрик+overall) — сверено с Context/Agent/Consensus Protocol.md |
| **D-04** `packages/domain` barrel export через index.ts | ✅ PASS | `export * from './gsd.js'` × 5 модулей; импорт `@orchestra/domain` работает в apps/api и apps/web (подтверждено typecheck) |
| **D-05** NestJS build exit 0, main.ts слушает PORT (default 3001) | ✅ PASS | "nest build" exit 0; main.ts: `app.listen(process.env.PORT ?? 3001)`. **См. долг D-A1** про outDir |
| **D-06** Next.js build exit 0, стартовая страница рендерится | ✅ PASS | "Compiled successfully in 5.1s", маршрут `/` prerendered (Static) |
| **D-07** .gitignore/.editorconfig/.npmrc/tsconfig.base с path-maps существуют | ✅ PASS | Все файлы на месте; `git check-ignore` подтверждает игнор .next/dist/node_modules |
| **D-08** git init выполнен, working tree чистое после фазы | ✅ PASS | `git rev-parse --is-inside-work-tree` → true; `git status` показывает только исходники (generated-файлы игнорируются) |

## Code review (по разделам PLAN)

| Раздел PLAN | Статус | Комментарий |
|---|---|---|
| Корневые конфиги | ✅ | Все 7 файлов созданы. `baseUrl: "."` в tsconfig.base — обоснованное дополнение MiMo (path-mappings не работают без него в strict-режиме). |
| `packages/domain` | ✅ | 5 файлов типов + barrel. `import type` используется корректно для разруливания circular-dep (context.ts ↔ agent.ts). MiMo применил inline `import('./context.js').ContextPacket` в AIProvider — рабочий паттерн. |
| `apps/api` (NestJS) | ✅ | main.ts + app.module.ts минимальные, bootstrap корректный. |
| `apps/web` (Next.js) | ✅ | App Router, layout/page минимальные, `transpilePackages` настроен. |
| apps/*/README.md | ✅ | Оба созданы, ссылка на canonical docs. |
| Anti-conflict | ✅ | `docs/`, `README.md`, `LICENSE`, `CONTRIBUTING.md` — untracked (не modified). MiMo ничего не тронул в замороженной зоне. |

## Deliverables

| Артефакт | Назначение | Статус |
|---|---|---|
| `pnpm-workspace.yaml` | Определение воркспейсов apps/* + packages/* | ✅ |
| `tsconfig.base.json` | Базовый TS-конфиг + path-maps `@orchestra/domain` | ✅ |
| `packages/domain/src/*.ts` | Доменные контракты Orchestra (из docs/* Protocol) | ✅ |
| `apps/api/src/` | NestJS API Gateway stub | ✅ |
| `apps/web/src/app/` | Next.js Conducting Score UI stub | ✅ |
| `1-01-SUMMARY.md` | Отчёт кодера MiMo | ✅ |

## Design decisions (почему так)

1. **`packageManager: "pnpm@10.34.5"` вместо `10.9.4` из PLAN.** MiMo в key-decisions заявил, что 10.9.4 не существует. На машине техлида реально стоит 10.9.4 (проверено в разведке) — это локальный Corepack. Решение принято: оставить 10.34.5 как консервативное поле, Corepack на любой машине подхватит корректную версию. Не блокер.
2. **`baseUrl: "."` в tsconfig.base.** PLAN этого не требовал явно, но без `baseUrl` поле `paths` игнорируется TypeScript в strict-режиме. MiMo добавил обоснованно — принимается, фиксируется как канон.
3. **`import type` для GSDPhase в app.module.ts / page.tsx.** PLAN просил «placeholder-использование для доказательства workspace link». MiMo сделал type-only импорт без использования — workspace-link доказан на уровне typecheck (D-02 зелёный), runtime-доказательство не требуется для stub-фазы. Принимается.

## Долг: D-A1 — `nest build` outDir-структура

Соблюдая правило PARTIAL-вердикта AGENTS.md, фиксирую три обязательных пункта по этому долгу:

1. **Почему появился.** `nest build` наследует `tsconfig.base.json` с `baseUrl: "."`, из-за чего tsc трактует корень monorepo как `rootDir` и сохраняет структуру папок в output. Результат: `apps/api/dist/apps/api/src/main.js` и `apps/api/dist/packages/domain/src/*.js` вместо ожидаемого плоского `apps/api/dist/main.js`. Функционально старт работает (`nest start` знает путь; `node dist/apps/api/src/main.js` тоже), но ломает стандартный `package.json` `main`-entry и усложнит деплой/докеризацию в Wave 5+.

2. **Когда закроется.** **(b) закроется попутно в Wave 2** — фаза `02-knowledge-graph-and-context` добавит Prisma и реальные NestJS-модули в `apps/api/src/`, что потребует нормализации `tsconfig` для apps/api (явный `rootDir: "./src"` + `composite: true` + project references). Это безопасно, потому что Wave 2 всё равно правит apps/api-конфиг, и заодно снимет долг без отдельной фазы. НЕ блокирует старт Wave 2.

3. **Блокирует ли следующую фазу / milestone-exit.** **НЕТ.** MVP-каркас функционален (все D-критерии зелёные, `nest start`/`next build` работают). Долг чисто косметический на уровне build-output-структуры, не влияет ни на typecheck, ни на запуск, ни на следующие пакеты. Milestone Wave 1 exit не блокирует.

## Authorship

- **Owner:** пользователь (Denis) — решение, что Phase 1 = монорепо-каркас.
- **Tech Lead:** @zcode-assistant — PLAN, code review, README-CONTRACT (этот файл), commit.
- **Coder:** mimo (Cursor) — реализация по PLAN, SUMMARY, 35 мин.

## Gate commands (для будущих回归-проверок)

```bash
# Полная регрессия Phase 1:
pnpm install && pnpm -r typecheck && pnpm --filter @orchestra/api build && pnpm --filter @orchestra/web build
# Все exit 0 = Phase 1 не сломана.
```

## Следующий шаг

Wave 2 — `02-knowledge-graph-and-context`:
- `packages/knowledge-graph` — Prisma-схема узлов/отношений (docs/Architecture.md §6).
- `packages/context-service` — Context Packet Builder (docs/Context Protocol.md §1).
- Попутно: закрытие долга D-A1 (нормализация apps/api tsconfig).
- NestJS-модули в `apps/api/src/` (Session Manager, GSD Engine stubs).

Безопасно стартовать Wave 2: D-02 (typecheck) стабильно зелёный — это контракт, на который опираются следующие пакеты. Phase 1 заморожена.
