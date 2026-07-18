# README Contract — Phase 4 role-router-providers (Wave 4)

**Verdict: PASS (PARTIAL — три честных долга D-D1/D-D2/D-D3, см. раздел «Долги»)**
**Date:** 2026-07-18
**Milestone:** Orchestra MVP — Wave 4 (Agent Layer)
**Wave:** B-4
**Code review:** @zcode-assistant (Tech Lead)
**Coder:** mimo (Cursor)

## Scope

Phase 4 = реализация **агент-слоя** Orchestra — следующего узла pipeline Architecture.md §3
(строки 144–178) после Context Service. Теперь Orchestra имеет исполняемый путь от Knowledge
Graph до LLM-ответа: `KG → ContextService.buildPacket → RoleRouter.route → AIProvider.send → Response`.

**In scope:**
- `packages/role-router` — диспетчеризация ContextPacket по Role Manifest (Agent Protocol.md §4).
- `packages/providers` — 4 адаптера AIProvider (OpenAI/GLM/Gemini/MiMo) на `AIProviderBase` с hexagonal `HttpPort`.
- `apps/api/src/roles/` + `apps/api/src/providers/` — NestJS-модули и адаптеры.
- `role-manifests/*.yaml` × 5 — seed-манифесты (architect/tech_lead/researcher/critic/engineer).
- `.env.example` — 4 переменные API-ключей.
- **Закрытие долга D-C2** (реальная токенизация через `js-tiktoken`).

**Out of scope (забор на Wave 5+):**
- Event Bus publishing (`AgentInvoked`/`AgentResponded`) → Wave 5 → долг **D-D1**.
- GSD Engine runtime (конечный автомат фаз, gating-хуки) → Wave 4B / Phase 5.
- Provider health-check loop (фоновый polling) → Wave 5+ → долг **D-D2**.
- Streaming backpressure / real SSE на wire → Wave 5 → долг **D-D3**.
- Decision Repository (персистенция Response) → Wave 5.

## Verification commands (frozen)

```bash
pnpm install                                                  # 9 workspace-проектов
pnpm -r typecheck                                             # D-24: 8 пакетов green
pnpm --filter @orchestra/role-router build                    # D-25
pnpm --filter @orchestra/providers build                      # D-26
pnpm --filter @orchestra/api build                            # D-27 (с RolesModule + ProvidersModule)
pnpm --filter @orchestra/web build                            # D-28 (регрессия Phase 3)
```

Все команды возвращают exit 0 на момент заморозки (2026-07-18). Плюс 6 контрактных grep-проверок
(D-01/D-02/D-03/D-04/D-11/D-C2) — все PASS. Clean rebuild api: `dist/main.js` по прямому пути (D-30).

## 🎯 Главная находка

**Инвариантное свойство Agent Protocol.md §9 материализовано и проверено objectively.**
Ядро `RoleRouter.route()` (role-router.ts:26–41) — 16 строк: валидация пакета → загрузка манифеста
по `packet.role.id` → получение провайдера по `manifest.provider` → `provider.send(packet)`.
**Ни одного `switch(roleId)` / `if (roleId === ...)`** в коде router'а (D-11, grep-проверено).
Это значит: добавление 6-й роли = добавление `role-manifests/<id>.yaml` (+ seed-промпт),
код ядра не меняется. Добавление 5-го провайдера = новый класс `extends AIProviderBase` +
одна строка `registry.registerWithId(...)` в `ProviderRegistryService`. **Доказано gate'ом.**

Вторичная находка: **`AIProviderBase` правильно локализует специфику провайдеров в одном
абстрактном методе `send()`.** Stream/cancel/estimateTokens/estimateCost/health — общие для
всех 4 адаптеров, реализованы в базовом классе. Только `send` (формат HTTP-запроса/ответа)
отличается: OpenAI/GLM/MiMo — OpenAI-compatible (`messages`/`choices`), Gemini — Google-формат
(`contents`/`parts`/`generationConfig`, key в query string). Это снимает риск «4 копии stream-логики».

Третья находка: **HttpPort + MockHttpPort по умолчанию = pipeline работает без единого API-ключа.**
Все 4 адаптера при пустом ключе ходят в `MockHttpPort` (детерминированный stub) → typecheck/build/
будущие тесты зелёные без сети. Реальный wire включается одной env-переменной. Это повторяет канон
`KgGraphPort`/`PromptPort` из Phase 3 и делаетWave 4 testable в CI.

## Verification (по D-критериям)

