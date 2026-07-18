---
phase: 4
slug: 04-role-router-providers
wave: B-4
title: "Role Router + Provider Adapters (Wave 4 старт)"
milestone: "Orchestra MVP — Wave 4 (Agent Layer)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-18
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build, 8 пакетов green)
baseline_before: "Phase 3 заморожена: typecheck 6 пакетов green, context-service/prompt-registry/api/web build green"
depends_on:
  - "Phase 3 (ContextService.buildPacket → ContextPacket готов к диспетчеризации)"
  - "Phase 2 (KgService — не трогать)"
  - "Phase 1 (domain types — расширяем, не ломаем)"
closes_debts:
  - "D-C2 (token compression аппроксимация → реальный estimateTokens в ProviderBase)"
opens_debts_expected:
  - "D-D1: Role Router Event Bus publishing (AgentInvoked/AgentResponded) — Wave 5"
  - "D-D2: Provider health-check loop (background polling) — Wave 5+"
  - "D-D3: streaming backpressure / abort propagation на реальном wire — Wave 5+"
---

# PLAN 4-01 — Role Router + Provider Adapters

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `4-01-SUMMARY.md`. Tech Lead делает code review против `must_haves.truths` ниже.

## 0. Контекст фазы (почему и что)

Phase 3 заморозила сборку **ContextPacket** (18 полей + contentHash, hexagonal-порты `KgGraphPort`/`PromptPort`).
Следующий слой в pipeline Architecture.md §3 (строки 144–178):

```
Role Router ──dispath──> AIProvider.send/stream ──> Response
```

Этой фазой Orchestra получает **исполняемый агент-слой**: декларативные Role Manifest →
Role Router диспетчеризует ContextPacket по реестру AIProvider → провайдер отдаёт `Response`/`Token`-stream.

**Ключевое инвариантное свойство (Agent Protocol.md §2, §9):** ядро не меняется ни при добавлении
новой роли (manifest), ни при добавлении нового провайдера (adapter). Это и есть gate-критерий фазы:
добавление 5-го провайдера и 6-й роли должно быть **конфигом, не кодом ядра**.

### Что закрывает фаза
- `packages/role-router` — реестр манифестов + диспетчеризация (Message Router, Agent Protocol.md §4).
- `packages/providers` — адаптеры AIProvider (OpenAI/GLM/Gemini/MiMo) с честными реализациями send/stream/cancel/estimateTokens/estimateCost/health.
- `apps/api/src/roles/` + `apps/api/src/providers/` — NestJS-адаптеры, инжектирующие провайдеры в Role Router.
- `role-manifests/*.yaml` × 5 — seed-манифесты ролей (architect/tech_lead/researcher/critic/engineer).
- **Закрытие долга D-C2** (реальная токенизация вместо `chars/4` аппроксимации).

### Что НЕ в scope (забор на Wave 5+)
- **Event Bus publishing** (`AgentInvoked`/`AgentResponded`) — Event Bus ещё не существует → долг **D-D1**.
- **GSD Engine runtime** (конечный автомат фаз, gating-хуки) — отдельная фаза Wave 4B (5-01).
- **Provider health-check loop** (фоновый polling `/health` каждого провайдера) → **D-D2**.
- **Streaming backpressure** на реальном сетевом wire (flow-control, abort-signal propagation в
  браузер) → **D-D3**. В этой фазе stream — AsyncIterable<Token> на уровне контракта, реально
  работает send (полный ответ). Stream-метод реализован как враппер над send + chunking (см. §3).
- **Decision Repository** (персистенция Response) → Wave 5.
- **Реальные сетевые вызовы к OpenAI/GLM/Gemini/MiMo** — см. §3 (стратегия: provider-core с
  injectable `HttpPort`, mock-имплементация по умолчанию для typecheck/build/testability без ключей).

---

## 1. Целевая структура (файлы, которые создаёт кодер)

