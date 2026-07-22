---
phase: 9
slug: 09-real-llm-integration
wave: "Wave 9 — Real LLM Integration"
title: "FetchHttpPort — реальный HTTP для AIProvider адаптеров, Orchestra становится живой (mock-endpoint verification)"
milestone: "Orchestra MVP — Wave 9 (Real LLM Integration)"
coder: mimo (Cursor) / zcode (self-execute fallback)
tech_lead: zcode (ZCode)
date: 2026-07-22
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build) + runtime-gate (live: mock LLM stub-server → create session → round → advance → реальные-формата LLM ответы через Consensus) + regression-gate (Phase 5/6/7/8/8b/8c/8d spec'и green)
baseline_before: "Wave 8d PASS (commit eb9a3ac): Persistence layer готов. Orchestra backend production-ready. НО провайдеры используют MockHttpPort (возвращает '[Mock response]' на любой запрос). Адаптеры (OpenAI/GLM/Gemini/MiMo) полностью реализованы (Phase 4), 5 ролей в YAML manifests, role-router работает. Единственное что нужно — HttpPort impl с реальным HTTP."
depends_on:
  - "Phase 4 — OpenAIAdapter/GLMAdapter/GeminiAdapter/MiMoAdapter (полностью реализованы)"
  - "Phase 3 — ContextService.buildPacket (формирует ContextPacket для LLM)"
  - "Phase 5 — ConsensusEngine (обрабатывает responses)"
  - "Phase 7 — RoundOrchestratorGatingAdapter (оркестрирует round)"
closes_debts:
  - "Stub-gating era заканчивается — реальные HTTP запросы к LLM провайдерам (или mock endpoint для dev)."
  - "Orchestra становится живой — реальные ответы агентов, Consensus на реальном контенте."
  : "Открывает дорогу для: Confidence gauges (D-8b-3), Conducting Score дорожки (D-8b-5), Decision Repository с реальным контентом (D-8d-2-2)."
opens_debts_expected:
  - "D-9-1: Real API keys для всех 4 провайдеров (OpenAI/GLM/Gemini/MiMo) — когда owner готов использовать реальные LLM."
  - "D-9-2: Streaming SSE от провайдера (сейчас send() ждёт полный ответ) — Wave 9+ для UI Canon §8."
  - "D-9-3: Error handling для LLM failures (timeout, rate limit, 500) — сейчас basic try/catch."
  - "D-9-4: Token/cost tracking persistence — сейчас estimateTokens/estimateCost in-memory."
  - "D-9-5: Provider fallback (если openai down → использовать glm) — сейчас no fallback."
---

# PLAN 9-1 — FetchHttpPort: реальный HTTP для LLM провайдеров

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `9-1-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **EVIDENCE-RULE (УСИЛЕННЫЙ, доказан 5 раз):** для каждого runtime-D — точный evidence.
> Главный D-16: mock LLM stub-server → advance → реальные-format ответы в RoundStarted events.
>
> **ПРОЦЕСС-НОТА:** Если кодер зависает на PowerShell runtime-тестах (8d-1 precedent),
> owner может санкционировать self-execute (техлид верифицирует через Git Bash).

## 0. Контекст

### 0.1. Что есть сейчас

**Phase 4 (PASS, `257a624`)**: 4 AIProvider адаптера полностью реализованы:
- `OpenAIAdapter` — POST к `api.openai.com/v1/chat/completions`, парсит `choices[0].message.content`.
- `GLMAdapter` — POST к GLM API.
- `GeminiAdapter` — POST к Gemini API.
- `MiMoAdapter` — POST к MiMo API.

Все адаптеры extends `AIProviderBase`, используют `HttpPort` interface для network abstraction:
```typescript
export interface HttpPort {
  post(url: string, headers: Record<string, string>, body: unknown): Promise<HttpResponse>;
}
```

**Проблема:** `ProviderRegistryService` (apps/api/src/providers/provider-registry.service.ts)
создаёт адаптеры с **`MockHttpPort`**:
```typescript
const http = new MockHttpPort();
this.registry.registerWithId('openai', new OpenAIAdapter(http, openaiKey));
```
`MockHttpPort.post()` возвращает детерминированный stub: `'[Mock response] This is a deterministic stub from MockHttpPort.'`.

→ RoundOrchestratorGatingAdapter → RoleRouter → provider.send() → **всегда получает mock ответ**.
Consensus Engine кластеризует mock-ответы. Decision Repository пустой (нет реального контента).

### 0.2. Что делает Phase 9-1

**FetchHttpPort — реальный HTTP impl.** Заменяет MockHttpPort в ProviderRegistryService.

- ✅ `FetchHttpPort implements HttpPort` — `post()` через `fetch()` (native Node 18+).
- ✅ `ProviderRegistryService` — DI `FetchHttpPort` вместо `new MockHttpPort()`.
- ✅ Env-driven: `OPENAI_API_KEY`, `GLM_API_KEY`, `GEMINI_API_KEY`, `MIMO_API_KEY` (если нет —
  empty string, adapter.health() вернёт 'degraded').
- ✅ **Mock stub-server для verification** — локальный HTTP сервер, имитирующий OpenAI API
  (возвращает `{choices:[{message:{content:"..."}}]}`), используется для runtime verification
  без затрат на реальные API calls.
- ✅ `.env.example` документирует все 4 API keys.

**НЕ в scope (забор на Wave 9+):**
- **Streaming SSE** — сейчас `send()` ждёт полный ответ. Streaming — Wave 9+ (D-9-2).
- **Provider fallback** — если openai down → glm. Wave 9+ (D-9-5).
- **Token/cost persistence** — сейчас in-memory estimate. Wave 9+ (D-9-4).
- **Real API key testing** — owner использует mock endpoint для verification. Real keys — когда
  готов (D-9-1).

### 0.3. Архитектурное решение: FetchHttpPort в apps/api (не в packages/)

**Выбор:** `FetchHttpPort` в `apps/api/src/providers/fetch-http.ts`.

**Обоснование:**
- `HttpPort` interface — в `packages/providers/src/types.ts` (Phase 4, hexagonal port).
- `FetchHttpPort` — **adapter** (impl), живёт в app layer (apps/api). Не в packages (domain-чистый).
- Соответствует pattern: SessionStorePort (package) → PrismaSessionStore (app), EventPublisherPort
  (package) → RedisEventPublisher (app), HttpPort (package) → FetchHttpPort (app).

> MockHttpPort остаётся в packages/providers для testing (unit-тесты пакетов используют его).
> Apps/api использует FetchHttpPort для production.

### 0.4. Mock stub-server для verification

Для runtime verification без затрат на реальные API calls — **локальный HTTP stub-server**:

```javascript
// .planning/_scratch/mock-llm-server.mjs (ВРЕМЕННЫЙ, не в продакшн)
import { createServer } from 'node:http';
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    choices: [{ message: { content: `Mock LLM response for ${req.url}` } }],
  }));
});
server.listen(8088, () => console.log('Mock LLM server on :8088'));
```

Adapter указывает на `http://localhost:8088` (через `OPENAI_BASE_URL` env override или directly
в ProviderRegistryService config). Verification: POST /sessions → round → advance → проверяем
что Consensus получил responses с content из mock server (не '[Mock response]').

