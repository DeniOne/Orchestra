# README Contract — Phase 6 gsd-engine (Wave 6)

**Verdict: PASS (34/34)**
**Date:** 2026-07-19
**Milestone:** Orchestra MVP — Wave 6 (GSD Engine Layer)
**Wave:** B-6
**Code review:** @zcode-assistant (Tech Lead)
**Coder:** mimo (Cursor)

## Scope

Phase 6 = реализация **GSD Engine runtime** — недостающего оркестратора pipeline. После Phase 6
Orchestra имеет исполняемый жизненный цикл GSD: `startSession → startRound → advancePhase (FSM) →
approveTransition (hard gate) → overrideGate (audit) → terminal (Consensus exit)`.

**In scope:**
- `packages/gsd-engine` — hexagonal-ядро: FSM фаз, SessionStorePort/GatingPort/AuditPort/
  EventPublisherPort, public API GsdEngine.
- `packages/domain/src/` расширение (первая фаза, трогающая domain): session.ts, events.ts
  (новые), gsd.ts (+PhaseStatus), consensus.ts (+PhaseTransitionAction).
- `apps/api/src/gsd/` — NestJS GsdModule + GsdEngineService.
- `gsd-engine.spec.ts` — 7 детерминированных сценариев T1-T7.

**Out of scope (забор на Wave 7):**
- Event Bus публикация (RoundStarted/PhaseChanged на Redis+BullMQ) → долг **D-F2**.
- KG-запись артефактов фаз → долг **D-F3**.
- Реальная wiring GatingPort → ConsensusService.run() → долг **D-F4** (Phase 6 = StubGating).
- Prisma/PostgreSQL персистенция → долг **D-F1** (Phase 6 = InMemorySessionStore).
- Оркестрация раунда (реальный вызов Context→Router→Consensus в advancePhase) → Wave 7 wiring.
- HTTP API + UI Conducting Score → Wave 8.

## Verification commands (frozen)

```bash
pnpm install                                                  # 11 workspace-проектов
pnpm -r typecheck                                             # D-29: 10 пакетов green
pnpm --filter @orchestra/gsd-engine build                     # D-30
pnpm --filter @orchestra/consensus-engine build               # D-32 (регрессия Phase 5)
pnpm --filter @orchestra/role-router build                    # D-32 (регрессия Phase 4)
pnpm --filter @orchestra/providers build                      # D-32 (регрессия Phase 4)
pnpm --filter @orchestra/api build                            # D-31 (с GsdModule)
pnpm --filter @orchestra/gsd-engine test                      # D-28: 7/7 green
# D-34 web: git status apps/web/ пуст → регрессия исключена (Next.js таймаутит на Windows)
```

Все команды возвращают exit 0 на момент заморозки (2026-07-19). Clean rebuild api: `dist/main.js`
по прямому пути (D-33). 7/7 тестов green (D-28).

## 🎯 Главная находка

**Конечный автомат фаз GSD материализован и проверен objectively — с критическим архитектурным
инсайтом кодера.** FSM (phase-machine.ts:7-16) — 7 прямых переходов + Iteration→Specification
возврат + Consensus терминал. Тест T7 доказывает полный проход Discover→...→Consensus→terminal,
тест T4 — критический путь Consensus-fail→Iteration→Specification.

**Ключевой design decision кодера (Summary §81, неявный в PLAN):** в `advancePhase`
**gating-проверка для Consensus идёт ДО терминальной проверки** (gsd-engine.ts:96-117).
Это критично: TRANSITION_MAP['Consensus']=null, и если бы терминальная проверка шла первой,
Consensus-fail→Iteration никогда бы не сработал (вернулся бы terminal). Кодер это распознал
самостоятельно — хороший архитектурный знак. Special-case Consensus обработан отдельно:
gating fail → Iteration (с emit PhaseChanged), gating pass → terminal.

Вторичная находка: **InMemorySessionStore делает defensive copy** (in-memory-store.ts:8,13,17) —
`{ ...session, rounds: [...session.rounds] }` при create/get/update. Это неявно в PLAN, но
правильно: иначе мутации session вне store ломали бы инкапсуляцию и историю раундов. Канон для
любого in-memory store в проекте.

Третья находка: **hard gate отделён от gating.** GatingPort (StubGating в Phase 6, Consensus в
Wave 7) = метрики/confidence. Hard gate (isHardGate в advancePhase:129) = human approval для
Architecture/Consensus. Эти два концепта не смешаны — gating может pass, но hard gate всё равно
требует approve. Это чистая развязка ответственности, подготавливает Wave 7 wiring.