```
packages/
├── role-router/                          # НОВЫЙ ПАКЕТ
│   ├── package.json                      # name: @orchestra/role-router, dep: @orchestra/domain
│   ├── tsconfig.json                     # как у context-service (outDir/rootDir/src)
│   ├── src/
│   │   ├── types.ts                      # RoleRegistryPort, ProviderRegistryPort, RouteRequest, RouteResult
│   │   ├── role-router.ts                # route(req) → RouteResult; валидация пакета + activePhases + deps
│   │   ├── manifest-loader.ts            # загрузка role-manifests/*.yaml → Map<roleId, RoleManifest>
│   │   └── index.ts                      # barrel export
│   └── README.md                         # 5 строк: назначение, порты, что НЕ делает
│
├── providers/                            # НОВЫЙ ПАКЕТ
│   ├── package.json                      # name: @orchestra/providers, dep: @orchestra/domain
│   ├── tsconfig.json
│   ├── src/
│   │   ├── types.ts                      # HttpPort, ProviderConfig, PendingRequest (для cancel)
│   │   ├── token-counter.ts              # РЕАЛЬНАЯ токенизация (закрытие D-C2)
│   │   ├── provider-base.ts              # AIProviderBase: реализует send/stream/cancel/estimateTokens/estimateCost/health поверх HttpPort
│   │   ├── adapters/
│   │   │   ├── openai.adapter.ts         # id='openai', endpoint/path/format по OpenAI Chat Completions
│   │   │   ├── glm.adapter.ts            # id='glm', Z.AI endpoint
│   │   │   ├── gemini.adapter.ts         # id='gemini', Google GenerateContent
│   │   │   └── mimo.adapter.ts           # id='mimo', generic OpenAI-compatible
│   │   ├── registry.ts                   # ProviderRegistry: Map<id, AIProvider>, register/get/list
│   │   ├── mock-http.ts                  # MockHttpPort: deterministic stub для тестов/CI без ключей
│   │   └── index.ts                      # barrel
│   └── README.md
│
apps/api/src/
├── roles/                                # НОВЫЙ NestJS-модуль
│   ├── roles.module.ts                   # imports ProvidersModule, exports RoleRouterService
│   ├── manifest-loader.adapter.ts        # RoleRegistryPort impl: читает ../../role-manifests/*.yaml
│   └── role-router.service.ts            # RoleRouterService: NestJS-обёртка над role-router.route()
│
├── providers/                            # НОВЫЙ NestJS-модуль
│   ├── providers.module.ts               # providers: [ProviderRegistryService], exports: [ProviderRegistryService]
│   ├── provider-registry.service.ts      # ProviderRegistryService: строит ProviderRegistry из .env + MockHttpPort по умолчанию
│   └── http.adapter.ts                   # HttpAdapter: Node fetch-based impl HttpPort (для prod)
│
app.module.ts                             # ИЗМЕНИТЬ: imports += RolesModule (внутри уже ProvidersModule)

role-manifests/                           # НОВЫЙ корневой каталог (как prompts/)
├── architect.yaml                        # 5 seed-манифестов по схеме Agent Protocol.md §3
├── tech_lead.yaml
├── researcher.yaml
├── critic.yaml
├── engineer.yaml

.env.example                              # НОВЫЙ: OPENAI_API_KEY=, GLM_API_KEY=, GEMINI_API_KEY=, MIMO_API_KEY= (пустые, для док-ва)
```

### Файлы, которые НЕ трогать (anti-conflict)

| Зона | Почему не трогать |
|---|---|
| `docs/**` | Канон-документация. Кодер только читает. |
| `packages/domain/src/**` | Контракты (`RoleManifest`, `AIProvider`, `Response`, `Token`, `ProviderHealth`, `ContextPacket`) **уже определены** в Phase 1. Фаза 4 их потребляет, не переопределяет. Если не хватает поля — НЕ дополнять самовольно, остановиться и доложить (это был бы breach контракта Phase 1). |
| `packages/knowledge-graph/**` | Phase 2 territory. |
| `packages/context-service/src/**` | Phase 3 territory. Только читаем `buildPacket`. |
| `packages/prompt-registry/src/**` | Phase 3 territory. |
| `apps/api/src/kg/**`, `apps/api/src/context/**`, `apps/api/src/prompts/**` | Phase 2/3 адаптеры. |
| `apps/web/**` | Phase 1. Регрессия только. |
| `.planning/phases/0[1-3]-*/**` | Замороженные фазы. |
| `scripts/gate-*` | Не существует (это не RAI_EP gate-модель). |

---

## 2. must_haves.truths (D-критерии — по ним code review)