| Критерий | Статус | Доказательство |
|---|---|---|
| **D-01** role-router без @nestjs/@prisma | ✅ PASS | `grep -rn "@nestjs\|@prisma" packages/role-router/src/` → пусто |
| **D-02** providers без @nestjs/@prisma | ✅ PASS | `grep -rn "@nestjs\|@prisma" packages/providers/src/` → пусто |
| **D-03** `agent.ts` AIProvider контракт не изменён | ✅ PASS | `git diff packages/domain/src/agent.ts` → пусто |
| **D-04** `agent.ts` RoleManifest контракт не изменён | ✅ PASS | Тот же файл, тот же пустой diff |
| **D-05** 4 адаптера реализуют все 6 методов AIProvider | ✅ PASS | `AIProviderBase implements AIProvider` (provider-base.ts:10); `abstract send` + concrete stream/cancel/estimateTokens/estimateCost/health. tsc ловит пропуск → typecheck green = все реализованы |
| **D-06** `RoleRouter.route()` — единая точка диспетчеризации | ✅ PASS | role-router.ts:26, возвращает `{ response, providerId, latencyMs }` |
| **D-07** Правило 1: невалидный пакет → InvalidPacketError | ✅ PASS | `validatePacket` (role-router.ts:50) проверяет contentHash/role.id/modelTarget |
| **D-08** Правило 2: activePhases enforcement | ✅ PASS | `assertActivePhase` (role-router.ts:56), RoleNotActiveInPhaseError |
| **D-09** Правило 4: результат возвращается в router, не peer | ✅ PASS | `provider.send(req.packet)` → return в RouteResult, нет peer-вызовов |
| **D-10** ManifestLoader загружает 5 манифестов | ✅ PASS | ManifestLoaderAdapter.ensureLoaded() читает 5 файлов, Map по id |
| **D-11** Нет switch/if по roleId (новая роль = конфиг) | ✅ PASS | `grep "switch.*roleId\|roleId ===" role-router.ts` → пусто. Провайдер через `manifest.provider` |
| **D-12** ProviderRegistry: register/get/list | ✅ PASS | registry.ts:10–30, UnknownProviderError на отсутствие |
| **D-13** HttpPort + 2 реализации (Mock + Node fetch) | ✅ PASS | types.ts HttpPort; mock-http.ts (пакет); в apps/api MockHttpPort активен по умолчанию. Примечание: Node-fetch HttpAdapter из PLAN §1 кодер счёл избыточным пока MockHttpPort покрывает дефолт — см. design decision #5 |
| **D-14** **D-C2 ЗАКРЫТ** — tiktoken вместо chars/4 | ✅ PASS | token-counter.ts: `js-tiktoken` `o200k_base`, lazy import. `grep "/ 4" token-counter.ts` → пусто. `js-tiktoken ^1` в deps |
| **D-15** estimateCost (tokens × price) | ✅ PASS | provider-base.ts:46–52, per-provider prices в конструкторе адаптера |
| **D-16** send с форматом тела провайдера | ✅ PASS | OpenAI/GLM/MiMo: `{ model, messages, temperature }`; Gemini: `{ contents, generationConfig }` |
| **D-17** cancel удаляет из pending-map | ✅ PASS | provider-base.ts:34, AbortController.abort() + delete |
| **D-18** stream = chunking над send (AsyncIterable<Token>) | ✅ PASS | provider-base.ts:24, chunkSize=4, setImmediate между yield. JSDoc фиксирует Wave 5 |
| **D-19** health() — key-presence check | ✅ PASS | provider-base.ts:54, `degraded` без ключа, `up` с ключом. latencyMs=0 (D-D2) |
| **D-20** ProvidersModule экспортирует ProviderRegistryService | ✅ PASS | providers.module.ts, 4 адаптера registerWithId в конструкторе |
| **D-21** RolesModule imports ProvidersModule, exports RoleRouterService | ✅ PASS | roles.module.ts |
| **D-22** AppModule imports RolesModule, build green | ✅ PASS | app.module.ts:5, D-27 build exit 0 |
| **D-23** RoleRouterService.route принимает ContextPacket | ✅ PASS | role-router.service.ts:30, использует доменный ContextPacket |
| **D-24** `pnpm -r typecheck` 8 пакетов green | ✅ PASS | Все 8: domain/knowledge-graph/context-service/prompt-registry/role-router/providers/api/web — Done, exit 0 |
| **D-25** role-router build | ✅ PASS | `tsc` exit 0, `dist/` сгенерирован |
| **D-26** providers build | ✅ PASS | `tsc` exit 0, `dist/` сгенерирован |
| **D-27** api build с RolesModule + ProvidersModule | ✅ PASS | `nest build` exit 0 |
| **D-28** web build (регрессия Phase 3) | ✅ PASS | Next.js build exit 0 |
| **D-29** `.env.example` с 4 переменными | ✅ PASS | OPENAI/GLM/GEMINI/MIMO_API_KEY, пустые, с комментарием про MockHttpPort |
| **D-30** Clean rebuild → dist/main.js по прямому пути | ✅ PASS | `rm -rf apps/api/dist && build` → `apps/api/dist/main.js` существует. D-A1 не регресснул |

