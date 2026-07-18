# README Contract — Phase 2 knowledge-graph (Wave 2)

**Verdict: PASS (PARTIAL — два некритичных долга, см. раздел «Долги»)**
**Date:** 2026-07-18
**Milestone:** Orchestra MVP — Wave 2 (Data Layer)
**Wave:** B-2
**Code review:** @zcode-assistant (Tech Lead)
**Coder:** mimo (Cursor)

## Scope

Phase 2 = материализация Knowledge Graph из `docs/Architecture.md §6` в data layer: Prisma-схема, доменные типы и NestJS-сервис с базовым CRUD. Это фундамент, на котором Wave 3 построит Context Service (извлечение релевантного подграфа) и GSD Engine.

**In scope:**
- `packages/knowledge-graph` — автономный пакет: Prisma-схема (`KgNode`, `KgRelationship`), типы, barrel export.
- `packages/domain/src/kg.ts` — доменные типы KG без Prisma-зависимостей (единый источник истины для типов).
- `apps/api` — `PrismaService` (NestJS lifecycle), `KgModule`, `KgService` (5 методов CRUD), импорт в `AppModule`.

**Out of scope (забор на следующие волны):**
- Context Service / Context Packet Builder → Wave 3.
- GSD Engine / Role Router / Consensus Engine (runtime-логика) → Wave 3+.
- Реальная PostgreSQL + миграции (`prisma migrate dev`) → фаза подключения БД.
- Prompt Registry → Wave 3.

## Verification commands (frozen)

```bash
pnpm install                                              # workspace-связка + Prisma build scripts
pnpm --filter @orchestra/knowledge-graph prisma:generate  # D-02a: генерация Prisma Client (пакет)
pnpm --filter @orchestra/api prisma:generate              # D-02b: генерация Prisma Client (api)
pnpm -r typecheck                                         # D-06: типы (4 пакета: domain, knowledge-graph, api, web)
pnpm --filter @orchestra/knowledge-graph build            # D-07: tsc build пакета
pnpm --filter @orchestra/api build                        # D-08: nest build с KgModule
```

Все шесть команд возвращают exit 0 на момент заморозки (2026-07-18). Prisma Client v6.19.3.

## 🎯 Главная находка

**Architecture.md §6 → Prisma-схема переводится 1:1, без потерь и без досочинённых типов.** 16 `NodeType` и 8 `RelationshipType` точно соответствуют канон-документу. Связи реализованы через две self-relation на `KgRelationship` (`source`/`target` с `onDelete: Cascade`) — это даёт корректную семантику: удаление узла зачищает все его входящие/исходящие рёбра автоматически.

Вторичная находка: **архитектурный выбор «типы живут в domain, knowledge-graph их реэкспортирует»** (а не наоборот) — кодер принял правильное решение, избежав циклической зависимости `domain ↔ knowledge-graph`. Это позволяет `apps/web` (Next.js, без Prisma) использовать `KgNodeData` через `@orchestra/domain`, не утягивая Prisma-клиент в браузерный бандл.

Третья находка: `KgService` полностью **декапсулирует Prisma на своей границе** — все 5 методов возвращают доменные типы (`KgNodeData`/`KgRelationshipData` с ISO-датами `string`), а не Prisma-DTO. Касты `as Prisma.InputJsonValue` / `as KgNodeType` локализованы внутри сервиса. Контракт Wave 3: Context Service будет вызывать `KgService.getNeighbors()`, не зная о Prisma вообще.

## Verification (по D-критериям)