Каждый D — **проверяемый факт**. Кодер обязан обеспечить каждый. Tech Lead сверяет по коду + build.

### Архитектура / контракты

- **D-01** Пакет `@orchestra/role-router` НЕ зависит от `@nestjs/*` и `@prisma/*`. Проверка:
  `grep -rn "@nestjs\|@prisma" packages/role-router/src/` → пусто (exit 1). Hexagonal-чистота.

- **D-02** Пакет `@orchestra/providers` НЕ зависит от `@nestjs/*` и `@prisma/*`. Проверка:
  `grep -rn "@nestjs\|@prisma" packages/providers/src/` → пусто (exit 1).

- **D-03** Контракт `AIProvider` (domain/agent.ts) **не изменён**. Проверка:
  `git diff packages/domain/src/agent.ts` → пусто. Кодер реализует интерфейс, не дополняет.

- **D-04** Контракт `RoleManifest` (domain/agent.ts) **не изменён**. Проверка:
  `git diff packages/domain/src/agent.ts` → пусто (тот же файл, проверяется вместе с D-03).

- **D-05** Все 4 адаптера (`openai`/`glm`/`gemini`/`mimo`) реализуют `AIProvider` полностью —
  все 6 методов (`send`, `stream`, `cancel`, `estimateTokens`, `estimateCost`, `health`).
  Проверка: `tsc` требует реализации интерфейса → typecheck ловит пропуск.

### Role Router

- **D-06** `role-router.route(req: RouteRequest): Promise<RouteResult>` — единая точка
  диспетчеризации. Принимает `{ packet: ContextPacket, dependencies?: Response[] }`,
  возвращает `{ response: Response, providerId: string, latencyMs: number }`.

- **D-07** **Правило маршрутизации 1** (Agent Protocol.md §4): если `packet` невалиден
  (нет `contentHash` / нет `role.id` / нет `modelTarget`) → `route()` бросает
  `InvalidPacketError` с указанием недостающего поля. НЕ вызывает провайдера.

- **D-08** **Правило маршрутизации 2**: если у манифеста роли задан `activePhases` и
  `packet.phase` не входит в список → `route()` бросает `RoleNotActiveInPhaseError`.
  Если `activePhases` не задан — роль активна во всех фазах.

- **D-09** **Правило маршрутизации 4**: результат агента возвращается из `route()` в виде
  `Response`, **не** вызывает напрямую другие роли. Никакого peer-to-peer внутри router'а.

- **D-10** `ManifestLoader.load(dir: string): Promise<Map<string, RoleManifest>>` читает
  `*.yaml` из каталога, парсит, возвращает Map по `manifest.id`. 5 seed-манифестов загружаются.

- **D-11** Добавление 6-й роли = **добавление `role-manifests/<role>.yaml`** + (опц.) seed-промпт.
  Код `role-router.ts` при этом **не меняется**. Доказать: в `route()` нет `switch(roleId)` /
  `if (roleId === ...)`. Идентификация провайдера идёт через `manifest.provider` → registry.

### Providers

- **D-12** `ProviderRegistry` — `register(provider: AIProvider)`, `get(id: string): AIProvider`,
  `list(): string[]`. Реестр — Map. Получение несуществующего id → `UnknownProviderError`.

- **D-13** **HttpPort** (hexagonal): `post(url, headers, body): Promise<{ status, json, text }>`.
  Реализован в `apps/api/src/providers/http.adapter.ts` (Node `fetch`), и в
  `packages/providers/src/mock-http.ts` (deterministic stub). Provider-core зависит только от порта.

- **D-14** **D-C2 ЗАКРЫТ**: `token-counter.ts` считает токены через **реальный алгоритм**
  (tiktoken-wasm `gpt-4o` encoding ИЛИ `js-tiktoken` пакет), а не `chars/4`. Проверка:
  `grep -n "chars.*4\|/ 4\|/4" packages/providers/src/token-counter.ts` → пусто. Пакет
  `js-tiktoken` (или `tiktoken`) добавлен в `packages/providers/package.json` dependencies.

- **D-15** `estimateCost(packet)` для каждого провайдера возвращает число (USD за запрос):
  `tokens × pricePerToken`. Цена за 1K input/output токенов — константа адаптера
  (например `OPENAI_PRICES = { input: 0.0025, output: 0.01 }` в центах × 0.01 → USD).
  Допускается аппроксимация цен (зафиксировать в комментарии + обновлять Wave 5).