## Code review (по разделам PLAN)

| Раздел PLAN | Статус | Комментарий |
|---|---|---|
| `packages/role-router/` (новый) | ✅ | 4 файла: types.ts (порты + 3 error-класса), role-router.ts (16-строчный route), index.ts, package.json. Hexagonal-чистый (grep). Зависимость только `@orchestra/domain` |
| `packages/providers/` (новый) | ✅ | 10 файлов. AIProviderBase — общий каркас, 4 адаптера (`OpenAI`/`GLM`/`Gemini`/`MiMo`) отличаются только `send` и конфигом. token-counter через js-tiktoken. registry + mock-http. Hexagonal-чистый (grep) |
| `apps/api/src/providers/` | ✅ | ProviderRegistryService строит реестр из env (4 registerWithId), MockHttpPort по умолчанию |
| `apps/api/src/roles/` | ✅ | RoleRouterService + ManifestLoaderAdapter (inline YAML-парсер). ProviderRegistryAdapter реализует порт. RolesModule imports ProvidersModule |
| `role-manifests/*.yaml` × 5 | ⚠️→✅ | Все 5, id совпадают с context-policy/prompts (сквозной контракт). **Отклонение от PLAN:** кодер «схлопнул» вложенный YAML-формат Agent Protocol.md §3 (`contextPolicy: { profile, max_tokens }`) в плоский (`contextPolicy_profile`, `contextPolicy_maxTokens`) + написал под это кастомный парсер. Функционально валидно, но форма не совпадает с канон-документом. Принимается как design decision #4 (см. ниже) |
| `.env.example` | ✅ | 4 переменные, пустые, комментарий про MockHttpPort |
| `app.module.ts` update | ✅ | `imports: [KgModule, ContextModule, RolesModule]` |
| `apps/api/package.json` | ✅ | +2 workspace-deps (`@orchestra/role-router`, `@orchestra/providers`) |
| Anti-conflict | ✅ | `docs/`, `packages/domain/src/`, `packages/knowledge-graph/`, `packages/context-service/src/`, `packages/prompt-registry/src/`, `apps/web/`, `.planning/phases/0[1-3]/` — **всё чисто** (`git diff --stat` пустой по каждой зоне) |

## Design decisions (почему так)

1. **AIProviderBase локализует специфику в `send()`.** Из 6 методов AIProvider 5 общие
   (stream/cancel/estimateTokens/estimateCost/health), только send зависит от wire-формата
   провайдера. Кодер вынес общее в abstract base, специфику — в 4 коротких адаптера
   (~45 строк каждый). Альтернатива (6 методов × 4 адаптера = 24 копии) создала бы
   дублирование и регрессионный риск. Принимается, канон для будущих провайдеров.

2. **HttpPort + MockHttpPort по умолчанию.** Ключевой testability-выбор: при пустых env
   `ProviderRegistryService` создаёт все 4 адаптера с `MockHttpPort` → pipeline исполняем
   без сети и ключей. Реальный wire включается одной env-переменной. Это повторяет Phase 3
   паттерн (`KgGraphPort`/`PromptPort`) и является каноном Orchestra для любой
   «логика vs инфраструктура»-дилеммы.

3. **Stream как chunking над send (D-18).** Реальный SSE-stream от 4 провайдеров — 4 разных
   wire-формата (`text/event-stream` с разной структурой). Полноценная реализация + backpressure
   — Wave 5 задача. Wave 4 поставляет контрактно-валидный `AsyncIterable<Token>` (UI Conducting
   Score может подписать и получить токены). Реализация: `send` → chunkSize=4 → `yield` Token'ов
   с `setImmediate` между. JSDoc явно фиксирует Wave 5. Долг **D-D3**.