### 0.5. Что НЕ меняется

- `packages/**` — НЕ ТРОГАТЬ (D-21). Адаптеры, HttpPort interface, MockHttpPort — всё готово.
- `apps/api/src/{sessions,gsd,kg,context,roles,consensus,prompts,event-bus,events,prisma.service,main,app.module}.ts`:
  изменения ТОЛЬКО в `providers/`.
- `apps/api/src/gsd/**` — НЕ ТРОГАТЬ (Phase 6/7/8d-2).
- `apps/web/**` — НЕ ТРОГАТЬ.
- `role-manifests/`, `prompts/` — НЕ ТРОГАТЬ.
- `docker-compose.yml`, Prisma schema — НЕ ТРОГАТЬ.

---

## 1. Архитектура

### 1.1. Структура файлов

```
apps/api/src/providers/
├── fetch-http.ts                      # НОВЫЙ: FetchHttpPort implements HttpPort
├── provider-registry.service.ts       # ИЗМЕНИТЬ: FetchHttpPort вместо MockHttpPort
└── providers.module.ts                # без изменений (если есть) или проверить wiring

apps/api/.env.example                  # ИЗМЕНИТЬ: +4 API keys + base URL overrides
```

### 1.2. Полный поток после Phase 9-1

```
POST /sessions/:id/advance
  ↓
RoundOrchestratorGatingAdapter.evaluate
  ↓ для каждой роли (architect, tech_lead, researcher, critic, engineer):
  ↓
ContextService.buildPacket(roleId) → ContextPacket
  ↓
RoleRouter.route(packet) → provider.send(packet)
  ↓
OpenAIAdapter.send(packet)
  ↓ this.http.post(url, headers, body)    ← HttpPort
  ↓
FetchHttpPort.post(url, headers, body)    ← НОВОЕ (вместо MockHttpPort)
  ↓ fetch(url, {method:'POST', headers, body: JSON.stringify(body)})
  ↓
LLM Provider (api.openai.com или mock stub-server :8088)
  ↓ {choices:[{message:{content:"Real LLM response..."}}]}
  ↓
Response {requestId, content, finishReason}
  ↓
Consensus.run(responses) → ConsensusReport
  ↓
GatingResult {verdict, gaps, phase}
```