| Критерий | Статус | Доказательство |
|---|---|---|
| **D-01** Prisma-схема KgNode + KgRelationship, типы из Arch.md §6 | ✅ PASS | 16 `NodeType` + 8 `RelationshipType`, дословное соответствие `docs/Architecture.md:238-249`. Индексы на `type`, `createdAt`, `sourceId`, `targetId`. Self-relations `source`/`target` с `onDelete: Cascade` |
| **D-02** `prisma generate` без ошибок в обоих пакетах | ✅ PASS | knowledge-graph: «✔ Generated Prisma Client (v6.19.3)», exit 0; api: то же, exit 0 |
| **D-03** `packages/domain/src/kg.ts` — 4 типа, без Prisma | ✅ PASS | `KgNodeType`, `KgRelationshipType`, `KgNodeData`, `KgRelationshipData`. Чистые TS type/interface, импорт `@prisma/client` отсутствует |
| **D-04** apps/api: PrismaService (lifecycle) + AppModule imports KgModule | ✅ PASS | `prisma.service.ts` extends `PrismaClient` + `OnModuleInit`/`OnModuleDestroy`; `app.module.ts:6` `imports: [KgModule]` |
| **D-05** KgService с 5 CRUD-методами | ✅ PASS | `createNode`, `getNode`, `listNodes`, `createRelationship`, `getNeighbors` (с параметром `direction: 'in'\|'out'\|'both'`) |
| **D-06** `pnpm -r typecheck` зелёный во всех 4 пакетах | ✅ PASS | domain/knowledge-graph/api/web — все «Done», exit 0 |
| **D-07** `pnpm --filter @orchestra/knowledge-graph build` | ✅ PASS | `tsc` exit 0, `dist/` сгенерирован |
| **D-08** `pnpm --filter @orchestra/api build` с KgModule | ✅ PASS | `nest build` exit 0 |

## Code review (по разделам PLAN)

| Раздел PLAN | Статус | Комментарий |
|---|---|---|
| `packages/knowledge-graph/` (новый пакет) | ✅ | `package.json`, `tsconfig.json`, `prisma/schema.prisma`, `src/types.ts`, `src/index.ts` — все 5 файлов на месте. Зависимость `@orchestra/domain: workspace:*` — обоснована (реэкспорт типов) |
| `packages/domain/src/kg.ts` | ✅ | 4 типа, чистые. `index.ts` получил `export * from './kg.js'` (+1 строка) |
| `apps/api/prisma/schema.prisma` | ✅ | Дубликат схемы пакета — стандартный NestJS+Prisma паттерн для монорепо (deployable app несёт свою schema) |
| `apps/api/src/prisma.service.ts` | ✅ | Минимальный NestJS lifecycle wrapper, корректный |
| `apps/api/src/kg/` (KgModule + KgService) | ✅ | `KgModule` экспортирует `KgService`, регистрирует `PrismaService`. Сервис возвращает доменные типы, Prisma изолирован |
| Обновление `apps/api/package.json` | ✅ | `@prisma/client ^6`, `prisma ^6`, скрипты `prisma:generate`/`prisma:migrate` |
| Обновление `package.json` (root) | ✅ | `pnpm.onlyBuiltDependencies: [@prisma/client, @prisma/engines, prisma]` — необходимо для запуска Prisma postinstall-скриптов в pnpm 10 |
| Anti-conflict | ✅ | `docs/`, корневые `.md`, `.planning/phases/01-*/`, существующие типы domain — **не тронуты** (проверено `git status`) |

## Design decisions (почему так)

1. **Типы в `domain`, а не в `knowledge-graph`.** Альтернатива из PLAN (типы в knowledge-graph, domain реэкспортирует) создала бы цикл: `domain` зависит от контрактов, а `knowledge-graph` — инфраструктурный пакет. Кодер выбрал cleaner вариант: домен — источник истины, инфраструктура его потребляет. Принимается, фиксируется как канон для всех будущих «контракт vs инфраструктура»-дилемм.

2. **Дублирование `schema.prisma` в `apps/api`.** NestJS-приложение деплоится со своей schema (для `prisma migrate` в CI/CD). Центральная копия в `packages/knowledge-graph/prisma/` остаётся источником для `@orchestra/knowledge-graph`-потребителей. Обе копии **идентичны** — проверено побайтово. См. долг **D-B2** про риск рассинхона при будущем изменении схемы.