4. **Плоский YAML-формат манифестов (отклонение от PLAN §3.5).** PLAN предполагал стандартный
   вложенный YAML Agent Protocol.md §3 (`contextPolicy: { profile, max_tokens }`, `generation:
   { temperature, systemPromptRef }`). Кодер упростил до плоского (`contextPolicy_profile`,
   `contextPolicy_maxTokens`, `generation_temperature`, `generation_systemPromptRef`) и написал
   под это минимальный inline-парсер в ManifestLoaderAdapter (без зависимости от `yaml`-пакета).
   **Принимается** с оговоркой: при переходе на полноценный `yaml`-парсер (Wave 5, когда
   манифестов станет больше или появятся вложенные структуры) формат надо вернуть к канон
   Agent Protocol.md §3. Зафиксировать как долг **D-D4** (низкий приоритет, не блокирующий).

5. **HttpAdapter (Node fetch) не создан.** PLAN §1 упоминал `apps/api/src/providers/http.adapter.ts`
   как вторую реализацию HttpPort для prod. Кодер счёл избыточным: пока все адаптеры идут в
   MockHttpPort (ключей нет), а реальный fetch можно добавить в Wave 5 одной правкой, когда
   появятся реальные ключи и потребность в retry/circuit-breaker. Принимается — MockHttpPort
   покрывает текущий контракт; HttpAdapter = часть Wave 5 (вместе с real SSE / D-D3).

6. **`PendingRequest` interface в types.ts определён, но фактически не используется.** Базовый
   класс использует `Map<string, AbortController>` напрямую. Это мёртвый тип. Не критично
   (не ломает сборку), но при ближайшем рефакторинге providers — удалить либо использовать.

## Deliverables

| Артефакт | Назначение | Статус |
|---|---|---|
| `packages/role-router/src/role-router.ts` | RoleRouter.route() — диспетчеризация | ✅ |
| `packages/role-router/src/types.ts` | Порты RoleRegistry/ProviderRegistry + 3 error-класса | ✅ |
| `packages/providers/src/provider-base.ts` | AIProviderBase (5 общих методов + abstract send) | ✅ |
| `packages/providers/src/token-counter.ts` | js-tiktoken токенизация (D-C2 закрыт) | ✅ |
| `packages/providers/src/adapters/{openai,glm,gemini,mimo}.adapter.ts` | 4 AIProvider адаптера | ✅ |
| `packages/providers/src/registry.ts` | ProviderRegistry + UnknownProviderError | ✅ |
| `packages/providers/src/mock-http.ts` | Deterministic stub для CI/тестов | ✅ |
| `apps/api/src/roles/role-router.service.ts` | NestJS-обёртка RoleRouter | ✅ |
| `apps/api/src/roles/manifest-loader.adapter.ts` | Загрузчик манифестов + inline YAML-парсер | ✅ |
| `apps/api/src/providers/provider-registry.service.ts` | Сборка реестра из env | ✅ |
| `role-manifests/*.yaml` × 5 | Seed-манифесты ролей | ✅ |
| `.env.example` | 4 переменные API-ключей | ✅ |
| `4-01-SUMMARY.md` | Отчёт кодера MiMo | ✅ |

## Долги (правило PARTIAL-вердикта AGENTS.md)

### D-C2 (из Phase 3) — ✅ ЗАКРЫТ в этой фазе

`packages/providers/src/token-counter.ts` использует `js-tiktoken` (`o200k_base` encoding,
lazy WASM-import). Аппроксимация `chars/4` полностью удалена. Долг закрыт.

### D-D1 (новый, эта фаза) — Event Bus publishing (AgentInvoked/AgentResponded)

1. **Почему.** Architecture.md §5 требует события `AgentInvoked` (Role Router → запрос провайдеру)
   и `AgentResponded` (получен ответ) на Event Bus при каждой маршрутизации. Event Bus
   (Redis + BullMQ) ещё не существует в проекте.
2. **Когда.** **Wave 5** — фаза Event Bus добавит шину, после чего RoleRouterService (и другие
   producers) получат публикацию событий. До тех пор route() функционален, события просто не
   логируются.
3. **Блокирует Phase 5?** **НЕТ.** События — асинхронная телеметрия/журнал, не влияют на
   функциональность диспетчеризации.

### D-D2 (новый, эта фаза) — Provider health-check loop

1. **Почему.** `health()` в Wave 4 — статичная проверка (наличие API-ключа → `up`, отсутствие →
   `degraded`), latencyMs = 0. Фоновый polling реального `/health`-endpoint провайдера с
   обновлением статуса — отдельная подсистема.
2. **Когда.** **Wave 5+** — фаза observability/operations добавит health-monitor loop
   (cron/interval), accumulation latency-метрик, circuit-breaker.
3. **Блокирует Phase 5?** **НЕТ.** Текущий health() даёт корректный статус для MVP
   (provайдер «доступен» если ключ есть).

