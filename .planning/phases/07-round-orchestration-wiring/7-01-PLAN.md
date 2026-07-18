---
phase: 7
slug: 07-round-orchestration-wiring
wave: B-7
title: "Round Orchestration Wiring (Wave 7) — реальная связка Context→Router→Consensus в advancePhase"
milestone: "Orchestra MVP — Wave 7 (Round Orchestration)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-19
status: PASS
verifier: build-gate (pnpm -r typecheck + pnpm -r build, 10 пакетов green) + spec-gate (round-orchestration.spec.ts, end-to-end advancePhase с реальной wiring)
baseline_before: "Phase 6 заморожена PASS (34/34, commit 42a0c56): GsdEngine FSM работает со StubGating, 10 пакетов typecheck green, pipeline узлы (Context/RoleRouter/Consensus) изолированы"
depends_on:
  - "Phase 6 (GsdEngine.advancePhase → GatingPort.evaluate — точка wiring)"
  - "Phase 5 (ConsensusService.run → ConsensusReport{gatingVerdict})"
  - "Phase 4 (RoleRouterService.route + MockHttpPort — детерминированный stub провайдеров)"
  - "Phase 3 (ContextService.buildPacket)"
  - "Phase 2 (KgService — для seed-objective узла)"
closes_debts:
  - "D-F4 (реальная wiring GatingPort → Context→Router→Consensus)"
opens_debts_expected:
  - "D-G1: Реальный KG-seed objectiveNodeId (MVP = stub-objective seed-узел) — Wave 8 с UI"
  - "D-G2: Обогащение ContextPacket.role (сейчас displayName=roleId, responsibilities=[]) — Wave 8"
  - "D-G3: Bulk-API RoleRegistryPort.listByPhase (сейчас N вызовов get()) — Wave 8+ при масштабировании"
---

# PLAN 7-01 — Round Orchestration Wiring (Wave 7)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `7-01-SUMMARY.md`. Tech Lead делает code review против `must_haves.truths` ниже.

## 0. Контекст фазы (почему и что)

Phase 6 заморозила GsdEngine runtime (PASS 34/34). GsdEngine.advancePhase управляет FSM фаз,
но работает со **StubGating** (always pass) — то есть Orchestra имеет FSM + 4 изолированных
pipeline-узла (Context, RoleRouter, Consensus, Providers), которые **никто не связывает в
реальный раунд**. Это главная функциональная дыра: advancePhase не вызывает Context/Router/
Consensus, gating verdict всегда pass.

Phase 7 = **закрытие этой дыры** (долг D-F4 из Phase 6). После Phase 7 advancePhase РЕАЛЬНО
оркестрирует раунд: для каждой активной роли фазы → buildPacket → route → собрать Response[] →
ConsensusEngine.run → вернуть настоящий gating verdict. FSM начинает работать на реальном
(хоть и stub-MockHttpPort) LLM-pipeline.

### Ключевое инвариантное свойство (Architecture.md §3, §4)

> «GSD Engine запрашивает у Context Service пакет для каждой целевой роли → Role Router
> диспетчеризует → провайдеры возвращают ответы → Consensus Engine собирает отчёт.»

