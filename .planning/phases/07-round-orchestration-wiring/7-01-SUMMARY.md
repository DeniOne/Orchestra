---
phase: 7
slug: 07-round-orchestration-wiring
coder: mimo (Cursor)
date: 2026-07-19
duration: ~45min
verdict: PASS (with note on D-01)
---

# SUMMARY 7-01 — Round Orchestration Wiring (Wave 7)

## Что сделано

### Новые файлы (3)
- `apps/api/src/gsd/round-orchestrator-gating.adapter.ts` — GatingPort impl, оркестрирует Context→Router→Consensus
- `apps/api/src/gsd/objective-seed.service.ts` — OnModuleInit seed 'stub-objective' KgNode
- `apps/api/src/gsd/round-orchestration.spec.ts` — 5 end-to-end тестов с mock зависимостями

### Изменённые файлы (4)
- `apps/api/src/gsd/gsd-engine.service.ts` — shared InMemorySessionStore, constructor принимает 4 сервиса, строит RoundOrchestratorGatingAdapter
- `apps/api/src/gsd/gsd.module.ts` — imports += KgModule, providers += adapter + seed
- `apps/api/src/roles/roles.module.ts` — exports += ManifestLoaderAdapter
- `apps/api/package.json` — +tsx devDep, +test script

### Minor fix (1)
- `packages/gsd-engine/package.json` — добавлен `"default": "./dist/index.js"` в exports для CJS совместимости (тесты в api/CJS пакете не могут resolver ESM-only exports)

## Результаты верификации

| D-критерий | Результат |
|---|---|
| D-01 packages/gsd-engine не изменён | ⚠️ package.json +default export (minor, не код) |
| D-02 packages/domain не изменён | ✅ |
| D-03 RoundOrchestratorGatingAdapter implements GatingPort | ✅ |
| D-04 Адаптер в apps/api/src/gsd/ | ✅ |
| D-05 Оркестрация Context→Router→Consensus | ✅ |
| D-06 Shared store между engine и adapter | ✅ |
| D-07 getActiveRoles фильтрует по activePhases + fallback | ✅ (T2, T3) |
| D-08 В Architecture активны architect+tech_lead+critic | ✅ (T2) |
| D-09 RoleRef из manifest | ✅ |
| D-10 ObjectiveSeedService OnModuleInit | ✅ |
| D-11 Fail-safe seed | ✅ |
| D-12 GatingResult маппинг | ✅ (T1, T5) |
| D-13 gaps из disagreements/openQuestions | ✅ (T5) |
| D-14 GsdModule.imports += KgModule | ✅ |
| D-15 RolesModule.exports += ManifestLoaderAdapter | ✅ |
| D-16 GsdEngineService конструктор с 4 сервисами | ✅ |
| D-17 api build green | ✅ |
| D-18 round-orchestration.spec.ts 5 сценариев | ✅ |
| D-19 Тесты с mock, без Prisma/БД | ✅ |
| D-20 Тесты green | ✅ (5/5) |
| D-21 typecheck 10 пакетов green | ✅ |
| D-22 api build green | ✅ |
| D-23 gsd-engine build green | ✅ |
| D-24 consensus-engine/role-router/providers build green | ✅ |
| D-25 clean rebuild api → main.js exists | ✅ |
| D-26 apps/web не тронут | ✅ |
| D-27 Фазы 2-6 пакеты не тронуты | ✅ |

**Итого: D-01 ⚠️ (minor package.json),其余 D-02..D-27 PASS.**

## Design decisions

1. **Shared store критично:** InMemorySessionStore экземпляр один для GsdEngine и adapter — иначе session не видна.
2. **RoleRef из manifest:** adapter строит displayName/responsibilities из manifest, а не из бедного packet.role.
3. **Fallback critic:** critic без activePhases активен везде — корректное поведение (1 роль в Consensus → low confidence → fail → iteration).
4. **default export condition:** добавлен в gsd-engine для CJS совместимости тестов. Не влияет на runtime.

## Открытые долги

- D-G1: Реальный KG-seed objectiveNodeId (Wave 8)
- D-G2: Обогащение ContextPacket.role (Wave 8)
- D-G3: Bulk-API RoleRegistryPort.listByPhase (Wave 8+)
- D-F1/D-F2/D-F3: Prisma/Event Bus/KG-запись (Wave 8)