## Verification (по D-критериям)

| Критерий | Статус | Доказательство |
|---|---|---|
| **D-01** session.ts создан | ✅ PASS | Session/Round/SessionId/RoundId/RoundStatus определены |
| **D-02** events.ts создан | ✅ PASS | DomainEvent + RoundStarted/PhaseChanged/OwnerOverrideApplied |
| **D-03** gsd.ts расширен PhaseStatus | ✅ PASS | PhaseStatus добавлен, GSDPhase НЕ тронут (`git diff` показывает только добавление) |
| **D-04** consensus.ts: GSDAction=string + PhaseTransitionAction | ✅ PASS | `export type GSDAction = string;` сохранён, PhaseTransitionAction union добавлен. ConsensusReport НЕ сломан |
| **D-05** index.ts экспортирует session+events | ✅ PASS | +2 строки `export * from './session.js'; export * from './events.js';` |
| **D-06** Регрессия 9 пакетов typecheck green | ✅ PASS | `pnpm -r typecheck` — domain/context-service/role-router/providers/consensus-engine/knowledge-graph/prompt-registry/api/web все Done, exit 0 |
| **D-07** TRANSITION_MAP 7 переходов | ✅ PASS | phase-machine.ts:7-16, Discover→Goal→Specification→Architecture→Implementation→Review→Consensus |
| **D-08** Consensus:null, Iteration→Specification | ✅ PASS | TRANSITION_MAP['Consensus']=null, TRANSITION_MAP['Iteration']='Specification' |
| **D-09** HARD_GATES=[Architecture, Consensus] | ✅ PASS | phase-machine.ts:19, readonly |
| **D-10** isTerminal/nextPhase/isHardGate/canTransition | ✅ PASS | Все 4 функции экспортированы (phase-machine.ts:21-35), чистые |
| **D-11** startSession → currentPhase=Discover | ✅ PASS | gsd-engine.ts:49, T1 PASS |
| **D-12** startRound → Round{number, phase, status} | ✅ PASS | gsd-engine.ts:58-86, round.id=`round-${sessionId}-${number}` детерминированный. T1 PASS |
| **D-13** advancePhase → AdvancePhaseResult union | ✅ PASS | gsd-engine.ts:13-18, 5 branches. T2-T7 покрывают все |
| **D-14** gating fail non-Consensus → {gated} | ✅ PASS | gsd-engine.ts:125-127 |
| **D-15** Consensus fail → {iteration} | ✅ PASS | gsd-engine.ts:96-117, T4 PASS (критический путь) |
| **D-16** hard gate без approve → {awaiting_approval} | ✅ PASS | gsd-engine.ts:129-131, T3 PASS |
| **D-17** terminal Consensus → {terminal} | ✅ PASS | gsd-engine.ts:116, T7 PASS (idempotent — повторный advance остаётся terminal) |
| **D-18** approveTransition → повторный advance работает | ✅ PASS | gsd-engine.ts:158-166, T3 PASS (approve → transitioned to Implementation) |
| **D-19** overrideGate → AuditRecord + transition | ✅ PASS | gsd-engine.ts:168-194, T5 PASS (audit.list возвращает запись с reason+phase) |
| **D-20** Port interfaces в types.ts | ✅ PASS | SessionStorePort/GatingPort/AuditPort/EventPublisherPort (types.ts:6-45) |
| **D-21** InMemory/Stub defaults | ✅ PASS | InMemorySessionStore/StubGating/InMemoryAuditLog, конструктор с defaults (gsd-engine.ts:28-33) |
| **D-22** gsd-engine без @nestjs/@prisma | ✅ PASS | `grep -rn "@nestjs\|@prisma\|node-fetch\|axios" packages/gsd-engine/src/` → exit 1 (пусто) |
| **D-23** GsdModule создан | ✅ PASS | gsd.module.ts, imports [ContextModule, RolesModule, ConsensusModule], providers/exports [GsdEngineService] |
| **D-24** AppModule.imports += GsdModule | ✅ PASS | app.module.ts: `imports: [KgModule, ContextModule, RolesModule, ConsensusModule, GsdModule]`. Bonus: убран unused `import type { GSDPhase }` |
| **D-25** api/package.json += gsd-engine dep | ✅ PASS | `"@orchestra/gsd-engine": "workspace:*"` добавлен |
| **D-26** gsd-engine.spec.ts 7 сценариев | ✅ PASS | T1-T7: startSession, FSM, hard gate, Consensus-fail iteration, override+audit, determinism, terminal |
| **D-27** test-script явный путь | ✅ PASS | `"test": "node --import tsx --test test/gsd-engine.spec.ts"` — урок Phase 5b D-E5 применён |
| **D-28** pnpm test → 7/7 green | ✅ PASS | **objective**: `tests 7, pass 7, fail 0`, exit 0 (1207ms) |
| **D-29** pnpm -r typecheck → 10 green | ✅ PASS | Все 10: domain/knowledge-graph/context-service/prompt-registry/role-router/providers/consensus-engine/gsd-engine/api/web — exit 0 |
| **D-30** gsd-engine build | ✅ PASS | `tsc` exit 0, dist/ сгенерирован |
| **D-31** api build с GsdModule | ✅ PASS | `nest build` exit 0 |
| **D-32** consensus-engine/role-router/providers build | ✅ PASS | Все 3 exit 0 (Phase 4/5 не сломаны) |
| **D-33** clean rebuild → dist/main.js | ✅ PASS | `rm -rf apps/api/dist && build` → `apps/api/dist/main.js` существует |
| **D-34** apps/web не тронут | ✅ PASS | `git status apps/web/` пуст. Next.js таймаутит на Windows — регрессия через отсутствие diff |