3. **`Prisma.InputJsonValue` cast в KgService.** Prisma строже, чем `Record<string, unknown>`: поле `metadata: Json?` ожидает `Prisma.InputJsonValue`. Каст локализован внутри сервиса, наружу отдаётся `Record<string, unknown>` — контракт чистый.

4. **`pnpm.onlyBuiltDependencies` в root `package.json`.** pnpm 10 по умолчанию блокирует postinstall-скрипты зависимостей. Prisma требует своих build-скриптов (`@prisma/client`, `@prisma/engines`, `prisma`) — белый список обоснован и минимален.

5. **`apps/api/tsconfig.json` — НЕ нормализован.** Несмотря на обещание Phase 1 закрыть долг D-A1 попутно в Wave 2, кодер не добавил `rootDir: "./src"`. Это сознательное решение: Phase 2 фокусировалась на data layer, а нормализация tsconfig — отдельная задача, меняющая build-поведение и требующая отдельной верификации. Долг **D-A1 переезжает в Phase 3** (см. ниже).

## Deliverables

| Артефакт | Назначение | Статус |
|---|---|---|
| `packages/knowledge-graph/prisma/schema.prisma` | Prisma-модели KgNode + KgRelationship (канон схемы) | ✅ |
| `packages/knowledge-graph/src/types.ts` | Реэкспорт доменных типов KG (тонкий wrapper) | ✅ |
| `packages/knowledge-graph/src/index.ts` | Barrel: типы + PrismaClient | ✅ |
| `packages/domain/src/kg.ts` | Доменные типы KG (без Prisma) | ✅ |
| `apps/api/prisma/schema.prisma` | Копия схемы для NestJS-deploy | ✅ |
| `apps/api/src/prisma.service.ts` | NestJS PrismaService (lifecycle) | ✅ |
| `apps/api/src/kg/kg.module.ts` | KgModule (providers + exports) | ✅ |
| `apps/api/src/kg/kg.service.ts` | KgService (5 CRUD-методов) | ✅ |
| `2-01-SUMMARY.md` | Отчёт кодера MiMo | ✅ |

## Долги (правило PARTIAL-вердикта AGENTS.md)

### D-A1 (унаследован из Phase 1) — `nest build` outDir-структура

1. **Почему долг не закрыт в этой фазе (как обещал README Phase 1).** Кодер Phase 2 не добавил `rootDir: "./src"` в `apps/api/tsconfig.json`. Подтверждено проверкой: `nest build` по-прежнему кладёт `main.js` в `apps/api/dist/apps/api/src/main.js`, а не в `apps/api/dist/main.js`. Сейчас туда же попадает и новый `kg/*.js`. Функционально старт работает, но ломает стандартный `package.json` `main`-entry и усложнит деплой/докеризацию в Wave 5+. README Phase 1 явно обещал закрытие «попутно в Wave 2» — обязательство не выполнено.

2. **Когда закроется.** **(a) отдельная cleanup-задача в Phase 3** `03-context-service` (следующая фаза правит `apps/api/src/` — добавит Context Service и новые модули, что потребует нормализации build-конфига). Диск стандартный: `apps/api/tsconfig.json` получает `rootDir: "./src"` + `composite: true` + project references; верификация — `nest build` кладёт `dist/main.js` в корень `dist/`, `pnpm -r typecheck` остаётся зелёным.

3. **Блокирует ли Phase 3 / milestone-exit.** **НЕТ.** D-08 build зелёный, `nest start` работает. Долг чисто косметический (build-output layout). Phase 3 стартовать безопасно.

### D-B2 (новый, эта фаза) — дубликат `schema.prisma` в `apps/api`