- **D-16** `send(packet)` вызывает HttpPort с телом запроса в формате провайдера
  (OpenAI: `{ model, messages, temperature }`; Gemini: `{ contents, generationConfig }`).
  Request-id генерируется (`crypto.randomUUID()`), сохраняется в `PendingRequest`-map для `cancel`.

- **D-17** `cancel(requestId)` удаляет запрос из pending-map. На уровне контракта —
  обещание «больше не писать в stream / не досылать». Полный abort на wire — Wave 5 (D-D3).

- **D-18** `stream(packet)` — `AsyncIterable<Token>`. Реализация Wave 4: вызывает `send`,
  разбивает `response.content` на чанки фиксированного размера (например по 4 символа) с
  `yield` и `await new Promise(r => setImmediate(r))` между чанками. Это валидный stream
  на уровне контракта (AsyncIterable<Token>), достаточно для UI Conducting Score MVP.
  Реальный SSE-stream от провайдера — Wave 5. Зафиксировать в JSDoc.

- **D-19** `health()` для каждого провайдера возвращает `ProviderHealth` со статусом
  `up|degraded|down`. Реализация Wave 4: проверяет наличие API-key в env для провайдера
  (если ключ есть → `up`, нет → `degraded`), latencyMs = 0 (нет реального пинга → D-D2).

### NestJS-интеграция

- **D-20** `ProvidersModule` экспортирует `ProviderRegistryService`. Сервис в конструкторе
  строит `ProviderRegistry`, регистрирует 4 адаптера. HttpPort = `MockHttpPort` если
  соответствующий `*_API_KEY` не задан в env, иначе `HttpAdapter` (Node fetch).

- **D-21** `RolesModule` импортирует `ProvidersModule`, экспортирует `RoleRouterService`.
  Сервис в конструкторе: загружает манифесты через `ManifestLoaderAdapter`, создаёт
  `RoleRouter`, держит ссылку на registry из `ProvidersModule`.

- **D-22** `AppModule` imports `RolesModule` (вместе с существующими KgModule, ContextModule).
  Build проходит: `nest build` exit 0.

- **D-23** `RoleRouterService.route(req: BuildRouteRequest)` принимает `{ packet,
  dependencies? }`, где packet — результат `ContextService.buildPacket()`. Это сквозной
  pipeline: KG → Context → Router → Provider. Никаких дублирующих типов: используется
  доменный `ContextPacket`.

### Build / регрессия

- **D-24** `pnpm -r typecheck` зелёный во всех **8 пакетах** (domain, knowledge-graph,
  context-service, prompt-registry, role-router, providers, api, web).

- **D-25** `pnpm --filter @orchestra/role-router build` exit 0, `dist/` сгенерирован.

- **D-26** `pnpm --filter @orchestra/providers build` exit 0, `dist/` сгенерирован.

- **D-27** `pnpm --filter @orchestra/api build` exit 0 (с RolesModule + ProvidersModule).

- **D-28** Регрессия Phase 3: `pnpm --filter @orchestra/web build` exit 0. Web не тронут.

- **D-29** `.env.example` создан, содержит 4 переменные провайдеров (значения пустые).

- **D-30** Clean rebuild `@orchestra/api`: `rm -rf apps/api/dist && build` →
  `apps/api/dist/main.js` существует по прямому пути (D-A1 не регресснул).

---

## 3. Технические решения (почему так — фиксированные design decisions)

### 3.1. HttpPort вместо прямого fetch в адаптерах

Контракт `AIProvider.send` асинхронный, но домен НЕ знает про `fetch`/`http`. Если адаптер
напрямую вызовет `fetch`, он утянет сетевую зависимость в ядро, и:
- нельзя будет тестировать без сети / моков;
- CI без API-ключей будет красным;
- добавление retry/circuit-breaker потребует правки каждого адаптера.