## Code review (по разделам PLAN)

| Раздел PLAN | Статус | Комментарий |
|---|---|---|
| `packages/domain/src/session.ts` (новый) | ✅ | 27 строк, точно по PLAN §2.1. Session/Round чистые сущности данных |
| `packages/domain/src/events.ts` (новый) | ✅ | 29 строк, DomainEvent base + 3 события. PhaseChanged.gatingVerdict включает 'overridden' |
| `packages/domain/src/gsd.ts` (расширен) | ✅ | +PhaseStatus (5 значений). GSDPhase не тронут |
| `packages/domain/src/consensus.ts` (расширен) | ✅ | +PhaseTransitionAction union. GSDAction=string сохранён (backward-compat). ConsensusReport цел |
| `packages/domain/src/index.ts` (расширен) | ✅ | +2 export. Существующие экспорты не тронуты |
| `packages/gsd-engine/src/types.ts` | ✅ | 4 порта + GatingResult + GsdEngineOptions. Чистые interfaces |
| `packages/gsd-engine/src/phase-machine.ts` | ✅ | FSM 35 строк, точно по PLAN §3.2. Все 4 helper-функции чистые |
| `packages/gsd-engine/src/in-memory-store.ts` | ✅ | Defensive copy при create/get/update — правильная инкапсуляция |
| `packages/gsd-engine/src/stub-gating.ts` | ✅ | Всегда pass — позволяет тестировать FSM без Consensus (D-F4) |
| `packages/gsd-engine/src/audit-log.ts` | ✅ | Детерминированный id `audit-${sessionId}-${counter}`. filter по sessionId в list |
| `packages/gsd-engine/src/gsd-engine.ts` | ✅ | 203 строки. Consensus special-case ДО terminal (правильно). Approvals в Map (Session чистая). Все 5 public методов |
| `packages/gsd-engine/src/index.ts` | ✅ | Barrel export всех типов + GsdEngine + defaults |
| `packages/gsd-engine/test/gsd-engine.spec.ts` | ✅ | 7 сценариев, node:test + node:assert. T4 (Consensus-fail→Iteration→Specification) — самый сложный путь FSM, покрыт |
| `apps/api/src/gsd/gsd-engine.service.ts` | ✅ | @Injectable, new GsdEngine с defaults. 7 методов-прокси |
| `apps/api/src/gsd/gsd.module.ts` | ✅ | imports [Context/Roles/Consensus]Module, providers/exports [GsdEngineService] |
| `apps/api/src/app.module.ts` | ✅ | +GsdModule. Bonus cleanup: убран unused GSDPhase import |
| `apps/api/package.json` | ✅ | +1 workspace-dep |
| Anti-conflict | ✅ | domain существующие (agent/context/decision/kg), фазы 2-5 пакеты, apps/web, docs, manifests, prompts, .planning/0[1-5] — **всё чисто** |

## Design decisions (почему так)