### 1.3. `fetch-http.ts` — НОВЫЙ

```typescript
import { Injectable, Logger } from '@nestjs/common';
import type { HttpPort, HttpResponse } from '@orchestra/providers';

/**
 * Реальный HTTP impl of HttpPort через native fetch (Node 18+).
 *
 * Заменяет MockHttpPort в production. Адаптеры (OpenAI/GLM/Gemini/MiMo) используют этот port
 * для сетевых запросов к LLM API.
 *
 * Error handling: при network error (timeout, DNS, connection refused) — выбрасывает Error
 * с понятным сообщением. Adapter ловит и возвращает Response с finishReason 'error'.
 *
 * Timeout: 30 секунд (override через LLM_TIMEOUT_MS env). LLM responses могут быть медленными,
 * 30 сек — разумный default. Production tuning — Wave 9+.
 */
@Injectable()
export class FetchHttpPort implements HttpPort {
  private readonly logger = new Logger(FetchHttpPort.name);
  private readonly timeoutMs: number;

  constructor() {
    this.timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30000);
  }

  async post(url: string, headers: Record<string, string>, body: unknown): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'User-Agent': 'Orchestra/1.0' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!res.ok) {
        this.logger.error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
      }

      return { status: res.status, json, text };
    } catch (e) {
      const msg = (e as Error).name === 'AbortError'
        ? `Request timeout after ${this.timeoutMs}ms: ${url}`
        : `Network error: ${(e as Error).message}`;
      this.logger.error(msg);
      throw new Error(msg);
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

**Ключевые моменты:**
- `fetch()` — native Node 18+ (Orchestra использует Node 20+).
- `AbortController` + `setTimeout` — **timeout handling** (30s default, env override).
- JSON parse с fallback (если LLM возвращает non-JSON error).
- Error logging на HTTP errors (4xx/5xx) и network errors.
- `User-Agent: Orchestra/1.0` — для API provider identification.

### 1.4. `provider-registry.service.ts` — ИЗМЕНИТЬ

**Только 2 изменения:**
1. Заменить `import { MockHttpPort }` → `import { FetchHttpPort }`.
2. Заменить `const http = new MockHttpPort()` → `const http = new FetchHttpPort()`.

```typescript
import { Injectable } from '@nestjs/common';
import type { AIProvider } from '@orchestra/domain';
import {
  ProviderRegistry,
  FetchHttpPort,  // ← НОВОЕ (вместо MockHttpPort)
  OpenAIAdapter,
  GLMAdapter,
  GeminiAdapter,
  MiMoAdapter,
} from '@orchestra/providers';

// ИЛИ если FetchHttpPort в apps/api а не в packages:
// import { FetchHttpPort } from './fetch-http.js';

@Injectable()
export class ProviderRegistryService {
  readonly registry: ProviderRegistry;

  constructor() {
    this.registry = new ProviderRegistry();
    const http = new FetchHttpPort();  // ← НОВОЕ (реальный HTTP вместо mock)

    const openaiKey = process.env.OPENAI_API_KEY ?? '';
    const glmKey = process.env.GLM_API_KEY ?? '';
    const geminiKey = process.env.GEMINI_API_KEY ?? '';
    const mimoKey = process.env.MIMO_API_KEY ?? '';

    this.registry.registerWithId('openai', new OpenAIAdapter(http, openaiKey));
    this.registry.registerWithId('glm', new GLMAdapter(http, glmKey));
    this.registry.registerWithId('gemini', new GeminiAdapter(http, geminiKey));
    this.registry.registerWithId('mimo', new MiMoAdapter(http, mimoKey));
  }

  getProvider(id: string): AIProvider {
    return this.registry.get(id);
  }