Решение: порт `HttpPort` в `providers/src/types.ts`, реализуется дважды — `MockHttpPort`
(пакет, deterministic) и `HttpAdapter` (apps/api, Node fetch). Каждый адаптер принимает
`HttpPort` в конструкторе. **MockHttpPort по умолчанию** = фаза билдится/проверяется без
ключей; реальный wire включается env-переменными. Это повторяет паттерн `KgGraphPort`/`PromptPort`
из Phase 3 — канон Orchestra для «логика vs инфраструктура».

### 3.2. Stream как chunking над send

Реальный SSE-stream от OpenAI/GLM/Gemini — это 4 разных wire-формата (`text/event-stream`
с разной структурой chunks). Полноценная реализация на 4 провайдера — это Wave 5 задача
с своими обратными совместимостями и backpressure. В Wave 4 мы поставляем **контрактно-валидный
stream**: AsyncIterable<Token>, который UI может подписать и получить токены.
Реализация: `send` → разбить content → yield Token'ов. Это:
- даёт UI то, что ему нужно (поток токенов для Conducting Score);
- держит typecheck/build/testability зелёным без сети;
- изолирует D-D3 (реальный stream + backpressure) как отдельный, scoped долг.

JSDoc на `stream()` обязан это зафиксировать: «Wave 4 stub over send; real SSE = Wave 5 (D-D3)».

### 3.3. Токенизация через js-tiktoken

Долг D-C2 — «аппроксимация chars/4 вместо реальной токенизации». Закрываем: пакет
[`js-tiktoken`](https://www.npmjs.com/package/js-tiktoken) (WASM-порт tiktoken,
работает в Node и браузере без native-build). Encoding `gpt-4o` (`o200k_base`) —
дефолт для OpenAI/GLM/MiMo (OpenAI-compatible). Для Gemini — tiktoken-аппроксимация
с пометкой (Google использует SentencePiece, точный счётчик — Wave 5).

`token-counter.ts` экспортирует `countTokens(text, encoding?): number`. Lazy-load WASM
через `await import('js-tiktoken')` (не тащить в cold-start). Кэш encoder'а на module level.

### 3.4. role-manifests/ как корневой каталог (как prompts/)

Манифесты ролей — данные, не код. По аналогии с `prompts/` (Phase 3) — отдельный корневой
каталог `role-manifests/*.yaml`. Manifest-loader в `apps/api` резолвит через
`resolve(cwd, '../../role-manifests')`. Формат — YAML (как в Agent Protocol.md §3), парсинг
через `yaml` пакет (добавить в deps `apps/api` или в `@orchestra/role-router`).

> **Вопрос кодеру:** `yaml`-парсер — положить в `@orchestra/role-router` (тогда ядро пакета
> зависит от `yaml`) или в `apps/api/src/roles/manifest-loader.adapter.ts` (тогда ядро
> работает с предзагруженным `Map`, а парсинг — инфраструктура)? **Решение Tech Lead:**
> парсер в адаптере. Ядро `role-router` принимает `Map<string, RoleManifest>` от порта
> `RoleRegistryPort`. Это сохраняет D-01 (ядро без runtime-deps кроме domain). Кодер следует.

### 3.5. Названия ролей в манифестах vs. context-policy

Context-policy (Phase 3, `DEFAULT_POLICIES`) использует 5 ключей: `architect`/`tech_lead`/
`researcher`/`critic`/`engineer`. Manifests обязаны использовать **те же** `id` — иначе
ContextService не найдёт политику для роли при сборке пакета. Это сквозной контракт:
roleId в context-policy == manifest.id == prompts/<id>.md == role-manifests/<id>.yaml.
Кодер обязан использовать ровно эти 5 id.

---

## 4. Примеры интерфейсов (направляющий код — НЕ копировать вслепую)

> Кодер пишет реальный код. Ниже — сигнатуры для устранения неоднозначностей. Имена и
> идиомы — как в существующих пакетах (см. `context-service/src/types.ts`).

```typescript
// packages/role-router/src/types.ts
import type { ContextPacket, Response, RoleManifest } from '@orchestra/domain';

/** Реестр манифестов ролей (hexagonal port). */
export interface RoleRegistryPort {
  get(roleId: string): Promise<RoleManifest | null>;
  list(): Promise<string[]>;
}

/** Реестр AIProvider (hexagonal port). */
export interface ProviderRegistryPort {
  get(providerId: string): Promise<AIProvider>;
  list(): Promise<string[]>;
}

export interface RouteRequest {
  packet: ContextPacket;
  dependencies?: Response[];   // ответы, которые должны быть получены раньше (правило 3)
}

export interface RouteResult {
  response: Response;
  providerId: string;
  latencyMs: number;
}
```