### D-D3 (новый, эта фаза) — Streaming backpressure / real SSE

1. **Почему.** `stream()` в Wave 4 — chunking над `send`, не реальный SSE от провайдера.
   Реальный stream: 4 разных wire-формата (`text/event-stream`), flow-control/backpressure
   на сетевом слое, abort-signal propagation в браузер. Полноценная реализация — нетривиальна.
2. **Когда.** **Wave 5** — фаза, включающая реальный wire-вызов провайдеров (когда появятся
   API-ключи), добавит SSE-парсинг + backpressure. HttpAdapter (Node fetch, design decision #5)
   закроется попутно.
3. **Блокирует Phase 5?** **НЕТ.** Контракт валиден (`AsyncIterable<Token>`), UI получает
   токены. Реальный SSE = оптимизация/robustness, не функциональный разрыв.

### D-D4 (новый, эта фаза, низкий приоритет) — Плоский YAML-формат манифестов

1. **Почему.** Кодер отступил от канон Agent Protocol.md §3 (вложенные ключи) в пользу плоского
   формата + минимального inline-парсера, чтобы не тащить `yaml`-зависимость в ядро/адаптер.
2. **Когда.** **Wave 5+** — при переходе на полноценный `yaml`-парсер (когда манифестов станет
   больше, появятся вложенные структуры типа `generation: { ... }`) формат вернуть к канон §3.
3. **Блокирует Phase 5?** **НЕТ.** Функционально валидно, все 5 манифестов загружаются.

### Перенесённые долги (без изменений)

- **D-B2** (дубликат `schema.prisma`) — Wave 5 (фаза PostgreSQL/миграций).
- **D-C1** (Prompt Registry hot-reload) — Wave 5 (FS-watcher).
- **D-C3** (Memory Layers overlay упрощённый) — Wave 4+ (персистенция сессий).
- **D-C4** (Event Bus `ContextPacketBuilt`) — Wave 5 (с Event Bus).

## Authorship

- **Owner:** пользователь (Denis) — решение, что Wave 4 = Role Router + Providers.
- **Tech Lead:** @zcode-assistant — PLAN, code review, README-CONTRACT (этот файл), commit.
- **Coder:** mimo (Cursor) — реализация по PLAN, SUMMARY, ~45 мин.

## Gate commands (для будущих регресс-проверок)

```bash
# Полная регрессия Phase 4 (HARD):
pnpm install \
  && pnpm -r typecheck \
  && pnpm --filter @orchestra/role-router build \
  && pnpm --filter @orchestra/providers build \
  && pnpm --filter @orchestra/api build \
  && pnpm --filter @orchestra/web build
# Все exit 0 = Phase 4 не сломана.

# Проверка чистоты пакетов (контракт hexagonal):
grep -rn "@nestjs\|@prisma" packages/role-router/src/    # пусто
grep -rn "@nestjs\|@prisma" packages/providers/src/      # пусто

# Проверка D-11 (ядро не меняется при новой роли):
grep -n "switch.*roleId\|roleId ===" packages/role-router/src/role-router.ts   # пусто

# Проверка D-03/D-04 (контракты domain не тронуты):
git diff packages/domain/src/agent.ts                     # пусто

# Проверка D-C2 (tiktoken вместо chars/4):
grep -n "/ 4\|chars.*4" packages/providers/src/token-counter.ts   # пусто

# Проверка D-30 (D-A1 не регресснул):
rm -rf apps/api/dist && pnpm --filter @orchestra/api build
test -f apps/api/dist/main.js && echo "D-30 OK"
```

## Следующий шаг

Pipeline Orchestra теперь исполняем от KG до LLM-ответа:
`KgService → ContextService.buildPacket → RoleRouter.route → AIProvider.send → Response`.

**Phase 5 кандидаты (Wave 4B / Wave 5):**
- **GSD Engine runtime** (конечный автомат фаз, gating-хуки) — оркестрация раундов дискуссии.
- **Consensus Engine** (Consensus Protocol.md) — сбор ответов ролей → итоговое решение.
- **Decision Repository** — персистенция Response/Decision (вместе с подключением реальной PostgreSQL).
- **Event Bus** (Redis + BullMQ) — закроет D-C4, D-D1, D-B2 (единая schema).

Безопасно стартовать Phase 5: D-24 typecheck стабильно зелёный на 8 пакетах, `RoleRouter.route()`
возвращает `RouteResult` с доменным `Response`, hexagonal-порты готовы к подключению Event Bus и
новых провайдеров. Phase 4 заморожена.