  listProviders(): string[] {
    return this.registry.list();
  }
}
```

> **Кодер:** `FetchHttpPort` может быть в `packages/providers/src/` (рядом с MockHttpPort) ИЛИ
> в `apps/api/src/providers/` (как app-layer adapter). Техлид рекомендует **apps/api** (app layer,
> не packages — domain-чистый). Но если в packages/providers удобнее (рядом с HttpPort interface)
> — допустимо, так как это всё равно impl а не domain logic.

**Если FetchHttpPort в apps/api:**
- НЕ нужно менять `packages/providers/src/index.ts` (не экспортируем).
- Import в provider-registry.service.ts: `import { FetchHttpPort } from './fetch-http.js'`.
- Import HttpPort type: `import type { HttpPort } from '@orchestra/providers'`.

**Если FetchHttpPort в packages/providers:**
- Добавить в `packages/providers/src/index.ts`: `export { FetchHttpPort } from './fetch-http.js'`.
- Это правка packages/ — нарушает D-21 anti-conflict. Требуется санкция в PLAN.
- Техлид рекомендует apps/api, чтобы не трогать packages.

### 1.5. `.env.example` — +4 API keys + overrides

```bash
# LLM Provider API keys (Wave 9). Если ключ пустой — adapter.health() = 'degraded'.
OPENAI_API_KEY=
GLM_API_KEY=
GEMINI_API_KEY=
MIMO_API_KEY=

# Опциональные override для base URLs (для mock stub-server testing)
# OPENAI_BASE_URL=http://localhost:8088/v1
# LLM_TIMEOUT_MS=30000
```

---

## 2. must_haves.truths (D-критерии)

### Backend code

- **D-01** `apps/api/src/providers/fetch-http.ts` НОВЫЙ:
  - `@Injectable FetchHttpPort implements HttpPort`.
  - `post(url, headers, body)` через `fetch()`.
  - `AbortController` + `setTimeout` timeout (30s default, `LLM_TIMEOUT_MS` override).
  - JSON parse с fallback (try/catch).
  - Error logging на HTTP errors и network errors.
  - `User-Agent: Orchestra/1.0` header.
- **D-02** `apps/api/src/providers/provider-registry.service.ts`:
  - `MockHttpPort` заменён на `FetchHttpPort`.
  - Остальное без изменений (4 adapter registrations, API key env reads).
- **D-03** `apps/api/.env.example`:
  - `OPENAI_API_KEY`, `GLM_API_KEY`, `GEMINI_API_KEY`, `MIMO_API_KEY` (empty defaults).
  - `# OPENAI_BASE_URL=...` (commented override).
  - `# LLM_TIMEOUT_MS=30000` (commented override).

### Build

- **D-04** `pnpm -r typecheck` → 10 пакетов green.
- **D-05** `pnpm --filter @orchestra/api build` → green. `fetch-http.js` compiled.

### Regression

- **D-06** `pnpm --filter @orchestra/gsd-engine test` → green (7/7).
- **D-07** `pnpm --filter @orchestra/consensus-engine test` → green (6/6).
- **D-08** `pnpm --filter @orchestra/api test` → green (5/5).
- **D-09** `pnpm --filter @orchestra/api test:e2e` → green (8/8).

### Runtime (УСИЛЕННЫЙ evidence-rule, главный D-16)

- **D-10** API start: `ProvidersModule dependencies initialized`, `listening`. No errors.
  Evidence: copy-paste лога.
- **D-11** **Mock LLM stub-server** поднимается на `:8088`:
  ```
  node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'Content-Type':'application/json'});s.end(JSON.stringify({choices:[{message:{content:'Mock LLM: test response'}}]}))}).listen(8088,()=>console.log('Mock LLM on :8088'))"
  ```
  Возвращает `{choices:[{message:{content:"Mock LLM: test response"}}]}` на любой POST.
  Evidence: curl POST → JSON response.
- **D-12** `FetchHttpPort.post()` работает: API с `OPENAI_BASE_URL=http://localhost:8088` env override →
  adapter指向 stub-server вместо api.openai.com.
  
  > **Кодер:** текущие адаптеры НЕ имеют BASE_URL env override (hardcoded в constructor).
  2 варианта: (a) добавить env override в ProviderRegistryService при создании adapter;
  (b) временно патчить adapter config для теста. Техлид рекомендует (a) — минимальная правка
  ProviderRegistryService: читать `process.env.OPENAI_BASE_URL` и передавать в adapter.

  Evidence: API log показывает HTTP request to localhost:8088.
- **D-13** Direct adapter test: `GET /sessions/:id` после round → session.rounds[0] содержит
  responses с **реальным контентом** из mock server (не '[Mock response]').
  Evidence: curl GET /sessions/:id → rounds содержат responses.