Phase 7 материализует поток одного раунда (Architecture.md §4 шаги 3-9) как детерминированную
оркестрацию внутри GatingPort-адаптера. Важно: **сам GsdEngine (пакет) НЕ меняется** — wiring
происходит через реализацию порта `GatingPort` в NestJS-слое. Это предусмотрено PLAN Phase 6
(D-F4, design note #3): «Wave 7 подставит реальный адаптер → ConsensusService.run(). Развязка
чистая».

### Owner-решения (2 fork'а, зафиксированы через AskUserQuestion)

1. **objectiveNodeId:** Stub — seed-узел `'stub-objective'` в KG через `KgService.createNode`
   при инициализации. Реальный KG-seed (когда дирижёр создаёт цель через UI) → Wave 8, долг D-G1.
2. **Consensus phase coverage:** Принять fallback critic (у critic нет `activePhases` →
   `assertActivePhase` в role-router пропускает проверку → critic активен везде, включая
   Consensus). На фазе Consensus critic даст 1 response → низкий confidence → fail → iteration.
   Это **корректное поведение FSM** (Consensus требует консенсуса ролей, 1 роль = мало).
   Manifests НЕ трогаем.

### Что закрывает фаза

- `apps/api/src/gsd/round-orchestrator-gating.adapter.ts` — реализация `GatingPort`,
  оркестрирующая Context→Router→Consensus.
- Seed `stub-objective` KgNode (через `OnModuleInit` или seed-метод).
- Расширение `RolesModule.exports` (+ `ManifestLoaderAdapter`).
- `gsd-engine.service.ts` — конструктор принимает Context/RoleRouter/Consensus/ManifestLoader,
  передаёт адаптер в `new GsdEngine({ gating: adapter })`.
- `round-orchestration.spec.ts` — end-to-end тест advancePhase с реальной wiring (MockHttpPort).

### Что НЕ в scope (забор на Wave 8+)

- **Реальный KG-seed objective** (когда UI позволяет дирижёру создать цель) → долг **D-G1**.
- **Обогащение ContextPacket.role** (сейчас `displayName=roleId, responsibilities=[]` в
  `packet-builder.ts:46`) → долг **D-G2**. Для wiring не критично — RoleRef строится из manifest
  в адаптере, не из packet.role.
- **Bulk-API `RoleRegistryPort.listByPhase(phase)`** (сейчас N вызовов `get()`) → долг **D-G3**.
- **Event Bus публикация** (RoundStarted/PhaseChanged/AgentInvoked/AgentResponded) → D-F2, Wave 8.
- **HTTP API + UI Conducting Score** → Wave 8/9.
- **Персистенция Session** (Prisma) → D-F1, Wave 8.
- **Реальные LLM-вызовы** (сейчас MockHttpPort) → когда появятся API-ключи, отдельная фаза.

---

## 1. Архитектурное решение (главное)

**Wiring в NestJS-слое (`apps/api/src/gsd/`), через новый адаптер, реализующий существующий
`GatingPort`. Пакет `gsd-engine` НЕ трогать** (hexagonal-чистый, заморожен Phase 6).

Обоснование:
- `packages/gsd-engine` — чистый от `@nestjs`, dep только `@orchestra/domain`. Это инвариант.
- `GatingPort` (`packages/gsd-engine/src/types.ts:19-21`) — узкий порт
  `evaluate(sessionId, phase) → GatingResult`. Его не нужно расширять — он уже подходит.
- NestJS-слой имеет доступ к DI (ContextService, RoleRouterService, ConsensusService,
  ManifestLoaderAdapter, KgService). Адаптер реализует GatingPort, оркестрируя три сервиса.
- Это точно то, что предусмотрел PLAN Phase 6 (D-F4, design note #3, файл-плейсхолдер
  `gating.adapter.ts`).

**Альтернативы отвергаются:**
- Расширить GatingPort в пакете → сломает контракт + замороженный gsd-engine.
- Делать wiring в самом GsdEngine → нарушит hexagonal (пакет не должен знать о NestJS-сервисах).
- Ввести RoundOrchestratorPort в пакете → избыточно, GatingPort уже подходит.

---

## 2. Целевая структура (файлы, которые создаёт кодер)

```
apps/api/src/
├── gsd/                                        # РАСШИРЕНИЕ существующего модуля
│   ├── gsd-engine.service.ts                   # ИЗМЕНИТЬ: конструктор принимает 4 сервиса, строит адаптер
│   ├── gsd.module.ts                           # ИЗМЕНИТЬ: imports += KgModule (для seed); providers += adapter
│   ├── round-orchestrator-gating.adapter.ts    # НОВЫЙ: GatingPort impl, оркестрация Context→Router→Consensus
│   └── objective-seed.service.ts               # НОВЫЙ: OnModuleInit — seed 'stub-objective' KgNode
│
├── roles/
│   └── roles.module.ts                         # ИЗМЕНИТЬ: exports += ManifestLoaderAdapter

# ПАКЕТ gsd-engine НЕ ТРОГАТЬ (заморожен Phase 6)
# domain НЕ ТРОГАТЬ (заморожен Phase 6 расширением)
# context-service, role-router, providers, consensus-engine НЕ ТРОГАТЬ (фазы 3-5)
```

### Файлы, которые НЕ трогать (anti-conflict)

| Зона | Почему | Проверка |
|---|---|---|
| `packages/gsd-engine/**` | Phase 6 заморожена. GatingPort уже подходящий порт | `git diff packages/gsd-engine/` → пусто |
| `packages/domain/src/**` | Phase 6 расширение заморожено | `git diff packages/domain/` → пусто |
| `packages/{context-service,role-router,providers,consensus-engine,prompt-registry,knowledge-graph}/src/` | Фазы 2-5 заморожены | `git diff` → пусто по каждой |
| `apps/web/` | Frontend — Wave 9 | `git diff apps/web/` → пусто |
| `docs/**` | Канон | `git diff docs/` → пусто |
| `role-manifests/`, `prompts/` | Seed-данные (Consensus coverage = fallback critic, не трогать) | `git diff` → пусто |
| `.planning/phases/0[1-6]/` | Замороженные фазы | `git diff` → пусто |
| `tsconfig.base.json`, `pnpm-workspace.yaml` | Корневой конфиг | `git diff` → пусто |

**Единственные изменения:**
- `apps/api/src/gsd/gsd-engine.service.ts` — конструктор + wiring
- `apps/api/src/gsd/gsd.module.ts` — imports KgModule, providers adapter + seed
- `apps/api/src/gsd/round-orchestrator-gating.adapter.ts` — НОВЫЙ
- `apps/api/src/gsd/objective-seed.service.ts` — НОВЫЙ
- `apps/api/src/roles/roles.module.ts` — exports += ManifestLoaderAdapter

---

## 3. round-orchestrator-gating.adapter.ts (главный файл фазы)

```typescript
import { Injectable } from '@nestjs/common';
import type { GatingPort, GatingResult } from '@orchestra/gsd-engine';
import type { GSDPhase, RoleRef } from '@orchestra/domain';
import type { SessionStorePort } from '@orchestra/gsd-engine';
import { ContextService } from '../context/context.service.js';
import { RoleRouterService } from '../roles/role-router.service.js';
import { ConsensusService } from '../consensus/consensus.service.js';
import { ManifestLoaderAdapter } from '../roles/manifest-loader.adapter.js';

/**
 * Реализация GatingPort через реальную оркестрацию раунда (D-F4 closure).
 *
 * Поток (Architecture.md §4 шаги 3-9):
 *   1. Загрузить session + последний Round текущей фазы
 *   2. Отфильтровать роли, активные в phase (manifest.activePhases.includes(phase),
 *      либо fallback — нет activePhases = активна везде, см. critic)
 *   3. Для каждой роли: ContextService.buildPacket → RoleRouterService.route → RoleResponse
 *   4. ConsensusService.run({ roundId, phase, responses }) → ConsensusReport
 *   5. Маппинг report.gatingVerdict → GatingResult.verdict; gaps из report
 *
 * НЕ пишет в KG (D-F3, Wave 8). НЕ публикует события (D-F2, Wave 8).
 * Responses ephemeral — не хранятся в Session (ConsensusReport агрегирует всё).
 */
@Injectable()
export class RoundOrchestratorGatingAdapter implements GatingPort {
  constructor(
    private readonly context: ContextService,
    private readonly router: RoleRouterService,
    private readonly consensus: ConsensusService,
    private readonly roles: ManifestLoaderAdapter,
    private readonly store: SessionStorePort,
  ) {}

  async evaluate(sessionId: string, phase: GSDPhase): Promise<GatingResult> {
    // 1. Session + последний Round текущей фазы
    const session = await this.store.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    const round = this.findCurrentRound(session, phase);
    if (!round) {
      // Нет активного раунда — возвращаем fail с явным gap
      return { verdict: 'fail', gaps: ['no active round for phase'], phase };
    }

    // 2. Роли, активные в phase
    const activeRoles = await this.getActiveRoles(phase);

    // 3. Для каждой роли: packet → route → RoleResponse
    const responses: { role: RoleRef; response: Response }[] = [];
    for (const manifest of activeRoles) {
      const packet = await this.context.buildPacket({
        sessionId,
        projectId: session.projectId,
        roundId: round.id,
        roleId: manifest.id,
        objective: session.name,                    // MVP: objective = session name
        objectiveNodeId: 'stub-objective',          // D-G1: seed-узел, Wave 8 = реальный
        phase,
      });
      const { response } = await this.router.route({ packet });
      const roleRef: RoleRef = {
        id: manifest.id,
        displayName: manifest.displayName,          // обогащение из manifest (D-G2 — packet.role бедный)
        responsibilities: manifest.responsibilities,
      };
      responses.push({ role: roleRef, response });
    }

    // 4. Consensus
    const report = await this.consensus.run({
      roundId: round.id,
      phase,
      responses,
    });

    // 5. Маппинг → GatingResult
    return {
      verdict: report.gatingVerdict,
      gaps: extractGaps(report),
      phase,
    };
  }

  private findCurrentRound(session, phase) {
    // Последний Round с phase===session.currentPhase (он же — текущий)
    const rounds = session.rounds.filter((r) => r.phase === phase);
    return rounds[rounds.length - 1] ?? null;
  }

  private async getActiveRoles(phase: GSDPhase): Promise<RoleManifest[]> {
    const roleIds = await this.roles.list();
    const manifests: RoleManifest[] = [];
    for (const id of roleIds) {
      const m = await this.roles.get(id);
      if (!m) continue;
      // Fallback: нет activePhases = активна везде (critic). Иначе — проверка includes.
      const active = !m.activePhases || m.activePhases.length === 0 || m.activePhases.includes(phase);
      if (active) manifests.push(m);
    }
    return manifests;
  }
}

/** Извлечение gap'ов из ConsensusReport для gating message. */
function extractGaps(report): string[] {
  // При fail — список метрик ниже порога. ConsensusReport.nextAction при fail содержит
  // 'iterate: gaps in ...'. Парсим ИЛИ строим из disagreements + openQuestions.
  const gaps: string[] = [];
  if (report.disagreements.length > 0) gaps.push(`${report.disagreements.length} disagreement(s)`);
  if (report.openQuestions.length > 0) gaps.push(`${report.openQuestions.length} open question(s)`);
  return gaps;
}
```

> **Типы:** `RoleManifest`, `Response` импортировать из `@orchestra/domain`. `SessionStorePort`
> — из `@orchestra/gsd-engine`. Адаптер должен иметь ССЫЛКУ на тот же store, что и GsdEngine
> (иначе session, созданный GsdEngine, не виден адаптеру). См. §4.

---

## 4. gsd-engine.service.ts (wiring точка)

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { GsdEngine, InMemorySessionStore, InMemoryAuditLog } from '@orchestra/gsd-engine';
import type { AdvancePhaseResult, SessionStorePort } from '@orchestra/gsd-engine';
import type { Session, Round, SessionId } from '@orchestra/domain';
import { ContextService } from '../context/context.service.js';
import { RoleRouterService } from '../roles/role-router.service.js';
import { ConsensusService } from '../consensus/consensus.service.js';
import { ManifestLoaderAdapter } from '../roles/manifest-loader.adapter.js';
import { RoundOrchestratorGatingAdapter } from './round-orchestrator-gating.adapter.js';

@Injectable()
export class GsdEngineService implements OnModuleInit {
  private readonly store = new InMemorySessionStore();   // ШАРЯТ между engine и adapter
  private readonly audit = new InMemoryAuditLog();
  private readonly engine: GsdEngine;

  constructor(
    private readonly context: ContextService,
    private readonly router: RoleRouterService,
    private readonly consensus: ConsensusService,
    private readonly roles: ManifestLoaderAdapter,
  ) {
    const gating = new RoundOrchestratorGatingAdapter(context, router, consensus, roles, this.store);
    this.engine = new GsdEngine({ store: this.store, gating, audit: this.audit });
  }

  // ... startSession/startRound/advancePhase/approveTransition/overrideGate/getSession/listRounds
  // (прокси в this.engine — без изменений относительно Phase 6)
}
```

**Критично:** `store` — **тот же экземпляр** InMemorySessionStore, что передаётся в GsdEngine
И в RoundOrchestratorGatingAdapter. Иначе адаптер не найдёт session, созданную GsdEngine.
Поэтому store создаётся в GsdEngineService (поле класса), передаётся обоим.

---

## 5. objective-seed.service.ts (D-G1 stub)

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { KgService } from '../kg/kg.service.js';

/**
 * Seeds the 'stub-objective' KgNode required by buildPacket (D-G1).
 * Wave 8: replace with real objective creation via UI.
 */
@Injectable()
export class ObjectiveSeedService implements OnModuleInit {
  private readonly logger = new Logger(ObjectiveSeedService.name);

  constructor(private readonly kg: KgService) {}

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.kg.getNode('stub-objective');
      if (existing) return;  // idempotent
      await this.kg.createNode({
        type: 'Goal',
        title: 'stub-objective',
        description: 'MVP seed objective (D-G1). Wave 8: real objective via UI.',
      });
      this.logger.log('Seeded stub-objective KgNode');
    } catch (e) {
      // Prisma/БД может быть недоступна — логируем, не падаем (wiring tests используют mock)
      this.logger.warn(`Could not seed stub-objective: ${(e as Error).message}`);
    }
  }
}
```

> **Idempotent + fail-safe:** если БД недоступна (нет PostgreSQL в dev), seed логирует warn и
> не падает. End-to-end тесты используют mock ContextService/RoleRouter/Consensus напрямую,
> не требуют реальной БД (см. §7).

---

## 6. gsd.module.ts + roles.module.ts

```typescript
// apps/api/src/gsd/gsd.module.ts
import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { ContextModule } from '../context/context.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { GsdEngineService } from './gsd-engine.service.js';
import { RoundOrchestratorGatingAdapter } from './round-orchestrator-gating.adapter.js';
import { ObjectiveSeedService } from './objective-seed.service.js';

@Module({
  imports: [KgModule, ContextModule, RolesModule, ConsensusModule],
  providers: [GsdEngineService, RoundOrchestratorGatingAdapter, ObjectiveSeedService],
  exports: [GsdEngineService],
})
export class GsdModule {}
```

```typescript
// apps/api/src/roles/roles.module.ts — ИЗМЕНИТЬ exports
@Module({
  imports: [ProvidersModule],
  providers: [ManifestLoaderAdapter, RoleRouterService],
  exports: [RoleRouterService, ManifestLoaderAdapter],  // + ManifestLoaderAdapter
})
export class RolesModule {}
```

---

## 7. Тестовый сьют (часть verifier'а)

`apps/api/src/gsd/round-orchestration.spec.ts` — end-to-end тест wiring.

> **Проблема тестирования:** RoundOrchestratorGatingAdapter зависит от NestJS-сервисов
> (ContextService → Prisma, и т.д.). End-to-end через NestJS DI требует поднятой БД.
> **Решение:** тестировать адаптер с **mock/in-memory зависимостями**, как Phase 4 MockHttpPort:
> - InMemorySessionStore (есть в пакете) для store
> - Stub `ContextService`-like (inline, возвращает тестовый ContextPacket)
> - Stub `RoleRouterService`-like (возвращает тестовый Response)
> - Реальный `ConsensusService` (он без БД, deterministic) ИЛИ stub
>
> Это повторяет канон: тестируем логику wiring (порядок вызовов, сбор RoleResponse[], маппинг
> verdict), а не infra. Альтернатива (NestJS TestingModule + mock всех провайдеров) — тяжелее,
> опциональна.

```typescript
// apps/api/src/gsd/round-orchestration.spec.ts (минимум 4 сценария)
describe('RoundOrchestratorGatingAdapter', () => {
  // T1: evaluate с 2 ролями в фазе → вызывает buildPacket × 2, route × 2, consensus.run × 1
  //     возвращает GatingResult{verdict: report.gatingVerdict}. Проверка счётчиков вызовов.

  // T2: фильтр ролей по phase — в фазе Architecture активны architect+tech_lead (не researcher,
  //     не engineer). Проверка: route вызван ровно 2 раза.

  // T3: fallback critic — critic без activePhases активен в любой phase. В фазе Consensus
  //     только critic → 1 response → ConsensusEngine confidence низкий → verdict='fail'
  //     (корректное поведение FSM).

  // T4: нет активного раунда для phase → verdict='fail', gaps=['no active round for phase'].

  // T5 (опц.): маппинг ConsensusReport → GatingResult — verdict и gaps корректны.
});
```

> **Test-script:** `"test": "node --import tsx --test test/round-orchestration.spec.ts"` — НО
> это в apps/api, где нет test-скрипта. Варианты: (а) добавить script в `apps/api/package.json`,
> (б) держать spec в `apps/api/src/gsd/` и запускать через `npx tsx --test`. Кодер выбирает,
>prefer (а) для канона. См. D-26 ниже.

---

## 8. must_haves.truths (D-критерии для code review)

### Архитектура / wiring

- **D-01** `packages/gsd-engine/` НЕ изменён (anti-conflict Phase 6).
  `git diff packages/gsd-engine/` → пусто.
- **D-02** `packages/domain/` НЕ изменён (anti-conflict Phase 6).
  `git diff packages/domain/` → пусто.
- **D-03** `RoundOrchestratorGatingAdapter implements GatingPort` (из `@orchestra/gsd-engine`).
  Не расширяет GatingPort, не вводит новый порт.
- **D-04** Адаптер в `apps/api/src/gsd/` (NestJS-слой), НЕ в пакете gsd-engine.
- **D-05** Адаптер оркестрирует: ContextService.buildPacket → RoleRouterService.route →
  ConsensusService.run, в указанном порядке (Architecture.md §4 шаги 3-9).
- **D-06** Store — **тот же экземпляр** InMemorySessionStore в GsdEngine и в адаптере
  (поле класса GsdEngineService, передаётся обоим). Иначе session не видна.

### Роли / фильтр по фазе

- **D-07** `getActiveRoles(phase)` фильтрует по `manifest.activePhases.includes(phase)` с
  fallback (нет activePhases = активна везде, critic).
- **D-08** В фазе Architecture активны architect + tech_lead (route вызывается 2 раза).
  researcher/engineer/critic — НЕ активны (их activePhases не включают Architecture; critic
  имеет fallback, но его нет в Architecture... **уточнить:** critic без activePhases = активен
  ВЕЗДЕ, значит в Architecture тоже). Кодер: проверить, что fallback работает как описано.
- **D-09** RoleRef для RoleResponse строится из manifest (`displayName`, `responsibilities`),
  НЕ из бедного `packet.role`.

### objectiveNodeId seed

- **D-10** `ObjectiveSeedService implements OnModuleInit`, при старте создаёт KgNode
  `'stub-objective'` type='Goal'. Idempotent (проверяет существование).
- **D-11** Fail-safe: если БД недоступна, логирует warn, НЕ падает (wiring тесты не требуют БД).

### Consensus маппинг

- **D-12** `evaluate` возвращает `GatingResult{ verdict: report.gatingVerdict, gaps, phase }`.
- **D-13** gaps извлекаются из ConsensusReport (disagreements/openQuestions count или nextAction).

### NestJS integration

- **D-14** `GsdModule.imports` += KgModule (для ObjectiveSeedService).
- **D-15** `RolesModule.exports` += ManifestLoaderAdapter.
- **D-16** `GsdEngineService` конструктор принимает ContextService/RoleRouterService/
  ConsensusService/ManifestLoaderAdapter.
- **D-17** `api build` green с wiring (NestJS DI резолвится).

### Тесты

- **D-18** `round-orchestration.spec.ts` существует, минимум 4 сценария (T1-T4).
- **D-19** Тесты используют mock/stub зависимости (не требуют Prisma/БД). Pure.
- **D-20** Test runnable: `node --import tsx --test <path>` → green.

### Build / регрессия

- **D-21** `pnpm -r typecheck` → 10 пакетов green. Exit 0.
- **D-22** `pnpm --filter @orchestra/api build` → green. Exit 0.
- **D-23** `pnpm --filter @orchestra/gsd-engine build` → green (Phase 6 не сломана).
- **D-24** `pnpm --filter @orchestra/consensus-engine build` + role-router + providers → green.
- **D-25** Clean rebuild api: `rm -rf apps/api/dist && build` → `apps/api/dist/main.js` exists.
- **D-26** `apps/web/` не тронут (git status пуст).
- **D-27** Фазы 2-6 пакеты не тронуты (`git diff` по всем packages/ кроме ничего → пусто).

---

## 9. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-27 PASS.
2. `pnpm -r typecheck` + build 10 пакетов green.
3. `round-orchestration.spec.ts` → 4/4+ green.
4. Anti-conflict: `git diff` по всем замороженным зонам → пусто.
5. **Pipeline исполняем end-to-end:** `startSession → startRound → advancePhase` РЕАЛЬНО
   вызывает Context→Router→Consensus, advancePhase возвращает verdict из ConsensusReport
   (не stub pass).

**Фаза НЕ выполнена, если:**
- Wiring в пакете gsd-engine (D-01 FAIL) — ломает hexagonal.
- Store не shared между engine и adapter (D-06 FAIL) — session не видна.
- Тесты требуют БД (D-19 FAIL) — нарушает testability канон.
- build/typecheck красный (D-21..D-24 FAIL).

---

## 10. Порядок работы кодера

1. **Прочитать** `packages/gsd-engine/src/types.ts` (GatingPort/GatingResult),
   `packages/gsd-engine/src/gsd-engine.ts` (advancePhase вызывает gating.evaluate).
2. **`roles.module.ts`** — добавить ManifestLoaderAdapter в exports.
3. **`round-orchestrator-gating.adapter.ts`** — реализация GatingPort (§3). Скелет + логика.
4. **`objective-seed.service.ts`** — OnModuleInit seed stub-objective (§5).
5. **`gsd-engine.service.ts`** — конструктор принимает 4 сервиса, shared store, строит адаптер
   (§4).
6. **`gsd.module.ts`** — imports += KgModule, providers += adapter + seed.
7. **`round-orchestration.spec.ts`** — 4+ сценариев с mock зависимостями (§7).
8. Прогон verifier: `pnpm install` → `pnpm -r typecheck` → `pnpm -r build` →
   `node --import tsx --test apps/api/src/gsd/round-orchestration.spec.ts`. Всё green.
9. `7-01-SUMMARY.md`.

**Оценка:** ~2-3 часа.

---

## 11. Design notes (почему так)

1. **Wiring в NestJS, не в пакете.** GsdEngine — hexagonal-чистый, заморожен Phase 6.
   GatingPort — подходящий порт. Адаптер в NestJS-слое реализует его, оркестрируя сервисы.
   Это точно то, что предусмотрел PLAN Phase 6 D-F4. Развязка чистая: пакет не знает о NestJS.

2. **Shared store — критично.** InMemorySessionStore экземпляр должен быть один для GsdEngine
   (startSession/create) и адаптера (get session в evaluate). Поэтому store — поле класса
   GsdEngineService, передаётся обоим. Иначе «session not found» в evaluate.

3. **objectiveNodeId stub (D-G1).** buildPacket требует objectiveNodeId (`packet-builder.ts:26-30`),
   но реального objective нет до UI (Wave 8). Stub: seed `'stub-objective'` KgNode при старте.
   Idempotent + fail-safe (БД может быть недоступна). Реальный KG-seed → Wave 8.

4. **Fallback critic = корректное поведение.** Consensus phase плохо покрыта ролями — только
   critic (нет activePhases = активен везде). 1 response → низкий confidence → fail → iteration.
   Это **правильно**: Consensus требует консенсуса, 1 роль = мало. Wave 8 добавит роль-synthesizer
   или расширит manifests. Manifests НЕ трогаем в Phase 7.

5. **RoleRef из manifest, не из packet.** `packet-builder.ts:46` строит ContextPacket.role с
   `displayName=roleId, responsibilities=[]` (бедный). Для ConsensusReport.acceptedBy это плохо.
   Адаптер строит RoleRef из manifest (`displayName`, `responsibilities`). Обогащение packet-builder
   → долг D-G2 (Wave 8, не ломать Phase 3).

6. **Responses ephemeral.** Не хранятся в Session/Round. ConsensusReport агрегирует всё нужное.
   Если нужна история responses → D-F3 (KG-запись артефактов, Wave 8).

7. **Маппинг ConsensusReport → GatingResult тривиален.** report.gatingVerdict (`'pass'|'fail'`)
   → GatingResult.verdict. gaps — из disagreements/openQuestions (или парсинг nextAction).
   ConsensusReport уже содержит всё, маппинга «сложной логики» нет.

8. **Тесты с mock, не с NestJS DI.** End-to-end через NestJS TestingModule + Prisma = тяжело и
   хрупко. Mock зависимости (stub Context/Router, real Consensus) тестируют логику wiring
   (порядок вызовов, сбор RoleResponse[], маппинг). Повторяет канон Phase 4 MockHttpPort.

---

## 12. Долги, которые фаза ОТКРЫВАЕТ

- **D-G1** Реальный KG-seed objectiveNodeId (MVP = stub-objective). **Когда:** Wave 8 (UI).
  **Блокирует:** НЕТ.
- **D-G2** Обогащение ContextPacket.role (сейчас displayName=roleId). **Когда:** Wave 8.
  **Блокирует:** НЕТ (адаптер строит RoleRef из manifest).
- **D-G3** Bulk-API RoleRegistryPort.listByPhase (сейчас N get()). **Когда:** Wave 8+.
  **Блокирует:** НЕТ (5 ролей = приемлемо).

Все non-blocking, имеют явный Wave. MVP wiring работает с ними как known-limitations.

### Перенесённые долги (без изменений)

- D-F1 (Prisma персистенция), D-F2 (Event Bus), D-F3 (KG-запись артефактов) — Wave 8.
- D-E1/D-E2/D-E3/D-E4 (Phase 5), D-D1..D-D4 (Phase 4), D-B2/D-C1/D-C3/D-C4 — Wave 8+.

---

## 13. Что получает Orchestra после Phase 7

Pipeline Orchestra **полностью исполняем end-to-end** (Architecture.md §4 поток одного раунда):

```
startSession('feature X', 'proj-1')
  → startRound (Round в фазе Discover)
  → advancePhase:
      → RoundOrchestratorGatingAdapter.evaluate:
          → ContextService.buildPacket × N ролей фазы
          → RoleRouterService.route × N (через MockHttpPort)
          → сбор RoleResponse[]
          → ConsensusService.run → ConsensusReport
          → маппинг → GatingResult{verdict, gaps}
      → FSM: pass → transition / fail → gated / hard gate → awaiting_approval
  → approveTransition (hard gate на Architecture)
  → ... до Consensus
```

**Phase 6 GsdEngine + Phase 7 wiring = Orchestra работает как система**, а не набор изолированных
узлов. Модули связаны, раунд исполняется, gating verdict реальный.

**Phase 8 кандидаты (Wave 8 — инфраструктура + UI):**
- **HTTP API** (REST-эндпоинты: POST /sessions, POST /sessions/:id/rounds, POST /sessions/:id/
  advance, POST /sessions/:id/approve, POST /sessions/:id/override) — первый шаг к UI.
- **UI Conducting Score** (Next.js) — визуализация фаз, раундов, confidence, одобрений.
- **Event Bus** (Redis+BullMQ) — закроет D-F2 + D-D1/D-C4/D-E2.
- **Decision Repository** (Prisma persistence) — закроет D-F1 + D-E3 + D-B2.

Безопасно стартовать Phase 8: D-21 typecheck стабильно зелёный, wiring доказана end-to-end
тестами, hexagonal-порты готовы к HTTP-layer и Event Bus. Phase 7 готова к исполнению.
