# README Contract — Phase 3 context-service (Wave 3)

**Verdict: PASS (PARTIAL — четыре честных заглушки D-C1..D-C4, см. раздел «Долги»)**
**Date:** 2026-07-18
**Milestone:** Orchestra MVP — Wave 3 (Context Layer)
**Wave:** B-3
**Code review:** @zcode-assistant (Tech Lead)
**Coder:** mimo (Cursor)

## Scope

Phase 3 = реализация ядра **Context Service** — центрального инварианта Orchestra (`Context Protocol.md §8`: ни один агент не получает полную историю, каждый — специализированный ContextPacket). Из 7 узлов pipeline (KG → Builder → Memory overlay → Compression → Packet → Router → Provider) эта фаза покрывает **первые 5** — сборку пакета. Router/Provider/GSD Engine/Consensus — Wave 4+.

**In scope:**
- `packages/context-service` — ядро: subgraph-extractor (BFS по §4), context-policy (include/exclude по §5, 5 ролей), packet-builder (18 полей ContextPacket + contentHash).
- `packages/prompt-registry` — минимальный FS-ридер `.md`-промптов с sha256-версионированием.
- `prompts/*.md` × 5 — seed-промпты ролей (architect/tech_lead/researcher/critic/engineer).
- `apps/api/src/context/` + `apps/api/src/prompts/` — NestJS-модули-адаптеры.
- **Закрытие долгов D-A1 + D-B3** (build hygiene).

**Out of scope (забор на Wave 4+):**
- Role Router, Provider adapters (OpenAI/GLM/Gemini/MiMo) → Wave 4.
- Полная токенизация Compression (tiktoken) → Wave 4.
- Prompt Registry hot-reload (FS-watcher) → Wave 4+.
- Memory Layers overlay с персистенцией → Wave 4+.
- Event Bus publishing (`ContextPacketBuilt`) → Wave 5 (с Event Bus).
- Decision Repository → Wave 5.

## Verification commands (frozen)

```bash
pnpm install                                              # workspace-связка (7 пакетов)
pnpm -r typecheck                                         # D-11: 6 пакетов green
pnpm --filter @orchestra/context-service build            # D-12
pnpm --filter @orchestra/prompt-registry build            # D-13
pnpm --filter @orchestra/api build                        # D-14 (с ContextModule + PromptsModule)
pnpm --filter @orchestra/web build                        # Phase 1 регрессия (D-B3 не сломал)
```

Все команды возвращают exit 0 на момент заморозки (2026-07-18).

## 🎯 Главная находка

**Hexagonal ports (`KgGraphPort`, `PromptPort`) доказали свою ценность немедленно.** Пакет `context-service` — чистая логика сборки пакета, не знающая ни о Prisma, ни о NestJS, ни о FS. Проверено objectively: `grep -rn "@prisma\|@nestjs" packages/context-service/src/` → пусто (exit 1). Это значит, что pipeline Context Service можно тестировать изолированно (mock-порты), переиспользовать в `apps/web` (если понадобится клиентская сборка пакетов), и — главное — менять адаптеры без правки ядра.

Вторичная находка: **Context Protocol.md §4 алгоритм (BFS от objective → расширение на глубину k → политика роли → токен-бюджет) материализован дословно**, в том же порядке. `buildPacket()` читается как спецификация: `extractSubgraph → applyPolicy → applyTokenBudget → collectPacketFields → assemble`. Это снимает риск «код расходится с докой».

Третья находка: **`paths: {}` override в `apps/api/tsconfig.json`** — нестандартное, но рабочее решение для закрытия долга D-A1. Base tsconfig задаёт `paths` для `@orchestra/domain`, но с `rootDir: "./src"` это вызывает TS6059 (файл вне rootDir). Кодер не откатил rootDir (как требовал PLAN), а обнулил `paths` — api получает типы domain через workspace-разрешение `@orchestra/domain` (не через path-mapping). Проверено: clean rebuild кладёт `dist/main.js` в корень, nesting отсутствует.

## Verification (по D-критериям)