- **D-14** Consensus Engine работает с mock responses: advance → PhaseChanged event
  (transitioned или gated — зависит от consensus verdict на mock контенте).
  Evidence: GET /events → PhaseChanged event.
- **D-15** Error handling: если stub-server не запущен → advance возвращает 500 (понятная ошибка),
  API не падает. Error log содержит "Network error: connection refused".
  Evidence: log + HTTP 500 response.
- **D-16** **ГЛАВНЫЙ — End-to-end через mock LLM:**
  1. Запустить mock stub-server на :8088.
  2. Запустить API с `OPENAI_BASE_URL=http://localhost:8088/v1`.
  3. `POST /sessions -d '{"name":"llm-test","projectId":"p"}'` → session created.
  4. `POST /sessions/:id/rounds` → round started.
  5. `POST /sessions/:id/advance` → **HTTP 200** (transitioned или gated), AdvancePhaseResult.
  6. `GET /events` → содержит RoundStarted + PhaseChanged events.
  7. **Response content** в events (или session detail) ≠ '[Mock response]' — реальный mock
     контент из stub-server.

  Evidence: copy-paste всей последовательности. Лично техлид.

### Anti-conflict

- **D-17** `packages/**` (всё): 0 изменений (если FetchHttpPort в apps/api).
- **D-18** `apps/api/src/`: изменения ТОЛЬКО в `providers/` (`fetch-http.ts` НОВЫЙ,
  `provider-registry.service.ts` modified). Другие — 0.
- **D-19** `apps/api/src/{sessions,gsd,kg,context,roles,consensus,prompts,event-bus,events,prisma.service,main,app.module}.ts`:
  0 изменений.
- **D-20** `apps/api/{tsconfig.json,nest-cli.json,prisma/,test/,package.json}`: 0 изменений.
- **D-21** `apps/web/**`, `docs/`, `role-manifests/`, `prompts/`: 0 изменений.
- **D-22** Root config + `docker-compose.yml`: 0 изменений.

### Discipline

- **D-23** SUMMARY содержит evidence для каждого runtime-D (D-10..16). Главный D-16 —
  copy-paste end-to-end sequence.
- **D-24** Все процессы остановлены (api node + mock stub-server + docker if used).
  PID + kill commands.
- **D-25** SUMMARY честно описывает: FetchHttpPort impl, mock stub-server verification,
  real API keys — когда owner готов (D-9-1).

---

## 3. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-25 PASS (с evidence).
2. FetchHttpPort реализован, заменяет MockHttpPort.
3. Mock stub-server → advance → реальные-format LLM ответы (не '[Mock response]').
4. Consensus Engine работает на mock контенте.
5. Regression Phase 5/6/7/8 green.
6. Anti-conflict: только providers/ + .env.example.

**Фаза НЕ выполнена, если:**
- FetchHttpPort не работает (D-12/D-16 FAIL).
- Advance падает (D-14/D-16 FAIL) — LLM integration сломана.
- Real API still using Mock (D-02 FAIL — MockHttpPort не заменён).
- Кодер тронул что-то вне разрешённых зон (D-17..22 FAIL).

---

## 4. Порядок работы кодера

1. **Прочитать PLAN.** Особенно §1.3 FetchHttpPort, §1.4 ProviderRegistryService changes,
   §0.4 Mock stub-server, §3 D-16 (главный end-to-end).
2. **FetchHttpPort (§1.3):** НОВЫЙ в `apps/api/src/providers/fetch-http.ts`.
3. **ProviderRegistryService (§1.4):** заменить MockHttpPort → FetchHttpPort. Добавить
   OPENAI_BASE_URL env override (для mock stub-server testing).
4. **.env.example (§1.5):** +4 API keys + base URL overrides.
5. **Build (D-04, D-05):** typecheck + build.
6. **Runtime verifier (D-10..16) с УСИЛЕННЫМ evidence:**
   - Создать mock stub-server script.
   - D-10: API start.
   - D-11: stub-server up.
   - D-12: FetchHttpPort → stub-server.
   - D-13: session detail содержит real mock responses.
   - D-14: advance → PhaseChanged.
   - D-15: error handling (stub-server down).
   - **D-16: ГЛАВНЫЙ — full end-to-end через mock LLM.**
   - Cleanup.
7. **Regression (D-06..09):** 4 spec'а.
8. **Anti-conflict (D-17..22):** git diff.
9. **`9-1-SUMMARY.md`** с evidence.

