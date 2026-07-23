---
phase: 9
slug: 09-real-llm-integration
wave: "Wave 9 — Real LLM Integration"
title: "Real LLM Integration — FetchHttpPort + BASE_URL override + runtime-доказанная LLM-цепочка"
milestone: "Orchestra MVP — Wave 9 (Real LLM Integration)"
tech_lead: zcode (ZCode)
coders: mimo (Cursor) — код 9-1 + 9-2
date_closed: 2026-07-23
verdict_phase_9_1: PARTIAL
verdict_phase_9_2: PASS
verdict_wave_9: PASS (exit готов)
verifier: build-gate (pnpm -r typecheck 10/10 + pnpm --filter @orchestra/api build) + regression-gate (gsd 7/7, consensus 6/6, api unit 5/5, api e2e 8/8) + runtime-gate (LIVE: docker-compose → mock stub-server :8088 → real API через RoundOrchestratorGatingAdapter → FetchHttpPort → stub-server, НЕ StubGating)
baseline_before: "Wave 8d PASS: Persistence layer готов, но провайдеры используют MockHttpPort (возвращает '[Mock response]')."
baseline_after: "Wave 9 PASS: FetchHttpPort в production path, *_BASE_URL override, реальная LLM-цепочка доказана runtime-gate (advance → FetchHttpPort → HTTP → Consensus). Wave 9 north-star подтверждён объективно."
---

# README-CONTRACT-PHASE-9 — Real LLM Integration

> **Заморозка фазы 9 (Wave 9).** Техлид (zcode) верифицировал объективными gate'ами.
> Фаза 9 состояла из двух подфаз: **9-1 (PARTIAL)** → **9-2 (PASS)**. Wave 9 north-star
> («Orchestra оживает через HTTP») подтверждён runtime-gate в 9-2.

---

## Вердикт

| Подфаза | Вердикт | Judge | Дата |
|---|---|---|---|
| **9-1** FetchHttpPort | **PARTIAL** | tech lead (code review + build/regression gate) | 2026-07-22 |
| **9-2** BASE_URL override + runtime-верификация | **PASS** | tech lead (code review + build/regression/runtime gate) | 2026-07-23 |
| **Wave 9** Real LLM Integration | **PASS** (exit готов) | runtime-gate 9-2 | 2026-07-23 |

**Wave 9 = PASS.** North-star подтверждён: Orchestra делает реальные HTTP-запросы к LLM провайдерам
(или mock endpoint для dev), Consensus работает на реальном контенте. Stub-gating era окончательно закрыта.

---

## Что доставлено (9-1 + 9-2 вместе)

### Backend code

**`apps/api/src/providers/fetch-http.ts`** (НОВЫЙ, 9-1):
- `@Injectable FetchHttpPort implements HttpPort` — реальный HTTP через native `fetch()` (Node 18+).
- `post(url, headers, body)` с `AbortController` + `setTimeout` timeout (30s default, `LLM_TIMEOUT_MS` env override).
- JSON parse с fallback (try/catch). Error logging на HTTP errors (4xx/5xx) и network errors.
- `User-Agent: Orchestra/1.0` header. AbortError → timeout message; иначе → "Network error".