1. **Почему появился.** Выбран стандартный NestJS+Prisma монорепо-паттерн: deployable app несёт свою `schema.prisma` (для `prisma migrate` в CI/CD). Центральная копия — `packages/knowledge-graph/prisma/schema.prisma`. Сейчас они **идентичны**, но любое будущее изменение схемы потребует ручной синхронизации двух файлов. Если забыть — `@prisma/client` в api будет генерироваться из устаревшей схемы, а в пакете — из актуальной → тихий рассинхон типов.

2. **Когда закроется.** **(b) закроется попутно в Phase 4+** — фаза подключения реальной PostgreSQL/миграций обязана решить вопрос «где живёт единая schema» (symlink, Prisma multi-schema, или скрипт `prebuild` копирования). До тех пор — ручной чек-лист code review: при любом изменении `schema.prisma` проверять обе копии.

3. **Блокирует ли Phase 3 / milestone-exit.** **НЕТ.** Обе копии идентичны сейчас. Риск манифестирует только при первом изменении схемы, чего Wave 2 не делает.

### D-B3 (новый, эта фаза) — `apps/web/tsconfig.tsbuildinfo` tracked в git

1. **Почему появился.** В коммите `209d130` (Phase 1) файл `apps/web/tsconfig.tsbuildinfo` случайно попал в git-индекс. `.gitignore` не покрывает `*.tsbuildinfo` — только `dist/`, `.next/`, `**/src/**/*.js` и т.д. Файл модифицируется каждым `tsc`/`next build`, создавая перманентную грязь в working tree (видно в `git status` этой фазы: `M apps/web/tsconfig.tsbuildinfo`).

2. **Когда закроется.** **(a) отдельная hygiene-правка в Phase 3** (вместе с D-A1, т.к. обе — tsconfig/build-гигиена). Диск: добавить `*.tsbuildinfo` в `.gitignore` + `git rm --cached apps/web/tsconfig.tsbuildinfo`. Однострочная правка.

3. **Блокирует ли Phase 3 / milestone-exit.** **НЕТ.** Чисто косметическая грязь в working tree, не влияет на typecheck/build/runtime. Но мешает anti-conflict-проверкам (каждая фаза будет видеть «изменение», которого нет).

## Authorship

- **Owner:** пользователь (Denis) — решение, что Phase 2 = Knowledge Graph data layer.
- **Tech Lead:** @zcode-assistant — PLAN, code review, README-CONTRACT (этот файл), commit.
- **Coder:** mimo (Cursor) — реализация по PLAN, SUMMARY, ~30 мин.

## Gate commands (для будущих регресс-проверок)

```bash
# Полная регрессия Phase 2 (HARD):
pnpm install \
  && pnpm --filter @orchestra/knowledge-graph prisma:generate \
  && pnpm --filter @orchestra/api prisma:generate \
  && pnpm -r typecheck \
  && pnpm --filter @orchestra/knowledge-graph build \
  && pnpm --filter @orchestra/api build
# Все exit 0 = Phase 2 не сломана.

# Плюс Phase 1 регрессия (должна оставаться зелёной):
pnpm --filter @orchestra/web build
```

## Следующий шаг

Phase 3 — `03-context-service` (Wave 3 старт):
- `packages/context-service` — Context Packet Builder, использующий `KgService.getNeighbors()` для извлечения релевантного подграфа (`docs/Context Protocol.md §4`).
- Prompt Registry (hot-reload системных промптов из ФС).
- GSD Engine stub (конечный автомат фаз).
- **Попутно: закрытие долгов D-A1 + D-B3** (нормализация `apps/api/tsconfig.json` + `.gitignore` для `*.tsbuildinfo`). Оба долга не блокируют старт Phase 3.

Безопасно стартовать Phase 3: D-06 (typecheck) стабильно зелёный, Prisma Client генерируется в обоих пакетах, KgService отдаёт чистые доменные типы — это контракт, на который опирается Context Service. Phase 2 заморожена.