**Оценка:** ~4-6 часов (FetchHttpPort + wiring + mock stub-server + e2e verification).

---

## 5. Design notes

1. **FetchHttpPort в apps/api, не packages.** HttpPort interface — hexagonal port в packages.
   FetchHttpPort — adapter в app layer. Соответствует pattern (PrismaSessionStore, RedisEventPublisher).
2. **fetch() native (Node 18+).** Не нужен axios/node-fetch. Node 20+ имеет stable fetch.
3. **AbortController timeout.** 30s default. LLM могут быть медленными (complex prompts).
   Env override для tuning.
4. **Mock stub-server — ВРЕМЕННЫЙ артефакт.** Не коммитить в репо. Скрипт в `.planning/_scratch/`
   или inline `node -e`. Удалять после verification.
5. **OPENAI_BASE_URL env override.** Адаптеры имеют hardcoded baseUrl в constructor. Для mock
   testing — override через env. Production: пустой = default api.openai.com.
6. **Error propagation.** FetchHttpPort.throw → adapter.send().throw → RoleRouter.route().throw →
   RoundOrchestratorGatingAdapter.evaluate().throw → advance.500. Понятная ошибка, API не падает.
7. **Не streaming.** send() ждёт полный ответ. Streaming SSE — Wave 9+ (D-9-2).
8. **Не fallback.** Если openai down → advance падает. Fallback — Wave 9+ (D-9-5).
9. **MockHttpPort остаётся в packages/providers.** Unit-тесты пакетов используют его. Apps/api
   использует FetchHttpPort. Hexagonal — 2 impls одного port, для разных contexts.
10. **API keys empty по умолчанию.** Если key пустой — adapter.health() = 'degraded', но send()
    всё равно попытается (вернёт 401 от API). Для mock testing — key не нужен (stub-server
    не проверяет auth).

---

## 6. Долги, которые фаза ЗАКРЫВАЕТ

- **Stub-gating era.** MockHttpPort в production path заменён на FetchHttpPort. Реальные HTTP
  запросы к LLM (или mock endpoint для dev).
- **Открывает дорогу для:** Confidence gauges (D-8b-3), Conducting Score дорожки (D-8b-5),
  Decision Repository с реальным контентом (D-8d-2-2).

## 7. Долги, которые фаза ОТКРЫВАЕТ

- **D-9-1** Real API keys для всех 4 провайдеров — когда owner готов.
- **D-9-2** Streaming SSE от провайдера.
- **D-9-3** Error handling для LLM failures (timeout, rate limit, 500).
- **D-9-4** Token/cost tracking persistence.
- **D-9-5** Provider fallback.

---

## 8. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| fetch() не доступен (Node < 18) | исключено | Orchestra использует Node 20.18 (verified). |
| Mock stub-server конфликтует с портом | низкая | Порт 8088 (нестандартный). |
| Adapter hardcoded baseUrl ломает mock testing | средняя | Добавить OPENAI_BASE_URL env override в ProviderRegistryService. |
| Real API key случайно закоммичен | исключено | .env.example имеет empty defaults. .env в .gitignore. |
| LLM timeout 30s слишком короткий | низкая | Env override LLM_TIMEOUT_MS. Для production — tuning. |
| FetchHttpPort не catch'ит все error types | средняя | AbortError + generic Error. Logger.error для всех. |
| Process zombies (8d-1 precedent) | средняя | D-24. Git Bash + `kill $PID`. |

---

## 9. Что получает Orchestra после Phase 9-1

**Реальный LLM integration.** Orchestra становится живой — реальные (или mock-format) ответы
агентов через HTTP. Consensus Engine работает на реальном контенте.

1. **Backend production-ready с real LLM** — подставь API ключи → Orchestra генерирует инженерные
   артефакты через GSD-цикл.
2. **Foundation для UI Canon features** — Conducting Score дорожки (D-8b-5), Confidence gauges
   (D-8b-3) теперь имеют источник данных.
3. **Foundation для Decision Repository** — real content в responses → ADR/Decision artifacts.
4. **Multi-provider Orchestra** — OpenAI + GLM + Gemini + MiMo, канон Architecture.md.

**Phase 9-1 = Orchestra оживает.** Stub-gating заканчивается, real AI collaboration начинается.

---

**Конец PLAN 9-1.** Ждёт `/gsd-execute-phase 9` (mimo) → `/gsd-validate-phase 9`.
После PASS — README-CONTRACT-PHASE-9.md → Wave 9 (Real LLM) открыта.