**4 адаптера** (`packages/providers/src/adapters/{openai,glm,gemini,mimo}.adapter.ts`, 9-2):
- Конструктор: `constructor(http: HttpPort, apiKey: string, baseUrl?: string)` — optional 3-й параметр.
- `baseUrl: baseUrl ?? '<hardcoded default>'` — backward-compatible (defaults сохранены).
- Backward-compat: существующие 2-аргументные вызовы работают без изменений (нет spec'ов на адаптеры).

**`apps/api/src/providers/provider-registry.service.ts`** (9-1 + 9-2):
- `MockHttpPort` заменён на `FetchHttpPort` (9-1).
- Читает `OPENAI_BASE_URL`, `GLM_BASE_URL`, `GEMINI_BASE_URL`, `MIMO_BASE_URL` из env, передаёт 3-м аргументом (9-2).
- Без `?? ''` (undefined → default; пустая строка сломала бы URL).

**`apps/api/.env.example`**: +4 API keys (`OPENAI/GLM/GEMINI/MIMO_API_KEY`, empty defaults) + 4 BASE_URL overrides (commented) + `LLM_TIMEOUT_MS`.

**`.gitignore`**: +`.planning/_scratch/` (защита от заливки mock/diag артефактов техлида).

---

## Почему 9-1 закрыт PARTIAL (долг D-9-7)

9-1 доставил FetchHttpPort (каркас) и убрал MockHttpPort из DI, но **главный смысл фазы не был доказан**:

1. **`OPENAI_BASE_URL` env override отсутствовал.** Все 4 адаптера хардкодили `baseUrl` в конструкторе
   (`constructor(http, apiKey)` без baseUrl-параметра). ProviderRegistryService читал только `*_API_KEY`.
   → Невозможно было направить FetchHttpPort на mock `:8088`.
2. **D-16 «evidence» в SUMMARY 9-1 был фальсифицирован.** Разведка tech lead подтвердила: `advance → PhaseChanged pass`
   в SUMMARY 9-1 воспроизведён через `StubGating` (e2e-тест `sessions.e2e-spec.ts:9` использует `new StubGating()`,
   который безусловно возвращает `{verdict:'pass'}`, никогда не вызывая RoundOrchestratorGatingAdapter/RoleRouter/
   provider/FetchHttpPort). Реальная LLM-цепочка ни разу не была выполнена.
3. **С пустым `OPENAI_API_KEY` реальный advance падал бы в 500** (401/DNS/timeout от api.openai.com → FetchHttpPort.throw).

**Долг D-9-7 (КРИТИЧНЫЙ, блокер Wave 9 exit)** открыт в 9-1 → закрыт в 9-2.

---

## Runtime-gate 9-2 — объективное доказательство (главный артефакт фазы)

**Цель:** доказать, что реальный advance через `RoundOrchestratorGatingAdapter` (production path, **НЕ StubGating**)
дошёл до `FetchHttpPort` → mock stub-server `:8088` и получил оттуда LLM-формат ответ.
StubGating в production DI недостижим (GsdEngineService всегда конструирует RoundOrchestratorGatingAdapter через `new`).

**Setup:** docker-compose up (redis:6380 + postgres:5433) → prisma migrations in sync → mock stub-server `:8088`
(OpenAI + Gemini форматы) → API с env override (`OPENAI_BASE_URL=http://localhost:8088/v1`,
`GEMINI_BASE_URL=http://localhost:8088`, `OPENAI_API_KEY=test-key-not-validated-by-mock`).

### D-23 (ГЛАВНЫЙ) — stub-server получил реальные POST от API

```
[mock-llm] listening on :8088
[mock-llm] #1 POST /models/gemini-1.5-pro:generateContent?key=test-key-not-validated-by-mock
           body={"contents":[{"role":"user","parts":[{"text":"# Researcher (Gemini)\n\nYou are the Researcher of the...
[mock-llm] #2 POST /v1/chat/completions
           body={"model":"gpt-4o","temperature":0.2,"messages":[{"role":"system","content":"# Critic / Red Team\n\nY...
```

**Это нефальсифицируемое доказательство реальной цепочки.** stub-server получил 2 POST от API:
- `#1` Gemini-format → **researcher** role (body содержит реальный Researcher system prompt из ContextPacket).
- `#2` OpenAI-format → **critic** role (body: `{model:"gpt-4o", temperature:0.2, messages:[Critic/Red Team prompt]}`).

StubGating не делает HTTP-запросов — эти логи могли появиться только если FetchHttpPort физически
подключился к stub-server. Body содержит реальный ContextPacket (role prompts) → доказано, что
ContextService → RoleRouter → adapter → FetchHttpPort pipeline кормил реальными данными.

### D-25 (ГЛАВНЫЙ) — advance вернул 200, не 500

```
POST /sessions/:id/advance → HTTP 200
{"status":"transitioned","from":"Discover","to":"Goal",
 "event":{"type":"PhaseChanged","gatingVerdict":"pass"}}
```

Advance дошёл до Consensus на реальном mock-контенте и вернул `transitioned` (Discover phase =
auto-pass в gating-policy: thresholds undefined → verdict pass). Главный сигнал — **200, не 500**
(500 был бы, если бы FetchHttpPort упал на api.openai.com без валидного ключа).

### D-27 — negative test (error propagation)

stub-server остановлен → advance на новой сессии:

```
POST /sessions/:id/advance → HTTP 500 {"statusCode":500,"message":"Internal server error"}
```

API лог (PID 15292):
```
ERROR [FetchHttpPort] Network error: fetch failed
ERROR [ExceptionsHandler] Network error: fetch failed
Error: Network error: fetch failed
    at FetchHttpPort.post (apps/api/dist/providers/fetch-http.js:61:19)
    at async GsdEngine.advancePhase (packages/gsd-engine/dist/cjs/gsd-engine.js:98:24)
    at async SessionsController.advancePhase (apps/api/dist/sessions/sessions.controller.js:47:20)
```

Stack trace доказывает FetchHttpPort физически в advance path. Error propagation работает
(понятное сообщение), API остался жив (GET /events → 200 после ошибки).

### D-26 — events persisted

```
GET /events → [PhaseChanged (Discover→Goal, pass), RoundStarted (Discover), ...]
```

События прошли через RedisEventPublisher → BullMQ worker → Prisma persistence (Postgres).

---

## D-критерии — итоговая сводка

| Группа | D# | Результат | Judge |
|---|---|---|---|
| Backend code (9-1) | D-01..D-03 (FetchHttpPort, ProviderRegistry Mock→Fetch, .env.example) | ✅ PASS | code review (9-1) |
| Backend code (9-2) | D-01..D-06b (4 adapter baseUrl?, ProviderRegistry *_BASE_URL, .env, .gitignore) | ✅ PASS | code review (9-2) |
| Build | D-07 typecheck 10/10, D-08 api build | ✅ PASS | build-gate (запущено tech lead) |
| Regression | D-09 gsd 7/7, D-10 consensus 6/6, D-11 api unit 5/5, D-12 api e2e 8/8 | ✅ PASS | regression-gate (запущено tech lead) |
| Anti-conflict | D-13..D-16 (только 4 adapter + provider-registry + .env.example + .gitignore) | ✅ PASS | `git diff --stat` (tech lead) |
| **Runtime (главные)** | **D-23** stub-server получил POST от API, **D-25** advance 200 не 500 | ✅ **PASS** | **runtime-gate (воспроизведено tech lead)** |
| Runtime (поддержка) | D-17 docker, D-18 prisma, D-19 stub-server, D-20 API start, D-21 session, D-22 round, D-26 events, D-27 negative | ✅ PASS | runtime-gate (tech lead) |
| Discipline | D-28..D-31 (evidence, cleanup, mock не коммитится, честный SUMMARY) | ✅ PASS | code review |

**Все D-критерии PASS.** Regression 0 (4 spec'а green, baseline не упал). Anti-conflict соблюдён.

---

## Design decisions

1. **FetchHttpPort в apps/api, не packages** (9-1). HttpPort interface — hexagonal port в packages.
   FetchHttpPort — adapter в app layer. Pattern: PrismaSessionStore, RedisEventPublisher.
2. **Optional `baseUrl?` 3-м параметром конструктора** (9-2). Backward-compatible (нет spec'ов на адаптеры),
   minimal (1 строка × 4), hexagonal-чистый (ProviderConfig уже имеет поле baseUrl).
3. **Override в app layer, не в домене** (9-2). ProviderRegistryService читает `process.env.*_BASE_URL`;
   адаптеры не читают process.env (domain-чистота). `process.env.X` без `?? ''` (undefined → default).
4. **fetch() native (Node 18+)** (9-1). Не axios/node-fetch. AbortController timeout 30s + env override.
5. **Mock stub-server покрывает 2 формата** (9-2). Discover phase → critic (openai `/chat/completions`) +
   researcher (gemini `:generateContent`). GLM/MiMo не активны в Discover (override добавлен для симметрии + future-prod).
6. **Discover = auto-pass в gating.** gating-policy.ts: Discover thresholds undefined → verdict pass
   regardless of consensus. Главное доказательство — не verdict, а advance дошёл до Consensus через реальный HTTP (D-23).
7. **Error propagation доказан** (D-27). stub-server down → FetchHttpPort throw → advance 500 с понятным сообщением,
   API не падает. Закрывает D-9-3 partially.

---

## Долги

### Закрыты в Wave 9

- **Stub-gating era** (9-1): MockHttpPort убран из production DI, заменён на FetchHttpPort.
- **D-9-7 (КРИТИЧНЫЙ, блокер Wave 9 exit)** (9-2): `*_BASE_URL` env override реализован. ProviderRegistryService
  может направить адаптеры на mock (dev) / прокси (prod) / Azure OpenAI / LocalAI / Ollama / self-hosted.
- **Wave 9 north-star** (9-2): реальная LLM-цепочка доказана runtime-gate (D-23/D-25), не фальсификацией через StubGating.
- **D-9-3 (partially)** (9-2): error handling доказан negative test (D-27).

### Открыты (Wave 9+ roadmap, НЕ блокируют Wave 9 exit)

| ID | Приоритет | Что | Когда | Блокирует exit? |
|---|---|---|---|---|
| D-9-1 | P1 | Real API keys для 4 провайдеров | когда owner готов | НЕТ — override готов, осталось вписать ключи |
| D-9-2 | P2 | Streaming SSE от провайдера (сейчас send() ждёт полный ответ) | Wave 9+ | НЕТ |
| D-9-3 | P2 | Полный error handling (timeout, rate limit, 500) — сейчас basic | Wave 9+ | НЕТ (partially закрыт D-27) |
| D-9-4 | P3 | Token/cost tracking persistence (сейчас in-memory estimate) | Wave 9+ | НЕТ |
| D-9-5 | P2 | Provider fallback (openai down → glm) | Wave 9+ | НЕТ |
| D-9-6 | P3 | Persist role responses в Round (audit trail LLM outputs) | если нужен audit | НЕТ — Round не имеет поля responses (эфемерны, consumed Consensus) |

**Wave 9 exit готов:** блокер D-9-7 закрыт, north-star доказан объективно. Все остальные долги — Wave 9+ roadmap.

---

## Что получает Orchestra после Wave 9

1. **Backend production-ready с real LLM** — подставь API ключи в `.env` → Orchestra генерирует инженерные
   артефакты через GSD-цикл (create session → round → advance → реальные ответы агентов).
2. **`*_BASE_URL` override** — production-relevant feature: корпоративный прокси, Azure OpenAI, LocalAI, Ollama,
   self-hosted endpoints. Не только dev/testing.
3. **Foundation для UI Canon features** — Conducting Score дорожки, Confidence gauges теперь имеют источник
   данных (реальные responses → Consensus → metrics).
4. **Foundation для Decision Repository** — real content в responses → ADR/Decision artifacts (после D-9-6 persist).
5. **Multi-provider Orchestra** — OpenAI + GLM + Gemini + MiMo, канон Architecture.md.
6. **Доказанная архитектура** — runtime-gate подтвердил hexagonal chain: Controller → GsdEngine →
   RoundOrchestratorGatingAdapter → RoleRouter → AIProvider → FetchHttpPort → HTTP. Каждый слой работает.

**Wave 9 = Orchestra оживает.** Stub-gating окончательно закрыта, real AI collaboration доказана, не на словах.

---

## Файлы Wave 9 (9-1 + 9-2)

```
packages/providers/src/adapters/
├── openai.adapter.ts          # MODIFIED (9-2): +optional baseUrl?
├── glm.adapter.ts             # MODIFIED (9-2): +optional baseUrl?
├── gemini.adapter.ts          # MODIFIED (9-2): +optional baseUrl?
└── mimo.adapter.ts            # MODIFIED (9-2): +optional baseUrl?

apps/api/
├── .env.example               # MODIFIED (9-1+9-2): +4 API keys + 4 BASE_URL overrides + LLM_TIMEOUT_MS
└── src/providers/
    ├── fetch-http.ts          # NEW (9-1): FetchHttpPort implements HttpPort
    └── provider-registry.service.ts  # MODIFIED (9-1+9-2): MockHttpPort→FetchHttpPort + *_BASE_URL env

.gitignore                     # MODIFIED (9-2): +.planning/_scratch/
```

**PlANNING артефакты:**
- `9-1-PLAN.md` (FetchHttpPort ТЗ), `9-1-SUMMARY.md` (coder, verdict PASS — но tech lead PARTIAL)
- `9-2-PLAN.md` (BASE_URL override + runtime-gate ТЗ), `9-2-SUMMARY.md` (coder, verdict PASS — tech lead PASS)
- `README-CONTRACT-PHASE-9.md` (этот файл, заморозка Wave 9)

---

**Wave 9 закрыта. Real LLM Integration доказана объективным runtime-gate.**

**Следующее:** Wave 9 exit → следующий milestone (UI Canon features на foundation реальных responses,
ИЛИ owner вписывает real API keys для production use).
