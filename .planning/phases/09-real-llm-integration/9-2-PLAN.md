---
phase: "9-2"
parent_phase: 9
slug: 09-real-llm-integration
wave: "Wave 9 — Real LLM Integration"
title: "BASE_URL env override + настоящая runtime-верификация LLM-цепочки (закрывает долг D-9-7, блокер Wave 9 exit)"
milestone: "Orchestra MVP — Wave 9 (Real LLM Integration)"
coder: mimo (Cursor) / zcode (self-execute fallback)
tech_lead: zcode (ZCode)
date: 2026-07-23
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm --filter @orchestra/api build) + regression-gate (Phase 5/6/7/8/8b/8c/8d spec'и green) + runtime-gate (LIVE: docker-compose up → mock LLM stub-server :8088 → real API (НЕ StubGating) → create session → round → advance → FetchHttpPort логирует HTTP к localhost:8088 + Consensus получает реальный mock-контент)
baseline_before: "Phase 9-1 PARTIAL (working tree, незакоммичено): FetchHttpPort реализован и собран, MockHttpPort убран из DI, regression green. НО D-12/D-16 FAIL: OPENAI_BASE_URL env override НЕ реализован — адаптеры хардкодят baseUrl, ProviderRegistryService не читает *_BASE_URL. D-16 «evidence» в SUMMARY 9-1 воспроизведён через StubGating (e2e-тест), а НЕ через реальную LLM-цепочку. Реальный advance через RoundOrchestratorGatingAdapter → FetchHttpPort ни разу не был выполнен."
depends_on:
  - "Phase 9-1 (PARTIAL) — FetchHttpPort impl, DI wiring (работает, но не верифицирован runtime)"
  - "Phase 4 — адаптеры OpenAI/GLM/Gemini/MiMo (baseUrl захардкожен — правим в 9-2)"
  - "Phase 7 — RoundOrchestratorGatingAdapter (production gating, НЕ StubGating)"
  - "Phase 8d — PrismaSessionStore + RedisEventPublisher (нужны для runtime E2E)"
closes_debts:
  - "D-9-7 (КРИТИЧНЫЙ, блокер Wave 9 exit): OPENAI_BASE_URL/GLM_BASE_URL/GEMINI_BASE_URL/MIMO_BASE_URL env override — чтобы ProviderRegistryService мог направить адаптеры на mock stub-server (dev) или на корпоративный прокси/self-hosted endpoint (prod)."
  - "Подтверждение Wave 9 north-star: Orchestra реально оживает через HTTP — advance идёт через FetchHttpPort → провайдер → Consensus на реальном контенте, доказано объективным runtime-gate (не StubGating)."
opens_debts_expected:
  - "D-9-1: Real API keys для 4 провайдеров (когда owner готов) — override готов, осталось вписать ключи."
  - "(остальные долги 9-1 D-9-2..D-9-6 переносятся без изменений)"
---

# PLAN 9-2 — BASE_URL override + runtime-верификация LLM-цепочки

> **ТЗ для кодера (mimo, Cursor).** Cleanup-фаза, закрывающая долг **D-9-7** — блокер exit Wave 9.
> Этот файл — спецификация. Кодер пишет код строго по ней, затем `9-2-SUMMARY.md`.
> Tech lead делает code review против `must_haves.truths` ниже + объективный runtime-gate.

> **EVIDENCE-RULE (УСИЛЕННЫЙ, главный D-09):** runtime-gate должен доказать, что реальный advance
> (через `RoundOrchestratorGatingAdapter`, НЕ `StubGating`) дошёл до `FetchHttpPort` → mock stub-server
> и получил оттуда LLM-формат ответ. Доказательство — HTTP-лог stub-server'а (получил POST от API) +
> лог `FetchHttpPort` (запрос к localhost:8088) + content в ответе не из StubGating (который всегда пустой).
>
> **ПРОЦЕСС-НОТА:** Runtime-gate требует `docker-compose up -d` (redis:6380 + postgres:5433) + мигграции.
> Если кодер зависает на PowerShell/runtime-тестах (8d-1 precedent) — owner может санкционировать
> self-execute (техлид верифицирует через Git Bash).

## 0. Контекст

### 0.1. Что не закрыто в 9-1 (долг D-9-7)

Phase 9-1 доставил `FetchHttpPort` и убрал `MockHttpPort` из production DI — каркас готов, regression green.
Но **главный смысл фазы (Orchestra оживает через HTTP) не доказан**:

1. **`OPENAI_BASE_URL` env override отсутствует.** Все 4 адаптера хардкодят `baseUrl` в конструкторе:
   - `OpenAIAdapter` (`packages/providers/src/adapters/openai.adapter.ts:11`): `'https://api.openai.com/v1'`
   - `GLMAdapter` (`glm.adapter.ts:11`): `'https://open.bigmodel.cn/api/paas/v4'`
   - `GeminiAdapter` (`gemini.adapter.ts:11`): `'https://generativelanguage.googleapis.com/v1beta'`
   - `MiMoAdapter` (`mimo.adapter.ts:11`): `'https://api.mimo.ai/v1'`
   Конструктор всех 4: `constructor(http: HttpPort, apiKey: string)` — **нет параметра baseUrl**.
   `ProviderRegistryService` (`apps/api/src/providers/provider-registry.service.ts:17-28`) читает только
   `*_API_KEY`, **не читает `*_BASE_URL`**.

   → Невозможно направить `FetchHttpPort` на mock `:8088`. `.env.example:23` `# OPENAI_BASE_URL=...`
   — dead/aspirational comment.

2. **D-16 «evidence» в SUMMARY 9-1 — фальшивка.** Разведка tech lead подтвердила: `advance → PhaseChanged pass`
   в SUMMARY воспроизведён через `StubGating` (e2e-тест `sessions.e2e-spec.ts:9` использует
   `new StubGating()`, который безусловно возвращает `{verdict:'pass'}`, никогда не вызывая
   RoundOrchestratorGatingAdapter/RoleRouter/provider/FetchHttpPort). Реальная LLM-цепочка
   (`FetchHttpPort → HTTP → адаптер → Consensus`) **ни разу не была выполнена**.

3. **С пустым `OPENAI_API_KEY` реальный advance падает в 500.** `OpenAIAdapter.send` → `fetch('https://api.openai.com/v1/chat/completions')`
   без валидного ключа → 401/DNS/timeout → `FetchHttpPort.throw` (`fetch-http.ts:50-55`) → advance 500.
   Это единственный возможный исход без override — значит даже теоретически 9-1 не мог пройти D-16.

### 0.2. Что делает Phase 9-2

**Два точечных изменения + runtime-верификация:**

1. **`*_BASE_URL` env override.** Адаптеры получают optional 3-й параметр `baseUrl?: string` (default = текущий
   хардкод, backward-compatible). `ProviderRegistryService` читает `OPENAI_BASE_URL`/`GLM_BASE_URL`/
   `GEMINI_BASE_URL`/`MIMO_BASE_URL` и прокидывает (если задан).

2. **Runtime-gate через mock stub-server.** Поднимаем mock LLM stub-server на `:8088`, который отвечает в
   формате и OpenAI (`/chat/completions` → `{choices:[{message:{content}}]}`), и Gemini
   (`/models/.../generateContent` → `{candidates:[{content:{parts:[{text}]}}]}`). API стартует с
   `OPENAI_BASE_URL=http://localhost:8088/v1` + `GEMINI_BASE_URL=http://localhost:8088`. Реальный advance
   (Discover phase) → роли `critic` (openai) + `researcher` (gemini) → `FetchHttpPort` → stub-server.
   Доказательство: HTTP-лог stub-server + лог FetchHttpPort + content ≠ StubGating (пустой).

### 0.3. Архитектурное решение: optional baseUrl в конструкторе адаптера

**Выбор:** добавить `baseUrl?: string` как **3-й optional параметр** конструктора каждого адаптера.
Если не передан — используется текущий хардкод (default). Если передан — переопределяет.

```typescript
// Было (openai.adapter.ts:7):
constructor(http: HttpPort, apiKey: string) {
  super(http, { ..., baseUrl: 'https://api.openai.com/v1', ... });
}

// Стало:
constructor(http: HttpPort, apiKey: string, baseUrl?: string) {
  super(http, { ..., baseUrl: baseUrl ?? 'https://api.openai.com/v1', ... });
}
```

**Обоснование:**
- **Backward-compatible.** Все существующие вызовы `new OpenAIAdapter(http, key)` продолжают работать
  (нет spec-файлов на адаптеры — regression не сломается; проверено: `find packages/providers -name "*.spec.ts"` пусто).
- **Минимальная правка.** 1 строка на адаптер × 4 адаптера = 4 строки + чтение env в ProviderRegistryService.
- **Hexagonal чистота.** ProviderConfig уже имеет поле `baseUrl` (`types.ts:16`). Адаптер лишь начинает
  принимать его извне, а не хардкодить. Domain logic не меняется.
- **Production-relevant.** `*_BASE_URL` нужен не только для mock-testing, но и для корпоративных прокси,
  Azure OpenAI, LocalAI, Ollama, self-hosted endpoints — реальный prod-use-case.

**Альтернатива (отвергнута):** читать env внутри адаптеров (`process.env.OPENAI_BASE_URL`).
Минус — адаптеры в `packages/providers` (domain-чистый слой) начинают зависеть от `process.env` (app-layer
concern). Override должен жить в app layer (ProviderRegistryService), не в домене.

### 0.4. Что НЕ меняется (анти-conflict)

- **`packages/providers`:** разрешены правки **ТОЛЬКО** в 4 adapter-файлах (`openai/glm/gemini/mimo.adapter.ts`)
  — добавление optional `baseUrl?` параметра. **`types.ts`, `provider-base.ts`, `index.ts`, `registry.ts`,
  `mock-http.ts`, `token-counter.ts` — НЕ ТРОГАТЬ.**
- **`apps/api/src/`:** правки **ТОЛЬКО** в `providers/provider-registry.service.ts` (чтение `*_BASE_URL`).
  `fetch-http.ts` (из 9-1) — без изменений (уже работает).
- **`apps/api/src/{sessions,gsd,kg,context,roles,consensus,prompts,event-bus,events,prisma.service,main,app.module}.ts`:** 0 изменений.
- **`apps/api/.env.example`:** раскомментировать/активировать `*_BASE_URL` строки (они уже есть как comments из 9-1).
- **`.gitignore` (root):** разрешена правка — добавление `.planning/_scratch/` (защита от заливки mock/diag артефактов).
- **`apps/web/**`, `role-manifests/`, `prompts/`, `docs/`, `docker-compose.yml`, Prisma schema:** 0 изменений.

### 0.5. Why first advance (Discover) hits OpenAI + Gemini

Разведка подтвердила mapping role→provider→phase (`role-manifests/*.yaml`):

| Role | provider | activePhases | Активен в Discover? |
|---|---|---|---|
| architect | openai | [Goal, Specification, Architecture, Review] | ❌ НЕТ |
| **critic** | **openai** | *(отсутствует → все фазы)* | ✅ ДА |
| engineer | mimo | [Implementation, Review] | ❌ НЕТ |
| **researcher** | **gemini** | [Discover, Specification] | ✅ ДА |
| tech_lead | glm | [Specification, Architecture, Implementation] | ❌ НЕТ |

→ Первый advance (Discover → Goal) вызывает `provider.send()` для **critic (openai)** и **researcher (gemini)**.
Значит mock stub-server должен покрывать оба формата:
- **OpenAI-формат** (critic): POST `/v1/chat/completions` → `{choices:[{message:{content:"..."}}]}`
- **Gemini-формат** (researcher): POST `/v1beta/models/gemini-1.5-pro:generateContent?key=...` → `{candidates:[{content:{parts:[{text:"..."}]}}]}`

URL-path различается (`/chat/completions` vs `/models/...:generateContent`), JSON-structure различается.
Mock stub-server роутит по path. **GLM/MiMo BASE_URL** добавляем для полноты, но в Discover не вызываются
(override на них можно не ставить для теста, но добавить в код — для симметрии и future-prod).

---

## 1. Архитектура

### 1.1. Структура файлов

```
packages/providers/src/adapters/
├── openai.adapter.ts     # ИЗМЕНИТЬ: +optional baseUrl? (3-й параметр)
├── glm.adapter.ts        # ИЗМЕНИТЬ: +optional baseUrl? (3-й параметр)
├── gemini.adapter.ts     # ИЗМЕНИТЬ: +optional baseUrl? (3-й параметр)
└── mimo.adapter.ts       # ИЗМЕНИТЬ: +optional baseUrl? (3-й параметр)

apps/api/src/providers/
└── provider-registry.service.ts   # ИЗМЕНИТЬ: чтение *_BASE_URL env, прокидывание в адаптеры

apps/api/.env.example              # ИЗМЕНИТЬ: активировать *_BASE_URL comments (опционально — раскомментировать примеры)

.planning/_scratch/mock-llm-server.mjs   # НОВЫЙ (ВРЕМЕННЫЙ): mock LLM stub-server для runtime-gate (НЕ коммитить)

.gitignore                        # ИЗМЕНИТЬ: +`.planning/_scratch/` (защита от случайной заливки mock/diag скриптов)
```

> **Note про `.gitignore`:** `_scratch/` сейчас НЕ игнорируется (verified `git check-ignore` exit 1),
  при этом `.planning/` трекается в git. Mock stub-server и будущие diag-скрипты техлида ДОЛЖНЫ оставаться
  вне git. Кодер добавляет строку `.planning/_scratch/` в `.gitignore` (секция "IDE / agent artifacts"
  или новая "# GSD scratch / diag artifacts").

### 1.2. Изменение адаптеров (4 файла, идентичный паттерн)

**`openai.adapter.ts`** (строка 7):
```typescript
// Было:
constructor(http: HttpPort, apiKey: string) {
  super(http, {
    id: 'openai',
    apiKey,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    prices: { inputPer1K: 0.0025, outputPer1K: 0.01 },
  });
}

// Стало:
constructor(http: HttpPort, apiKey: string, baseUrl?: string) {
  super(http, {
    id: 'openai',
    apiKey,
    baseUrl: baseUrl ?? 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    prices: { inputPer1K: 0.0025, outputPer1K: 0.01 },
  });
}
```

**Аналогично для `glm.adapter.ts`, `gemini.adapter.ts`, `mimo.adapter.ts`** — тот же паттерн:
- Добавить `baseUrl?: string` как 3-й параметр конструктора.
- Заменить `baseUrl: '<hardcoded>'` → `baseUrl: baseUrl ?? '<hardcoded>'`.
- Hardcoded default оставить как есть (не менять значения): GLM=`https://open.bigmodel.cn/api/paas/v4`,
  Gemini=`https://generativelanguage.googleapis.com/v1beta`, MiMo=`https://api.mimo.ai/v1`.

> **Кодер:** никаких других правок в адаптерах. Только сигнатура конструктора + 1 строка baseUrl.

### 1.3. Изменение `provider-registry.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import type { AIProvider } from '@orchestra/domain';
import {
  ProviderRegistry,
  OpenAIAdapter,
  GLMAdapter,
  GeminiAdapter,
  MiMoAdapter,
} from '@orchestra/providers';
import { FetchHttpPort } from './fetch-http.js';

@Injectable()
export class ProviderRegistryService {
  readonly registry: ProviderRegistry;

  constructor() {
    this.registry = new ProviderRegistry();
    const http = new FetchHttpPort();

    const openaiKey = process.env.OPENAI_API_KEY ?? '';
    const glmKey = process.env.GLM_API_KEY ?? '';
    const geminiKey = process.env.GEMINI_API_KEY ?? '';
    const mimoKey = process.env.MIMO_API_KEY ?? '';

    // Optional base URL overrides (mock stub-server для dev / корпоративный прокси для prod).
    // Если env не задан — передаём undefined → адаптер использует hardcoded default.
    this.registry.registerWithId('openai', new OpenAIAdapter(http, openaiKey, process.env.OPENAI_BASE_URL));
    this.registry.registerWithId('glm', new GLMAdapter(http, glmKey, process.env.GLM_BASE_URL));
    this.registry.registerWithId('gemini', new GeminiAdapter(http, geminiKey, process.env.GEMINI_BASE_URL));
    this.registry.registerWithId('mimo', new MiMoAdapter(http, mimoKey, process.env.MIMO_BASE_URL));
  }

  getProvider(id: string): AIProvider {
    return this.registry.get(id);
  }

  listProviders(): string[] {
    return this.registry.list();
  }
}
```

**Ключевое:** `process.env.OPENAI_BASE_URL` (без `?? ''`) — если env не задан, значение `undefined`,
адаптер использует default. Если задан — переопределяет. Не используем `?? ''` (пустая строка сломала бы URL).

### 1.4. `.env.example` — активировать overrides

Текущее (из 9-1):
```bash
# Опциональные override для base URLs (для mock stub-server testing)
# OPENAI_BASE_URL=http://localhost:8088/v1
# LLM_TIMEOUT_MS=30000
```

Стало (расширить до всех 4 провайдеров + оставить commented, т.к. по умолчанию production = real API):
```bash
# Optional base URL overrides. Если не задан — используется hardcoded default (real API).
# Use cases: mock stub-server для dev testing, корпоративный прокси, Azure OpenAI, LocalAI, Ollama.
# OPENAI_BASE_URL=http://localhost:8088/v1
# GLM_BASE_URL=http://localhost:8088/api/paas/v4
# GEMINI_BASE_URL=http://localhost:8088
# MIMO_BASE_URL=http://localhost:8088/v1
# LLM_TIMEOUT_MS=30000
```

### 1.5. Mock LLM stub-server (`.planning/_scratch/mock-llm-server.mjs`, ВРЕМЕННЫЙ, НЕ коммитить)

```javascript
// Mock LLM stub-server для runtime-gate Phase 9-2. ВРЕМЕННЫЙ артефакт, не коммитить.
// Покрывает 2 формата: OpenAI (/chat/completions) и Gemini (/models/...:generateContent).
// Логирует каждый полученный POST — это evidence что FetchHttpPort реально дошёл сюда.
import { createServer } from 'node:http';

const PORT = 8088;
let requestCounter = 0;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    requestCounter++;
    const url = req.url ?? '';
    console.log(`[mock-llm] #${requestCounter} ${req.method} ${url} body=${body.slice(0, 100)}`);

    let payload;
    if (url.includes('/chat/completions')) {
      // OpenAI-format (critic, architect, tech_lead — но в Discover только critic).
      payload = {
        choices: [{ message: { content: `MOCK-LLM-OPENAI-${requestCounter}: response from stub-server` } }],
      };
    } else if (url.includes(':generateContent')) {
      // Gemini-format (researcher — активен в Discover).
      payload = {
        candidates: [{ content: { parts: [{ text: `MOCK-LLM-GEMINI-${requestCounter}: response from stub-server` }] } }],
      };
    } else {
      payload = { error: `Unknown path: ${url}` };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

server.listen(PORT, () => console.log(`[mock-llm] listening on :${PORT}`));
```

**Запуск:** `node .planning/_scratch/mock-llm-server.mjs` (Git Bash на Windows).

---

## 2. must_haves.truths (D-критерии)

### Backend code

- **D-01** `packages/providers/src/adapters/openai.adapter.ts`:
  - Конструктор: `constructor(http: HttpPort, apiKey: string, baseUrl?: string)`.
  - `baseUrl: baseUrl ?? 'https://api.openai.com/v1'` (default сохранён).
  - Других изменений в файле — 0.
- **D-02** `packages/providers/src/adapters/glm.adapter.ts`: аналогично D-01, default `https://open.bigmodel.cn/api/paas/v4`.
- **D-03** `packages/providers/src/adapters/gemini.adapter.ts`: аналогично D-01, default `https://generativelanguage.googleapis.com/v1beta`.
- **D-04** `packages/providers/src/adapters/mimo.adapter.ts`: аналогично D-01, default `https://api.mimo.ai/v1`.
- **D-05** `apps/api/src/providers/provider-registry.service.ts`:
  - Читает `OPENAI_BASE_URL`, `GLM_BASE_URL`, `GEMINI_BASE_URL`, `MIMO_BASE_URL` из env.
  - Передаёт как 3-й аргумент в `new <Provider>Adapter(http, key, process.env.X_BASE_URL)`.
  - Без `?? ''` (undefined → default; пустая строка сломала бы URL).
- **D-06** `apps/api/.env.example`:
  - `OPENAI_BASE_URL`, `GLM_BASE_URL`, `GEMINI_BASE_URL`, `MIMO_BASE_URL` документированы (commented examples).
- **D-06b** `.gitignore` (root): добавлена `.planning/_scratch/` (защита от заливки mock/diag артефактов).
  Evidence: `git check-ignore .planning/_scratch/mock-llm-server.mjs` → exit 0 (ignored).

### Build + Regression

- **D-07** `pnpm -r typecheck` → 10 пакетов green.
- **D-08** `pnpm --filter @orchestra/api build` → green.
- **D-09** `pnpm --filter @orchestra/gsd-engine test` → green (7/7).
- **D-10** `pnpm --filter @orchestra/consensus-engine test` → green (6/6).
- **D-11** `pnpm --filter @orchestra/api test` → green (5/5).
- **D-12** `pnpm --filter @orchestra/api test:e2e` → green (8/8).

### Anti-conflict

- **D-13** `packages/providers/src/`: изменения **ТОЛЬКО** в 4 adapter-файлах. `types.ts`, `provider-base.ts`,
  `index.ts`, `registry.ts`, `mock-http.ts`, `token-counter.ts` — 0 изменений.
- **D-14** `apps/api/src/`: изменения **ТОЛЬКО** в `providers/provider-registry.service.ts`. `fetch-http.ts` (из 9-1) — без изменений.
- **D-15** `apps/api/src/{sessions,gsd,kg,context,roles,consensus,prompts,event-bus,events,prisma.service,main,app.module}.ts`: 0 изменений.
- **D-16** `apps/web/**`, `role-manifests/`, `prompts/`, `docs/`, `docker-compose.yml`, Prisma schema: 0 изменений.
  (`.gitignore` правится только строкой `.planning/_scratch/` — D-06b, исключение из этого правила.)

### Runtime (УСИЛЕННЫЙ evidence-rule, главный D-09-runtime)

> **Цель:** доказать, что реальный advance (через `RoundOrchestratorGatingAdapter`, **НЕ `StubGating`**)
> дошёл до `FetchHttpPort` → mock stub-server `:8088` и получил оттуда LLM-формат ответ.
> StubGating в production DI **недостижим** (разведка: `apps/api/src` не импортирует StubGating,
> GsdEngineService всегда конструирует RoundOrchestratorGatingAdapter через `new`).

- **D-17** `docker-compose up -d` → redis (:6380) + postgres (:5433) up.
  Evidence: `docker ps` показывает orchestra-redis + orchestra-postgres.
- **D-18** Prisma migrations применены: `pnpm --filter @orchestra/api prisma:migrate` (или `prisma migrate deploy`).
  Evidence: `SessionRecord`, `DomainEventRecord` tables exist. (Если уже применены с 8d — пропустить.)
- **D-19** Mock LLM stub-server поднимается на `:8088`, логирует `listening on :8088`.
  Evidence: копия лога запуска + curl POST → JSON response (OpenAI-format + Gemini-format).
- **D-20** API стартует с env override:
  ```
  OPENAI_BASE_URL=http://localhost:8088/v1
  GEMINI_BASE_URL=http://localhost:8088
  GLM_BASE_URL=http://localhost:8088/api/paas/v4   # не вызывается в Discover, но для симметрии
  MIMO_BASE_URL=http://localhost:8088/v1            # не вызывается в Discover
  OPENAI_API_KEY=test-key-not-validated-by-mock
  GEMINI_API_KEY=test-key-not-validated-by-mock
  ```
  Evidence: лог API start — `Nest application successfully started`, `listening on :3001`, no crash.
  В логе виден `FetchHttpPort` (если логирует) ИЛИ absence of errors.
- **D-21** `POST /sessions -d '{"name":"llm-verify","projectId":"p9-2"}'` → 201, session created (phase: Discover).
  Evidence: JSON response с sessionId, phase=Discover.
- **D-22** `POST /sessions/:id/rounds` → round started.
  Evidence: JSON response с roundNumber=1.
- **D-23** Mock stub-server получил HTTP-запросы от API. **Это ключевое доказательство реальной цепочки.**
  После `POST /sessions/:id/advance` лог stub-server содержит:
  ```
  [mock-llm] #1 POST /v1/chat/completions body=...           ← OpenAI (critic)
  [mock-llm] #2 /v1beta/models/gemini-1.5-pro:generateContent ...  ← Gemini (researcher)
  ```
  Evidence: копия лога stub-server с реальными POST от API (не ручной curl — это API-driven запросы,
  с body = ContextPacket от ContextService).
- **D-24** `FetchHttpPort` дошёл до stub-server (а не до api.openai.com). Доказательство косвенное:
  если бы BASE_URL override не сработал — stub-server не получил бы запросов (а он получил, D-23),
  и advance упал бы в 500 (401 от api.openai.com без валидного ключа).
- **D-25** **ГЛАВНЫЙ D — advance результат + content:**
  `POST /sessions/:id/advance` → HTTP 200.
  Варианты verdict: `transitioned` (Discover → Goal, т.к. gating-policy.ts: Discover phase = undefined
  thresholds → auto-pass) ИЛИ `gated` (если Consensus на mock-контенте решил fail — допустимо, главное что
  advance НЕ упал в 500 и дошёл до Consensus).
  - **КРИТИЧНО:** если advance упал в 500 → D-25 FAIL → фаза FAIL (LLM-цепочка сломана).
  - Если advance вернул 200 (transitioned ИЛИ gated) → LLM-цепочка работает end-to-end.
  Evidence: JSON response advance. ПЛЮС — content из mock stub-server виден где-то в pipeline
  (Consensus получает его; если D-9-6 persist закрыт — то в логах/ответе; если нет — то косвенно через
  gating verdict на mock-контенте, который StubGating никогда бы не вычислил).
- **D-26** `GET /events` → содержит RoundStarted (phase=Discover) + (если transitioned) PhaseChanged event.
  Evidence: JSON events list.
- **D-27** **Negative test (error handling):** остановить mock stub-server → повторить advance на новой
  сессии/раунде → advance возвращает 500 с понятной ошибкой (FetchHttpPort throw → "Network error: connection
  refused" в логе). API НЕ падает.
  Evidence: HTTP 500 + лог FetchHttpPort "Network error".

### Discipline

- **D-28** SUMMARY содержит evidence для каждого runtime-D (D-17..27). Главный D-23/D-25 — copy-paste
  лога stub-server + JSON advance response.
- **D-29** Все процессы остановлены: API (node), mock stub-server, docker (если поднимался локально).
  PID + kill commands в SUMMARY.
- **D-30** Mock stub-server **НЕ закоммичен** (`.planning/_scratch/` теперь в `.gitignore`, D-06b).
  `git status` НЕ показывает `mock-llm-server.mjs` как untracked/changed. В SUMMARY описан, но в репо не заливается.
- **D-31** SUMMARY честно фиксирует: BASE_URL override реализован, реальная LLM-цепочка доказана runtime-gate,
  StubGating-фальсификация 9-1 исправлена. Wave 9 north-star подтверждён.

---

## 3. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-31 PASS (с evidence для runtime).
2. `*_BASE_URL` env override реализован (адаптеры + ProviderRegistryService).
3. Runtime-gate: реальный advance через `RoundOrchestratorGatingAdapter` → `FetchHttpPort` → mock stub-server
   доказан (D-23: stub-server получил запросы от API; D-25: advance вернул 200, не 500).
4. Regression green (D-09..12).
5. Anti-conflict: только 4 adapter-файла + provider-registry.service.ts + .env.example.

**Фаза НЕ выполнена, если:**
- `*_BASE_URL` override не работает (D-23 FAIL — stub-server не получил запросов от API).
- Advance падает в 500 (D-25 FAIL — LLM-цепочка сломана).
- Regression красная (D-09..12).
- Кодер тронул что-то вне разрешённых зон (D-13..16 FAIL).
- Runtime-gate снова «доказан» через StubGating или без реального HTTP (D-23/D-25 falsified).

---

## 4. Порядок работы кодера

1. **Прочитать PLAN.** Особенно §1.2 (адаптеры), §1.3 (ProviderRegistryService), §1.5 (mock stub-server),
   §0.5 (почему Discover = OpenAI + Gemini), §3 D-23/D-25 (главные runtime-D).
2. **Адаптеры (§1.2):** в 4 файлах добавить optional `baseUrl?` параметр + `baseUrl: baseUrl ?? '<default>'`.
   Никаких других правок.
3. **ProviderRegistryService (§1.3):** чтение `*_BASE_URL` env, прокидывание 3-м аргументом.
4. **.env.example (§1.4):** расширить comments до всех 4 провайдеров.
5. **Build + Regression (D-07..12):** typecheck + build + 4 spec'а.
6. **Anti-conflict (D-13..16):** `git diff --stat` — только разрешённые файлы.
7. **Runtime-gate (D-17..27) с УСИЛЕННЫМ evidence:**
   - D-17: `docker-compose up -d`.
   - D-18: prisma migrate (если нужно).
   - D-19: mock stub-server `.planning/_scratch/mock-llm-server.mjs` (из §1.5).
   - D-20: API start с env override (см. D-20 env block).
   - D-21..22: create session + start round.
   - **D-23 (главный):** advance → stub-server логирует POST от API.
   - **D-25 (главный):** advance → 200 (transitioned ИЛИ gated, НЕ 500).
   - D-26: GET /events.
   - D-27: negative test (stub-server down → 500 + понятная ошибка).
   - Cleanup.
8. **`9-2-SUMMARY.md`** с evidence для каждого D.

**Оценка:** ~3-5 часов (4 адаптера × 1 строка + ProviderRegistryService + mock stub-server + runtime E2E с docker).

---

## 5. Design notes

1. **Optional `baseUrl?` — backward-compatible.** Нет spec-файлов на адаптеры (verified `find` empty),
   существующие вызовы `new OpenAIAdapter(http, key)` не ломаются. Regression 9-1 (api test/e2e) остаётся green.
2. **Override живёт в app layer (ProviderRegistryService), не в домене.** Адаптеры принимают baseUrl как параметр,
   не читают `process.env` (domain-чистота). ProviderRegistryService — app-layer wiring, читает env.
3. **`process.env.X` без `?? ''`.** `undefined` → адаптер использует default. Пустая строка `''` сломала бы URL
   (`''/chat/completions` → invalid). Не делай `?? ''` для BASE_URL.
4. **Mock stub-server покрывает 2 формата** (OpenAI `/chat/completions` + Gemini `:generateContent`), т.к. первый
   advance (Discover) вызывает critic (openai) + researcher (gemini). GLM/MiMo в Discover не вызываются
   (override добавлен для симметрии + future-prod, но не тестируется в runtime-gate).
5. **Redis + Postgres обязательны** для runtime E2E: Redis — для EventPublisher (RoundStarted/PhaseChanged
   reach GET /events через BullMQ worker → buffer); Postgres — для PrismaSessionStore (create/start/advance).
   Оба из `docker-compose up -d`.
6. **Discover phase = auto-pass в gating.** `gating-policy.ts`: Discover thresholds = undefined → verdict pass
   regardless of consensus metrics. Значит advance на mock-контенте вернёт `transitioned` (Discover → Goal).
   Это не баг — это design (Discover = сбор без жёсткого gating). Главное доказательство — не verdict, а то что
   advance дошёл до Consensus через реальный HTTP (D-23 stub-server log).
7. **Negative test (D-27) обязателен.** Доказывает, что error propagation работает: stub-server down →
   FetchHttpPort throw → advance 500 с понятным сообщением, API не падает. Это закрывает D-9-3 partially.
8. **Mock stub-server НЕ коммитить.** Это verification artifact, не продакшен-код. Живёт в `.planning/_scratch/`
   (если `.gitignore` покрывает) или описан inline в SUMMARY.
9. **Сравнение с 9-1:** 9-1 доставил FetchHttpPort (каркас), но D-16 «доказал» через StubGating (фальшивка).
   9-2 закрывает разрыв: override + реальный runtime-gate. После 9-2 PASS — Wave 9 north-star подтверждён
   объективно, не на словах.

---

## 6. Долги, которые фаза ЗАКРЫВАЕТ

- **D-9-7 (КРИТИЧНЫЙ, блокер Wave 9 exit):** `*_BASE_URL` env override реализован. ProviderRegistryService
  может направить адаптеры на mock (dev) / прокси (prod) / self-hosted endpoint.
- **Подтверждение Wave 9 north-star:** Orchestra реально оживает через HTTP — доказано runtime-gate (D-23/D-25),
  не фальсификацией через StubGating. Wave 9 может закрыться exit.
- **D-9-3 (partially):** error handling доказан negative test (D-27): stub-server down → понятный 500, API не падает.

## 7. Долги, которые фаза НЕ закрывает (переносятся из 9-1)

- **D-9-1:** Real API keys — override готов, осталось вписать ключи (когда owner готов).
- **D-9-2:** Streaming SSE — send() ждёт полный ответ. Wave 9+.
- **D-9-4:** Token/cost tracking persistence — сейчас in-memory. Wave 9+.
- **D-9-5:** Provider fallback (openai down → glm). Wave 9+.
- **D-9-6:** Persist role responses в Round (audit trail LLM outputs). Не блокирует — nice-to-have.

---

## 8. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| Optional `baseUrl?` ломает backward-compat | исключено | Нет spec на адаптеры (verified). TS optional param = existing 2-arg calls работают. D-11/D-12 (api test/e2e) это проверят. |
| Docker/redis/postgres не запускаются на Windows кодера | средняя | 8d-1/8d-2 precedent: docker-compose уже работал. Если блок — owner санкционирует self-execute (Git Bash). |
| PowerShell runtime-тесты ломаются (8d-1 precedent) | средняя | Все runtime-команды через Git Bash. Owner может self-execute. |
| Process zombies (api node + mock server + docker) | средняя | D-29: PID + kill в SUMMARY. `docker-compose down` после. |
| Consensus на mock-контенте ведёт себя непредсказуемо | низкая | Discover = auto-pass (gating-policy). Главное — advance не падает в 500 (D-25). |
| Mock stub-server порт 8088 занят | низкая | Нестандартный порт. Если занят — кодер меняет в `.mjs` + env. |
| `?? ''` по ошибке ломает URL | средняя | §1.3 явно: БЕЗ `?? ''`. D-05 проверяет. |
| Кодер снова «доказывает» через StubGating | низкая | D-23 требует лог stub-server с реальными POST от API. StubGating не вызывает HTTP — лог будет пуст. |

---

## 9. Что получает Orchestra после Phase 9-2

**Wave 9 north-star подтверждён объективно.** Orchestra реально оживает через HTTP:

1. **`*_BASE_URL` override** — production-relevant feature (корпоративный прокси, Azure OpenAI, LocalAI,
   Ollama, self-hosted). Не только dev/testing.
2. **Доказанная LLM-интеграция** — runtime-gate (D-23/D-25) объективно подтверждает: реальный advance
   через RoundOrchestratorGatingAdapter → FetchHttpPort → провайдер → Consensus работает на HTTP-ответах.
3. **Wave 9 может закрыться exit** — D-9-7 (блокер) закрыт, north-star доказан. Остальные долги (D-9-1..6)
   — Wave 9+ roadmap, не блокируют exit.
4. **Честный audit trail** — фальсификация 9-1 (StubGating) исправлена, evidence-rule усилен.

**Phase 9-2 = Wave 9 закрыта.** Real AI collaboration доказана, не на словах.

---

**Конец PLAN 9-2.** Ждёт `/gsd-execute-phase 9-2` (mimo) → `/gsd-validate-phase 9-2`.
После PASS — README-CONTRACT-PHASE-9.md (объединяющий 9-1 PARTIAL + 9-2 PASS) → Wave 9 exit.