1. **Consensus gating ДО terminal-проверки (инсайт кодера).** TRANSITION_MAP['Consensus']=null.
   Если бы терминальная проверка (isTerminal) шла первой, Consensus-fail→Iteration никогда бы
   не сработал. Кодер вынес Consensus в отдельную ветку (gsd-engine.ts:96-117) ДО общего
   terminal-обработчика. Это правильное архитектурное решение, распознанное кодером
   самостоятельно (Summary §81).

2. **Approvals в Map, не в Session.** Кодер держит `approvals: Map<string, boolean>` (ключ
   `${sessionId}:${phase}`) внутри GsdEngine, а не добавляет поле в Session. Session остаётся
   чистой сущностью данных (Summary §82). Approve очищается после перехода (gsd-engine.ts:141).

3. **InMemorySessionStore defensive copy.** `{ ...session, rounds: [...session.rounds] }` при
   каждом create/get/update. Неявно в PLAN, но канонично — иначе внешние мутации ломали бы
   историю раундов. Канон для будущих in-memory stores.

4. **Hard gate отделён от gating.** GatingPort = метрики/confidence (Consensus, Wave 7).
   isHardGate = human approval для Architecture/Consensus (FSM-инвариант). Gating может pass,
   но hard gate всё равно требует approve. Чистая развязка, подготавливает Wave 7 wiring (D-F4).

5. **GSDAction backward-compat.** Phase 5 buildNextAction возвращает string. Ломать = регрессия
   Phase 5. Кодер добавил PhaseTransitionAction как дополнение, string сохранён. Wave 7
   унифицирует.

6. **EventPublisherPort = no-op default (D-F2).** GsdEngine формирует DomainEvent объекты
   (RoundStarted/PhaseChanged/OwnerOverrideApplied), но publish = `async () => {}`. Wave 7
   подключит Redis+BullMQ. Точки расширения заложены без premature infrastructure.

7. **NestJS без endpoint'а (повтор Phase 4/5).** GsdEngineService не вызывается HTTP-роутом.
   Wave 8 (UI) добавит контроллеры. Смысл — собрать FSM + доказать build/testability.

## Deliverables

| Артефакт | Назначение | Статус |
|---|---|---|
| `packages/domain/src/session.ts` | Session/Round/SessionId/RoundId/RoundStatus | ✅ |
| `packages/domain/src/events.ts` | DomainEvent + 3 события | ✅ |
| `packages/gsd-engine/src/phase-machine.ts` | FSM: TRANSITION_MAP, HARD_GATES, 4 helpers | ✅ |
| `packages/gsd-engine/src/gsd-engine.ts` | GsdEngine (203 строки, 5 public методов) | ✅ |
| `packages/gsd-engine/src/types.ts` | 4 порта + GatingResult + Options | ✅ |
| `packages/gsd-engine/src/in-memory-store.ts` | InMemorySessionStore с defensive copy | ✅ |
| `packages/gsd-engine/src/stub-gating.ts` | StubGating (always pass) | ✅ |
| `packages/gsd-engine/src/audit-log.ts` | InMemoryAuditLog | ✅ |
| `apps/api/src/gsd/gsd-engine.service.ts` | NestJS-обёртка | ✅ |
| `apps/api/src/gsd/gsd.module.ts` | GsdModule | ✅ |
| `packages/gsd-engine/test/gsd-engine.spec.ts` | 7 детерминированных сценариев | ✅ |

## Долги (правило PARTIAL-вердикта — фаза PASS, но 4 честных долга)

### D-F1 — Prisma/PostgreSQL персистенция SessionStore

1. **Почему.** Phase 6 = InMemorySessionStore (Map). При рестарте процесса состояние теряется.
2. **Когда.** Wave 7 (фаза Decision Repository / персистенция). Закроет попутно D-B2.
3. **Блокирует Phase 7?** **НЕТ.** MVP FSM работает in-memory. Персистенция — production-concern.

### D-F2 — Event Bus публикация RoundStarted/PhaseChanged

1. **Почему.** EventPublisherPort = no-op default. События формируются, но не публикуются.
2. **Когда.** Wave 7 (фаза Event Bus с Redis+BullMQ). Закроет попутно D-D1/D-C4/D-E2.
3. **Блокирует Phase 7?** **НЕТ.** FSM детерминирован без шины. События — телеметрия/automations.

### D-F3 — KG-запись артефактов фаз

1. **Почему.** GSD Integration.md §2 — каждая фаза produces артефакт (Research/Goal/Spec/ADR/
   Decision) как KgNode. Phase 6 не пишет в Knowledge Graph.
