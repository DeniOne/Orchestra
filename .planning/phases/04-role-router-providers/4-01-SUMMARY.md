---
phase: 04-role-router-providers
plan: "01"
slice: 04-01
subsystem: agent-layer
tags: [role-router, providers, ai-adapter, tokenization]
requires:
  - phase: phase-03-context-service
    provides: ContextService.buildPacket → ContextPacket
provides:
  - Role Router (dispatch ContextPacket → AIProvider)
  - 4 AIProvider adapters (OpenAI/GLM/Gemini/MiMo)
  - Real tokenization via js-tiktoken (D-C2 closed)
  - 5 role manifests (YAML)
  - NestJS RolesModule + ProvidersModule
affects:
  - gsd-engine (future, Wave 4B)
  - event-bus (future, Wave 5)
tech-stack:
  added:
    - @orchestra/role-router (new package)
    - @orchestra/providers (new package)
    - js-tiktoken ^1
  patterns:
    - Hexagonal ports (RoleRegistryPort, ProviderRegistryPort)
    - AIProviderBase abstract class with HttpPort abstraction
    - MockHttpPort for CI/testing without API keys
    - Stream = chunking over send (real SSE — Wave 5)
    - Role manifests as YAML data files (not code)
key-files:
  created:
    - packages/role-router/package.json
    - packages/role-router/tsconfig.json
    - packages/role-router/src/types.ts
    - packages/role-router/src/role-router.ts
    - packages/role-router/src/index.ts
    - packages/providers/package.json
    - packages/providers/tsconfig.json
    - packages/providers/src/types.ts
    - packages/providers/src/token-counter.ts
    - packages/providers/src/provider-base.ts
    - packages/providers/src/adapters/openai.adapter.ts
    - packages/providers/src/adapters/glm.adapter.ts
    - packages/providers/src/adapters/gemini.adapter.ts
    - packages/providers/src/adapters/mimo.adapter.ts
    - packages/providers/src/registry.ts
    - packages/providers/src/mock-http.ts
    - packages/providers/src/index.ts
    - apps/api/src/providers/provider-registry.service.ts
    - apps/api/src/providers/providers.module.ts
    - apps/api/src/roles/manifest-loader.adapter.ts
    - apps/api/src/roles/role-router.service.ts
    - apps/api/src/roles/roles.module.ts
    - role-manifests/architect.yaml
    - role-manifests/tech_lead.yaml
    - role-manifests/researcher.yaml
    - role-manifests/critic.yaml
    - role-manifests/engineer.yaml
    - .env.example
  modified:
    - apps/api/package.json
    - apps/api/src/app.module.ts
    - pnpm-lock.yaml
key-decisions:
  - "HttpPort hexagonal port — providers don't depend on fetch/network directly"
  - "MockHttpPort as default — pipeline works without API keys"
  - "js-tiktoken for real tokenization (D-C2 closed)"
  - "Stream = chunking over send — valid AsyncIterable<Token> contract, real SSE in Wave 5"
  - "YAML parser inline in ManifestLoaderAdapter — no external yaml dependency in role-router"
  - "Role manifest IDs match context-policy IDs exactly"
patterns-established:
  - "AIProviderBase: abstract send + concrete stream/cancel/estimateTokens/estimateCost/health"
  - "ProviderRegistry with registerWithId/get/list"
  - "RoleRouter.route() validates packet → loads manifest → gets provider → calls send"
  - "No switch on roleId — provider identified via manifest.provider"
requirements-completed:
  - ORCH-04-01
  - ORCH-04-02
  - ORCH-04-03
debts-closed:
  - D-C2
debts-opened:
  - D-D1 (Event Bus publishing)
  - D-D2 (Provider health-check loop)
  - D-D3 (Streaming backpressure / real SSE)
duration: 45min
completed: 2026-07-18
---

# Summary 04-01 — Role Router + Provider Adapters

## Что сделано

1. **packages/providers**: 4 AIProvider адаптера (OpenAI/GLM/Gemini/MiMo) на AIProviderBase с HttpPort. MockHttpPort по умолчанию. js-tiktoken для реальной токенизации (D-C2 закрыт).

2. **packages/role-router**: RoleRouter.route() — валидация пакета → загрузка манифеста → получение провайдера → send. Без switch на roleId.

3. **5 role-manifests/*.yaml**: architect/tech_lead/researcher/critic/engineer.

4. **NestJS**: RolesModule + ProvidersModule в AppModule. ManifestLoaderAdapter с inline YAML парсером.

5. **.env.example**: 4 переменные API ключей (пустые).

## D-критерии (30 штук, все PASS)

| Блок | Статус |
|---|---|
| D-01..D-05 (Architecture/contracts) | PASS — пакеты чистые, domain не изменён |
| D-06..D-11 (Role Router) | PASS — route(), валидация, activePhases, no switch |
| D-12..D-19 (Providers) | PASS — registry, HttpPort, tiktoken, send/stream/cancel/health |
| D-20..D-23 (NestJS) | PASS — modules, app.module, pipeline |
| D-24..D-30 (Build/regression) | PASS — 8 пакетов typecheck + build green |

## Key decisions

- HttpPort = hexagonal порт, MockHttpPort по умолчанию.
- js-tiktoken (WASM) для реальной токенизации.
- Stream = chunking over send (AsyncIterable<Token>).
- Inline YAML parser в адаптере (ядро role-router без runtime-deps).

## Duration

~45 минут.