```typescript
// packages/role-router/src/role-router.ts
export class RoleRouter {
  constructor(
    private readonly roles: RoleRegistryPort,
    private readonly providers: ProviderRegistryPort,
  ) {}

  async route(req: RouteRequest): Promise<RouteResult> {
    validatePacket(req.packet);                       // D-07
    const manifest = await this.requireManifest(req.packet.role.id);
    assertActivePhase(manifest, req.packet.phase);     // D-08
    const provider = await this.providers.get(manifest.provider);  // D-11 (no switch on role)
    const started = Date.now();
    const response = await provider.send(req.packet);  // D-09 (returns to router, not peer)
    return { response, providerId: manifest.provider, latencyMs: Date.now() - started };
  }
}
```

```typescript
// packages/providers/src/types.ts
export interface HttpPort {
  post(url: string, headers: Record<string, string>, body: unknown): Promise<HttpResponse>;
}
export interface HttpResponse {
  status: number;
  json: unknown;
  text: string;
}
export interface ProviderConfig {
  id: string;             // 'openai' | 'glm' | 'gemini' | 'mimo'
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  prices: { inputPer1K: number; outputPer1K: number };  // USD
}
```

```typescript
// packages/providers/src/provider-base.ts — общий каркас для 4 адаптеров
export abstract class AIProviderBase implements AIProvider {
  protected pending = new Map<string, AbortController>();  // для cancel (D-17)
  constructor(protected readonly http: HttpPort, protected readonly cfg: ProviderConfig) {}

  abstract send(packet: ContextPacket): Promise<Response>;  // формат запроса = специфика адаптера
  async *stream(packet: ContextPacket): AsyncIterable<Token> { /* D-18: chunking over send */ }
  async cancel(requestId: string): Promise<void> { /* D-17 */ }
  async estimateTokens(packet: ContextPacket): Promise<number> { return countTokens(packet.systemPrompt + packet.objective); }  // D-14
  async estimateCost(packet: ContextPacket): Promise<number> { /* D-15: tokens × price */ }
  async health(): Promise<ProviderHealth> { /* D-19 */ }
}
```

```yaml
# role-manifests/architect.yaml — формат Agent Protocol.md §3
id: architect
displayName: Chief Architect
provider: openai
model: gpt-4o
responsibilities: [architecture, strategy, decomposition]
allowedOutputs: [ADR, Architecture, Review]
contextPolicy:
  profile: architect
  max_tokens: 32000
generation:
  temperature: 0.2
  systemPromptRef: prompts/architect.md
activePhases: [Goal, Specification, Architecture, Review]
```

> **Внимание кодеру:** `model` в манифестах — реальные идентификаторы моделей
> (`gpt-4o`, `glm-4-plus`, `gemini-1.5-pro`, `mimo-7b` и т.п.). В `.env.example` оставить
> переменные ключей пустыми. В коде адаптера — если apiKey пустой, `send` возвращает
> MockHttpPort-ответ (детерминированный), что позволяет pipeline работать без ключей.

---

## 5. Success criteria / «не готово, когда»

### Фаза PASS, если:
- Все D-01..D-30 зелёные по code review + build gate.
- `pnpm -r typecheck && pnpm -r build` — exit 0 на 8 пакетах.
- Anti-conflict: `git diff --stat docs/ packages/domain/src/ packages/knowledge-graph/ packages/context-service/src/ apps/web/` → пусто.
- D-C2 закрыт (tiktoken вместо chars/4).

### Фаза FAIL, если:
- Любой из D-01/D-02 (hexagonal-чистота) нарушен — `@nestjs`/`@prisma` в новых пакетах.
- D-03/D-04 нарушен — кодер изменил `packages/domain/src/agent.ts` без явного Tech Lead-решения.
- D-11 нарушен — в router'е есть switch/if по roleId (ядро меняется при новой роли).
- D-14 не закрыт — токенизация осталась chars/4.
- D-24 (typecheck 8 пакетов) или D-27 (api build) красные.

