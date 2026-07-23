---
phase: 10
slug: 10-real-providers-model-routing
title: "Model Routing Fix + Real Provider Keys"
coder: mimo (Cursor)
date: 2026-07-23
status: PARTIAL
verdict: "PARTIAL — design-fix code PASS (D-01..D-25), build+regression PASS (D-15..D-20), runtime-gate PENDING (D-26..D-32 — owner/tech lead с ключами)"
---

# SUMMARY 10-01 — Model Routing Fix + Real Provider Keys

## Что сделано

Design-fix model routing + wiring manifests на реальные model IDs. `manifest.model` теперь
авторитетный источник (как и задумано архитектурой): YAML model → `BuildPacketRequest.model` →
`packet.modelTarget` → `adapter.body.model`.

## Изменения (13 файлов)

### D-01. `packages/context-service/src/types.ts`
`BuildPacketRequest` + `model?: string` опциональное поле.

### D-02. `packages/context-service/src/packet-builder.ts:39`
`const modelTarget = req.model ?? resolveModelTarget(req.roleId);`
`resolveModelTarget()` сохранена как deprecation fallback (НЕ удалена).

### D-03. `packages/providers/src/adapters/openai.adapter.ts:23`
`model: packet.modelTarget ?? this.cfg.defaultModel`

### D-04. `packages/providers/src/adapters/glm.adapter.ts:23`
`model: packet.modelTarget ?? this.cfg.defaultModel`

### D-05. `packages/providers/src/adapters/mimo.adapter.ts:23`
`model: packet.modelTarget ?? this.cfg.defaultModel`

### D-06. `packages/providers/src/adapters/gemini.adapter.ts:30`
URL model: `${packet.modelTarget ?? this.cfg.defaultModel}`

### D-07. `apps/api/src/gsd/round-orchestrator-gating.adapter.ts:33-41`
`model: manifest.model` в buildPacket вызове.

### D-08..D-12. role-manifests/*.yaml
| Файл | provider (было → стало) | model (было → стало) |
|---|---|---|
| architect.yaml | openai (без изменений) | gpt-4o → anthropic/claude-3.5-sonnet |
| critic.yaml | openai (без изменений) | gpt-4o → anthropic/claude-3.5-sonnet |
| engineer.yaml | mimo (без изменений) | mimo-7b → mimo-v2.5-pro |
| researcher.yaml | gemini → openai | gemini-1.5-pro → google/gemini-2.0-flash |
| tech_lead.yaml | glm → openai | glm-4-plus → anthropic/claude-3.5-sonnet |

### D-13. `apps/api/.env.example`
BASE_URL overrides как активные commented examples (OpenRouter + MiMo endpoint).

## D-критерии верификация

### Design-fix (D-01..D-13): ✅ PASS
Все точечные правки выполнены точно по PLAN.

### Anti-conflict (D-21..D-25): ✅ PASS
```
git diff --stat:
 apps/api/.env.example                                 | 15 ++++++++-------
 apps/api/src/gsd/round-orchestrator-gating.adapter.ts |  1 +
 packages/context-service/src/packet-builder.ts        |  2 +-
 packages/context-service/src/types.ts                 |  2 ++
 packages/providers/src/adapters/gemini.adapter.ts     |  2 +-
 packages/providers/src/adapters/glm.adapter.ts        |  2 +-
 packages/providers/src/adapters/mimo.adapter.ts       |  2 +-
 packages/providers/src/adapters/openai.adapter.ts     |  2 +-
 role-manifests/architect.yaml                         |  2 +-
 role-manifests/critic.yaml                            |  2 +-
 role-manifests/engineer.yaml                          |  2 +-
 role-manifests/researcher.yaml                        |  4 ++--
 role-manifests/tech_lead.yaml                         |  4 ++--
 13 files changed, 23 insertions(+), 19 deletions(-)
```

Только разрешённые файлы. Запрещённые зоны (gsd-engine, consensus-engine, role-router,
knowledge-graph, domain, prompt-registry, docker-compose, Prisma, apps/web, prompts, docs) — 0 изменений.

### Build + Regression (D-15..D-20): ✅ PASS

| D | Критерий | Результат |
|---|---|---|
| D-15 | `pnpm -r typecheck` | ✅ 10/10 packages green |
| D-16 | `pnpm --filter @orchestra/api build` | ✅ green |
| D-17 | `pnpm --filter @orchestra/gsd-engine test` | ✅ 7/7 pass |
| D-18 | `pnpm --filter @orchestra/consensus-engine test` | ✅ 6/6 pass |
| D-19 | `pnpm --filter @orchestra/api test` | ✅ 5/5 pass |
| D-20 | `pnpm --filter @orchestra/api test:e2e` | ✅ 8/8 pass |

### Security (D-35): ✅ PASS
- `apps/api/.env` — gitignored (`git check-ignore` confirmed), не в git.
- `.env.example` —不含 реальных ключей (verified).

### Runtime-gate (D-26..D-32): ⏳ PENDING
Runtime-gate требует реальных API-ключей в `apps/api/.env`. Кодер не имеет ключей (security).
**Owner/tech lead** должен:
1. Создать `apps/api/.env` с реальными ключами (OPENAI_API_KEY=OpenRouter key, MIMO_API_KEY=MiMo key).
2. Запустить `docker-compose up -d` (redis :6380 + postgres :5433).
3. Запустить API: `pnpm --filter @orchestra/api start:dev`.
4. Прогнать runtime-gate: create session → start round → advance → проверить 200 + реальный контент.
5. Проверить D-31: ответ НЕ '[Mock response]', НЕ stub-формат — осмысленный контент от живой модели.

## Долги

### Закрывает
- **D-10 (КРИТИЧНЫЙ):** мёртвый manifest.model → designed data flow починен.
- **D-9-1:** реальные model IDs в манифестах (подготовка к wiring ключей).

### Открывает
- **D-10-1:** GLM баланс 0 — owner decision.
- **D-10-2:** per-role model tuning (после первых живых прогонов).
- **D-10-3:** cleanup мёртвой `resolveModelTarget` таблицы (deprecation → удаление).

## Что дальше

1. Owner/tech lead → runtime-gate (D-26..D-32) с реальными ключами.
2. Если runtime-gate PASS → `/gsd-validate-phase 10` → README-CONTRACT.
3. Если runtime-gate FAIL (модель/ключ/baseURL невалидны) → RCA → фикс → retry.

---

**Конец SUMMARY 10-01.** Design-fix code PASS. Runtime-gate PENDING (owner/tech lead с ключами).