2. **Когда.** Wave 7 (фаза Knowledge Graph записи артефактов).
3. **Блокирует Phase 7?** **НЕТ.** FSM считает состояние, не пишет в граф.

### D-F4 — Реальная wiring GatingPort → ConsensusService

1. **Почему.** Phase 6 = StubGating (always pass). Реальный gating = ConsensusService.run().
2. **Когда.** Wave 7 (фаза wiring: GsdEngine.advancePhase вызывает Context→Router→Consensus).
3. **Блокирует Phase 7?** **НЕТ.** StubGating позволяет тестировать FSM end-to-end без LLM.

Все 4 долга — non-blocking, имеют явный Wave. MVP FSM работает с ними как known-limitations.

### Перенесённые долги (без изменений)

- D-E1/D-E2/D-E3/D-E4 (из Phase 5) — Wave 6+ как планировалось.
- D-D1/D-D2/D-D3/D-D4 (из Phase 4) — Wave 5+.
- D-B2/D-C1/D-C3/D-C4 (ранние) — Wave 7 (Event Bus/Prisma).

## Authorship

- **Owner:** пользователь (Denis) — 3 owner-решения через AskUserQuestion (layout, domain
  расширение, in-memory store).
- **Tech Lead:** @zcode-assistant — PLAN 6-01, code review, README-CONTRACT (этот файл).
- **Coder:** mimo (Cursor) — реализация по PLAN, ~30 мин.

## Gate commands (для будущих регресс-проверок)

```bash
# Полная регрессия Phase 6 (HARD):
pnpm install \
  && pnpm -r typecheck \
  && pnpm --filter @orchestra/gsd-engine build \
  && pnpm --filter @orchestra/api build \
  && pnpm --filter @orchestra/consensus-engine build \
  && pnpm --filter @orchestra/role-router build \
  && pnpm --filter @orchestra/providers build \
  && pnpm --filter @orchestra/gsd-engine test
# Все exit 0 = Phase 6 не сломана.

# Проверка чистоты пакета (D-22):
grep -rn "@nestjs\|@prisma\|node-fetch\|axios" packages/gsd-engine/src/    # пусто

# Проверка D-04 (GSDAction backward-compat):
grep "export type GSDAction" packages/domain/src/consensus.ts              # = string

# Проверка D-03 (GSDPhase не тронут):
grep "Discover\|Goal\|Specification" packages/domain/src/gsd.ts            # GSDPhase на месте

# Проверка D-08 (Consensus terminal, Iteration→Specification):
grep -A1 "Consensus:\|Iteration:" packages/gsd-engine/src/phase-machine.ts # null / Specification

# Тесты (D-28):
pnpm --filter @orchestra/gsd-engine test                                    # 7/7 green

# Clean rebuild api (D-33):
rm -rf apps/api/dist && pnpm --filter @orchestra/api build
test -f apps/api/dist/main.js && echo "D-33 OK"
```

## Следующий шаг

Pipeline Orchestra имеет **исполняемый жизненный цикл GSD**:

```
startSession('feature X', 'proj-1')
  → startRound → advancePhase (Discover→Goal→...→Consensus)
  → approveTransition (hard gate на Architecture)
  → overrideGate (audit record при необходимости)
  → terminal (Consensus exit)
```

GsdEngine связывает FSM, но реальная wiring трёх сервисов (Context→Router→Consensus) в
advancePhase — Wave 7 (D-F4). Сейчас advancePhase работает со StubGating.

**Phase 7 кандидаты (Wave 7):**
- **Event Bus** (Redis+BullMQ) — закроет D-F2 + D-D1 + D-C4 + D-E2 одной фазой.
- **Decision Repository** (Prisma/PostgreSQL) — закроет D-F1 + D-E3 + D-B2 (персистенция).
- **GatingPort wiring** — подключить ConsensusService.run() к GatingPort (D-F4). Заодно реальная
  оркестрация раунда: advancePhase вызывает Context.buildPacket → RoleRouter.route → собирает
  Response[] → ConsensusEngine.run.
- **HTTP API + UI Conducting Score** — Wave 8.

Безопасно стартовать Phase 7: D-29 typecheck стабильно зелёный на 10 пакетах, GsdEngine управляет
FSM с детерминированными id (7/7 тестов green), hexagonal-порты готовы к подключению Event Bus и
Prisma. Phase 6 заморожена PASS (34/34).