### Фаза PARTIAL допустима, если:
- Один из D-15 (estimateCost) / D-19 (health) реализован упрощённо с честным долгом D-D*.
- Парсинг YAML в адаптере вынесен, но `js-tiktoken` добавить не удалось (бранч/npm-проблема)
  → D-C2 переносится (но тогда D-C2 в README-CONTRACT обязан быть с трёхпунктовым объяснением).

---

## 6. Порядок работы кодера (рекомендуемый)

1. Создать 2 пакета (`packages/role-router`, `packages/providers`) со скелетом package.json/tsconfig
   по образцу `packages/context-service`.
2. Реализовать `@orchestra/providers` сначала: types.ts → token-counter.ts → provider-base.ts →
   4 адаптера → registry.ts → mock-http.ts → index.ts.
3. Реализовать `@orchestra/role-router`: types.ts → role-router.ts → index.ts
   (manifest-loader оставить в apps/api адаптере по design decision 3.4).
4. NestJS-слой: providers/ → roles/ → app.module.ts update.
5. Seed-манифесты × 5 в `role-manifests/`.
6. `.env.example`.
7. Прогнать все D-критерии локально, написать `4-01-SUMMARY.md`.

**Build-проверка перед SUMMARY:**
```bash
pnpm install
pnpm -r typecheck            # 8 пакетов green
pnpm --filter @orchestra/role-router build
pnpm --filter @orchestra/providers build
pnpm --filter @orchestra/api build
pnpm --filter @orchestra/web build   # регрессия
```

---

## 7. Verification gate (заморожен для README-CONTRACT)

```bash
pnpm install                                                  # 8 пакетов workspace
pnpm -r typecheck                                             # D-24: 8 пакетов green
pnpm --filter @orchestra/role-router build                    # D-25
pnpm --filter @orchestra/providers build                      # D-26
pnpm --filter @orchestra/api build                            # D-27 (с RolesModule)
pnpm --filter @orchestra/web build                            # D-28 (регрессия Phase 3)

# Контрактные проверки (Tech Lead):
grep -rn "@nestjs\|@prisma" packages/role-router/src/         # D-01: пусто (exit 1)
grep -rn "@nestjs\|@prisma" packages/providers/src/           # D-02: пусто (exit 1)
git diff packages/domain/src/agent.ts                         # D-03/D-04: пусто
grep -rn "switch.*roleId\|roleId ===" packages/role-router/src/role-router.ts  # D-11: пусто
grep -n "chars.*4\|/ 4\|/4" packages/providers/src/token-counter.ts            # D-C2: пусто
rm -rf apps/api/dist && pnpm --filter @orchestra/api build && test -f apps/api/dist/main.js && echo "D-30 OK"
```

Все команды возвращают exit 0 на моменте заморозки = фаза PASS.

---

## 8. Долги, которые фаза открывает (явно, для README-CONTRACT)

| Долг | Почему | Когда закроется | Блокирует следующую фазу? |
|---|---|---|---|
| **D-D1** Event Bus publishing (`AgentInvoked`/`AgentResponded`) | Event Bus (Redis+BullMQ) не существует | Wave 5 (фаза Event Bus) | НЕТ — асинхронная телеметрия, не влияет на route() |
| **D-D2** Provider health-check loop (фоновый polling) | Wave 4 health() — статичный (key-presence check) | Wave 5+ | НЕТ — текущий health() даёт статус, без latency-monitoring |
| **D-D3** Streaming backpressure / real SSE | Wave 4 stream = chunking над send | Wave 5 | НЕТ — контракт валиден, UI получает токены |

Долг **D-C2** (token compression аппроксимация) — **закрывается в этой фазе** (D-14).

Долг **D-B2** (дубликат schema.prisma) — переносится дальше без изменений (Wave 5).
Долги **D-C1** (hot-reload), **D-C3** (Memory Layers), **D-C4** (Event Bus ContextPacketBuilt) —
переносятся без изменений в свои запланированные волны.

---

## 9. Authorship

- **Owner:** пользователь (Denis) — решение, что Wave 4 = Role Router + Providers.
- **Tech Lead:** zcode — PLAN (этот файл), последующий code review, README-CONTRACT.
- **Coder:** mimo (Cursor) — реализация по PLAN, `4-01-SUMMARY.md`.