| Критерий | Статус | Доказательство |
|---|---|---|
| **D-01** extractSubgraph — BFS от objective, глубина k, без Prisma | ✅ PASS | `subgraph-extractor.ts`: BFS по `KgGraphPort`, оперирует `KgNodeData`, фильтрация по NodeType делегирована в applyPolicy. Допущение (нет фильтра по RelationshipType) зафиксировано в комментарии |
| **D-02** ContextPolicy — 5 ролей, include/exclude | ✅ PASS | `context-policy.ts`: `DEFAULT_POLICIES` для architect/tech_lead/researcher/critic/engineer. Соответствует Context Protocol.md §5 |
| **D-03** packet-builder → ContextPacket (18 полей) | ✅ PASS | `packet-builder.ts`: все поля из `domain/context.ts` заполняются; возвращает доменный `ContextPacket` |
| **D-04** applyPolicy ДО budget (порядок §4) | ✅ PASS | `buildPacket`: `extractSubgraph → applyPolicy → applyTokenBudget` — порядок алгоритма §4 соблюдён |
| **D-05** PromptRegistry: getPrompt + sha256 версия | ✅ PASS | `prompt-registry.ts`: `readFile` + `crypto.subtle.digest('SHA-256')`, возвращает `{content, version}` |
| **D-06** hot-reload отсутствует (явно) | ✅ PASS | Заглушка read-per-call, зафиксировано в JSDoc и SUMMARY → долг D-C1 |
| **D-07** ContextModule + ContextService (NestJS) | ✅ PASS | `context.service.ts`: `KgGraphAdapter`/`PromptAdapter` + `ContextService.buildPacket()`. AppModule imports ContextModule |
| **D-08** 5 файлов prompts/*.md | ✅ PASS | `architect/tech_lead/researcher/critic/engineer.md` — все существуют, выровнены с Agent Protocol.md §1 (проверено: «never writes code» для architect, «isolation» для critic) |
| **D-09** **D-A1 ЗАКРЫТ** — `dist/main.js` по прямому пути | ✅ PASS | Clean rebuild: `apps/api/dist/main.js` (420 байт). Nested `dist/apps/`, `dist/packages/` отсутствуют. Структура: `dist/{main,app.module,prisma.service}.js` + `{context,kg,prompts}/` |
| **D-10** **D-B3 ЗАКРЫТ** — tsbuildinfo ignored + untracked | ✅ PASS | `.gitignore:18:*.tsbuildinfo`. `git check-ignore` → exit 0. Файл staged как `D` (удалён из индекса через `git rm --cached`). `git status` не покажет его как modified после коммита |
| **D-11** `pnpm -r typecheck` зелёный (6 пакетов) | ✅ PASS | domain/knowledge-graph/context-service/prompt-registry/api/web — все «Done», exit 0 |
| **D-12** `context-service build` | ✅ PASS | `tsc` exit 0, `dist/` сгенерирован |
| **D-13** `prompt-registry build` | ✅ PASS | `tsc` exit 0, `dist/` сгенерирован |
| **D-14** `api build` с ContextModule + PromptsModule | ✅ PASS | `nest build` exit 0 |

**Дополнительно (Phase 1/2 регрессия):** `pnpm --filter @orchestra/web build` — exit 0. D-B3 правка `.gitignore` не сломала веб-сборку.

## Code review (по разделам PLAN)

| Раздел PLAN | Статус | Комментарий |
|---|---|---|
| `packages/context-service/` (новый) | ✅ | 5 файлов (`types.ts`, `context-policy.ts`, `subgraph-extractor.ts`, `packet-builder.ts`, `index.ts`). Hexagonal ports чистые (grep-проверка). Зависимость только `@orchestra/domain` |
| `packages/prompt-registry/` (новый) | ✅ | 2 файла. FS-ридер + sha256. Без NestJS (grep-проверка). **Кодер добавил `@types/node`** (не в PLAN) — обоснованно, использует `node:fs/promises`/`node:path`/`crypto.subtle`. Принимается |
| `prompts/*.md` × 5 | ✅ | Все 5 файлов, 7 строк каждый (1-3 абзаца). Seed-качество, не финальные промпты — соответствует PLAN |
| `apps/api/src/context/` | ✅ | `ContextModule` imports KgModule+PromptsModule, экспортирует ContextService. Адаптеры `KgGraphAdapter`/`PromptAdapter` корректно реализуют порты |
| `apps/api/src/prompts/` | ✅ | `PromptService` оборачивает `PromptRegistry`, каталог `prompts/` разрешается через `resolve(cwd, '../../prompts')` |
| D-A1 фикс (`tsconfig.json`) | ✅ | `rootDir: "./src"` + `paths: {}`. См. design decision #3 ниже |
| D-B3 фикс (`.gitignore` + `git rm --cached`) | ✅ | `*.tsbuildinfo` добавлен в `.gitignore`, файл убран из индекса |
| Anti-conflict | ✅ | `docs/`, корневые `.md`, `.planning/phases/01-*/`+`02-*/`, `packages/domain/src/`, `packages/knowledge-graph/`, `apps/api/src/kg/` — **всё чисто** (проверено `git status`) |

## Design decisions (почему так)

1. **Hexagonal ports — осознанный архитектурный выбор.** `KgGraphPort` и `PromptPort` в `context-service/src/types.ts` — это интерфейсы, которые пакет определяет, а `apps/api` реализует адаптерами (`KgGraphAdapter` → KgService, `PromptAdapter` → PromptService). Результат: ядро pipeline тестируется без БД/FS, не утягивает Prisma в браузерный бандл (если `apps/web` когда-то понадобится клиентская сборка), и адаптеры заменяются без правки ядра. Это канон для всех будущих «логика vs инфраструктура»-дилемм Orchestra.

2. **Два пакета, не один.** `context-service` и `prompt-registry` — отдельные контейнеры (по Architecture.md §3). У prompt-registry своя эволюция (hot-reload, версионирование, возможный DB-backend). Слияние создало бы связанность, ломающую будущий hot-reload.

3. **`paths: {}` override для D-A1 (отклонение от PLAN).** PLAN предлагал только `rootDir: "./src"` и предупреждал: если tsc ругается TS6059, **не откатывать rootDir**, а сообщить. Кодер столкнулся с тем, что base `paths` (`@orchestra/domain` → `packages/domain/src`) при `rootDir: "./src"` тянет файлы вне rootDir. Решение: обнулить `paths` в api-конфиге. Теперь api резолвит `@orchestra/domain` через workspace-механизм pnpm (а не через TS path-mapping). **Проверено working:** clean rebuild → `dist/main.js` в корне, typecheck green, импорты domain работают. Это допустимое решение — path-mappings в base были нужны в Phase 1 (когда domain не был ещё workspace-пакетом с `exports`), сейчас workspace-resolve достаточен. Принимается, фиксируется как канон для apps/* tsconfig.

4. **Честные заглушки вместо полу-реализаций.** Token budget = char/4 (не tiktoken), Prompt Registry = read-per-call (не hot-reload), Memory Layers = упрощённый (без персистенции), Event Bus publishing = отсутствует. Каждая заглушка явно в JSDoc/комментарии + в SUMMARY → долг D-C*. Принцип: лучше честная заглушка с долгом, чем полу-реализация, притворяющаяся готовой (anti-fake-green).

5. **`@types/node` добавлен в prompt-registry.** Кодер вышел за рамки PLAN, добавив devDep `@types/node` — пакет использует `node:fs/promises`, `node:path`, `crypto.subtle` (Web Crypto глобал Node 20). Без типов tsc ругался бы на `crypto`/`readFile`. Обоснованное расширение, принимается. (`context-service` тоже использует `crypto.subtle`, но типы подтянулись транзитивно через `@orchestra/domain`/workspace — typecheck green без явного dep. Не критично, но для чистоты можно добавить позже.)

## Deliverables

| Артефакт | Назначение | Статус |
|---|---|---|
| `packages/context-service/src/packet-builder.ts` | Сборка ContextPacket (18 полей + contentHash) | ✅ |
| `packages/context-service/src/subgraph-extractor.ts` | BFS-извлечение подграфа (Context Protocol §4) | ✅ |
| `packages/context-service/src/context-policy.ts` | 5 дефолтных политик ролей + applyPolicy | ✅ |
| `packages/context-service/src/types.ts` | Hexagonal ports (KgGraphPort, PromptPort) | ✅ |
| `packages/prompt-registry/src/prompt-registry.ts` | FS-ридер промптов + sha256 версия | ✅ |
| `apps/api/src/context/context.service.ts` | NestJS-оркестрация pipeline | ✅ |
| `apps/api/src/prompts/prompts.service.ts` | NestJS-обёртка PromptRegistry | ✅ |
| `prompts/*.md` × 5 | Seed-промпты ролей | ✅ |
| `3-01-SUMMARY.md` | Отчёт кодера MiMo | ✅ |

## Долги (правило PARTIAL-вердикта AGENTS.md)

### D-A1 (из Phase 1) — ✅ ЗАКРЫТ в этой фазе

`apps/api/tsconfig.json` получил `rootDir: "./src"` + `paths: {}`. Clean rebuild подтверждает: `dist/main.js` в корне, nesting отсутствует. Долг закрыт.

### D-B3 (из Phase 2) — ✅ ЗАКРЫТ в этой фазе

`*.tsbuildinfo` в `.gitignore`, `apps/web/tsconfig.tsbuildinfo` убран из git-индекса. Долг закрыт.

### D-B2 (из Phase 2) — переносится дальше

1. **Почему.** Дубликат `schema.prisma` в `apps/api` и `packages/knowledge-graph/prisma/`. Сейчас идентичны, риск рассинхрона при изменении схемы.
2. **Когда.** **Wave 5** — фаза подключения реальной PostgreSQL/миграций решит вопрос единой schema (symlink / Prisma multi-schema / prebuild-копирование).
3. **Блокирует Phase 4?** **НЕТ.** Копии идентичны; риск манифестирует только при первом изменении схемы, чего Wave 4 не делает.

### D-C1 (новый, эта фаза) — Prompt Registry hot-reload

1. **Почему.** Реализован read-per-call (чтение `.md` при каждом `getPrompt`). Hot-reload (FS-watcher, инвалидация кэша) — отдельная нетривиальная подсистема. Agent Protocol.md §5 и Orchestra_TC.md §14 требуют hot-reload («редактирование без перекомпиляции»).
2. **Когда.** **(b) попутно в Wave 5** — фаза «настраиваемые системные промпты» (Sprint 5 по GSD Integration.md §7) включит FS-watcher + кэш. До тех пор read-per-call функционален (промпты читаются, версия считается), просто не подхватывает правки без рестарта.
3. **Блокирует Phase 4?** **НЕТ.** Role Router будет вызывать `ContextService.buildPacket()` → `PromptService.getPrompt()` — это работает уже сейчас.

### D-C2 (новый, эта фаза) — Token Compression аппроксимация

1. **Почему.** Реализована аппроксимация `chars / 4 ≈ tokens` (эвристика для английского текста). Реальная токенизация требует tiktoken/`@anthropic-ai/tokenizer` — зависимость + интеграция.
2. **Когда.** **(b) попутно в Wave 4** — фаза Provider adapters логично включает реальный estimateTokens (AIProvider.estimateTokens из Agent Protocol.md §7). До тех пор аппроксимация даёт порядок величины, достаточный для отсева.
3. **Блокирует Phase 4?** **НЕТ.** Budget-cutoff работает (отбрасывает хвост узлов), просто с погрешностью ~20-30% на не-английском тексте.

### D-C3 (новый, эта фаза) — Memory Layers overlay упрощённый

1. **Почему.** Context Protocol.md §3 описывает 5 Memory Layers как overlay над KG (узлы распределяются по Layer 1-5 по типу и временной зоне). Реализация: `MemoryLayer` enum есть в domain (Phase 1), но `packet-builder` не использует его для приоритизации при budget-cutoff (сейчас простой FIFO по порядку извлечения).
2. **Когда.** **Wave 4+** — когда появится реальная персистенция сессий/раундов (Working/Conversation/Scratch Memory требуют временных меток раундов). System/Project Layer можно добавить раньше (они статичны).
3. **Блокирует Phase 4?** **НЕТ.** Пакет собирается корректно; упущена только оптимизация «что отбросить при нехватке бюджета».

### D-C4 (новый, эта фаза) — Event Bus publishing отсутствует

1. **Почему.** Architecture.md §5 требует событие `ContextPacketBuilt` на Event Bus при каждой сборке пакета. Event Bus (Redis + BullMQ) ещё не существует в проекте.
2. **Когда.** **Wave 5** — фаза Event Bus добавит шину, после чего ContextService (и др. producers) получат публикацию событий.
3. **Блокирует Phase 4?** **НЕТ.** Публикация событий — асинхронная телеметрия, не влияет на функциональность сборки пакета.

## Authorship

- **Owner:** пользователь (Denis) — решение, что Phase 3 = Context Service.
- **Tech Lead:** @zcode-assistant — PLAN, code review, README-CONTRACT (этот файл), commit.
- **Coder:** mimo (Cursor) — реализация по PLAN, SUMMARY, ~40 мин.

## Gate commands (для будущих регресс-проверок)

```bash
# Полная регрессия Phase 3 (HARD):
pnpm install \
  && pnpm -r typecheck \
  && pnpm --filter @orchestra/context-service build \
  && pnpm --filter @orchestra/prompt-registry build \
  && pnpm --filter @orchestra/api build \
  && pnpm --filter @orchestra/web build
# Все exit 0 = Phase 3 не сломана.

# Проверка чистоты пакетов (контракт hexagonal):
grep -rn "@prisma\|@nestjs" packages/context-service/src/   # пусто
grep -rn "@nestjs" packages/prompt-registry/src/             # пусто

# Проверка закрытия D-A1:
rm -rf apps/api/dist && pnpm --filter @orchestra/api build
test -f apps/api/dist/main.js && echo "D-A1 OK"              # должно существовать
```

## Следующий шаг

Phase 4 — `04-role-router-providers` (Wave 4 старт):
- `packages/role-router` — диспетчеризация ContextPacket по RoleManifest (Agent Protocol.md §4).
- `packages/providers` — адаптеры AIProvider (OpenAI/GLM/Gemini/MiMo) с `send`/`stream`/`cancel`/`estimateTokens`/`estimateCost`/`health` (Agent Protocol.md §7).
- Полная токенизация (tiktoken) — закроет долг **D-C2**.
- GSD Engine runtime (конечный автомат фаз, gating-хуки).

Безопасно стартовать Phase 4: D-11 typecheck стабильно зелёный, `ContextService.buildPacket()` возвращает валидный `ContextPacket` с contentHash, hexagonal-порты готовы к подключению новых адаптеров. Phase 3 заморожена.
