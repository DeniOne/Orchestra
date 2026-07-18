---
phase: 6
slug: 06-gsd-engine
wave: B-6
title: "GSD Engine runtime (Wave 6) — конечный автомат фаз GSD + оркестратор раундов"
milestone: "Orchestra MVP — Wave 6 (GSD Engine Layer)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-18
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build, 10 пакетов green) + spec-gate (gsd-engine.spec.ts, FSM + gating + override сценарии)
baseline_before: "Phase 5 заморожена PASS (33/33, commit 4f88f93): typecheck 9 пакетов green, consensus-engine/api/role-router/providers build green, pipeline KG→Context→RoleRouter→Provider→ConsensusEngine исполняем"
depends_on:
  - "Phase 5 (ConsensusEngine.run → ConsensusReport{gatingVerdict, nextAction} — GSD Engine читает verdict для перехода)"
  - "Phase 4 (RoleRouterService.route — оркестратор раунда вызывает для каждой роли)"
  - "Phase 3 (ContextService.buildPacket — оркестратор собирает пакет для роли)"
  - "Phase 2 (KgService — НЕ трогать)"
  - "Phase 1 (domain types — РАСШИРИТЬ: session.ts/events.ts новые, gsd.ts/consensus.ts дополнить)"
closes_debts: []
opens_debts_expected:
  - "D-F1: Prisma/PostgreSQL персистенция SessionStore (MVP = InMemorySessionStore) — Wave 7 (закроет D-B2)"
  - "D-F2: Event Bus публикация RoundStarted/PhaseChanged (MVP = no-op emit) — Wave 7 (закроет D-D1/D-C4)"
  - "D-F3: KG-запись артефактов фаз (Research/Goal/Spec/ADR/Decision как KgNode) — Wave 7"
  - "D-F4: Реальная wiring GatingPort → ConsensusService.run (MVP = stub gating) — Wave 7"
---

# PLAN 6-01 — GSD Engine runtime (Wave 6)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `6-01-SUMMARY.md`. Tech Lead делает code review против `must_haves.truths` ниже.

## 0. Контекст фазы (почему и что)

Phase 5 заморозила Consensus Engine (PASS 33/33). Pipeline исполняем:
```
KG → ContextService.buildPacket → RoleRouter.route → AIProvider.send
   → Response[] → ConsensusEngine.run → ConsensusReport{gatingVerdict, nextAction}
```

Но **нечто должно оркестровать** этот pipeline по фазам GSD: в фазе Architecture вызвать
Context→Router→Consensus, получить gating verdict, и если `pass` — перейти в Implementation;
если `fail` — вернуть в Iteration с gap'ами. Сегодня этого слоя нет — три NestJS-сервиса
(ContextService, RoleRouterService, ConsensusService) существуют параллельно, никто их не
композирует.

**GSD Engine — недостающий оркестратор** (Architecture.md §9, GSD Integration.md). Это
конечный автомат фаз GSD + история раундов + human-governance API. После Phase 6 Orchestra
имеет исполняемый жизненный цикл: создать сессию → стартовать раунд в фазе → продвинуть
фазу (с gating) → заапрувить переход (hard gate) → дойти до Consensus → закрыть решение.

### Ключевое инвариантное свойство (Architecture.md §9, GSD Integration.md §3)

> «Переход фазы невозможен, пока Decision Confidence не пройдёт порог gating, и пока
> человек не подтвердит переход. Обход — только owner-override с записью в аудит.»

GSD Engine материализует это как **детерминированный FSM** с тремя invariant'ами:
1. `advancePhase` блокирует при gating `fail` (без override переход не происходит).
2. Фазы Architecture и Consensus — **hard human gates**: переход требует явного `approve`.
3. Любой обход (`overrideGate`) логируется в AuditPort (аудиторский след).

### Что закрывает фаза

- `packages/gsd-engine` — hexagonal-ядро: FSM фаз, SessionStorePort, GatingPort, AuditPort,
  public API (startSession/startRound/advancePhase/approveTransition/overrideGate).
- `packages/domain/src/session.ts` + `events.ts` — НОВЫЕ доменные сущности (Session, Round,
  события PhaseChanged/RoundStarted/OwnerOverrideApplied).
- Расширение `domain/src/gsd.ts` (PhaseStatus) + `consensus.ts` (структурированный GSDAction).
- `apps/api/src/gsd/` — NestJS-обёртка: GsdEngineService + адаптеры портов.
- `gsd-engine.spec.ts` — детерминированные сценарии FSM + gating + override + history.

### Owner-решения (3 fork'а, зафиксированы через AskUserQuestion)

1. **Layout:** пакет `packages/gsd-engine` (hexagonal-ядро с портами) + NestJS-обёртка
   `apps/api/src/gsd/`. Повторяет канон role-router/consensus-engine.
2. **Domain расширить:** добавить Session/Round/PhaseStatus/структурированный GSDAction/
   события. **Это первая фаза, трогающая domain** (Phase 4/5 не трогали) — но только
   добавление новых типов, не ломка существующих контрактов.
3. **Store:** InMemorySessionStore default (как MockHttpPort в Phase 4). Prisma → долг D-F1.

### Что НЕ в scope (забор на Wave 7+)

- **Event Bus публикация** (RoundStarted/PhaseChanged на Redis+BullMQ) — Event Bus не
  существует → долг **D-F2**. В Phase 6 GsdEngine **формирует** события как доменные объекты
  (для будущего emit), но физическая публикация = no-op (заглушка emit, логирует в AuditPort).
- **KG-запись артефактов фаз** (Research/Goal/Spec/ADR/Decision как KgNode по GSD
  Integration.md §2) → долг **D-F3**. Phase 6 не пишет в Knowledge Graph.
- **Реальная wiring GatingPort → ConsensusService** → долг **D-F4**. В Phase 6 GatingPort =
  stub (возвращает pass для non-hard-gate, требует approve для hard). Wave 7 подключит
  реальный ConsensusService.run().
- **Оркестрация раунда** (реальный вызов Context→Router→Consensus в advancePhase) — Phase 6
  предоставляет API, но сама оркестрация трёх сервисов = Wave 7 wiring. В Phase 6 advancePhase
  работает с FSM + stub gating, без реальных LLM-вызовов.
- **Continuous Consensus wiring** — Wave 7 (с Event Bus).
- **Реальная кодогенерация MiMo** (фаза Implementation) — Sprint 5.
- **Prisma/PostgreSQL персистенция** — долг D-F1 (Wave 7, закроет D-B2).

---

## 1. Целевая структура (файлы, которые создаёт кодер)

```
packages/domain/src/
├── session.ts            # НОВЫЙ: Session, Round, SessionId, RoundId, RoundStatus
├── events.ts             # НОВЫЙ: RoundStarted, PhaseChanged, OwnerOverrideApplied (event contracts)
├── gsd.ts                # РАСШИРИТЬ: + PhaseStatus (НЕ ломать GSDPhase)
├── consensus.ts          # РАСШИРИТЬ: GSDAction → структурированный union (НЕ ломать ConsensusReport)
└── index.ts              # РАСШИРИТЬ: export session.js, events.js

packages/gsd-engine/                       # НОВЫЙ ПАКЕТ
├── package.json          # name: @orchestra/gsd-engine, dep: @orchestra/domain
├── tsconfig.json         # канон (extends ../../tsconfig.base.json, outDir/rootDir/src)
├── README.md             # назначение, порты, что НЕ делает (без LLM/БД/Event Bus)
├── src/
│   ├── types.ts          # SessionStorePort, GatingPort, AuditPort, GsdEngineOptions, GatingResult
│   ├── phase-machine.ts  # FSM: TRANSITION_MAP, HARD_GATES, canTransition, nextPhase, isTerminal
│   ├── in-memory-store.ts # InMemorySessionStore implements SessionStorePort (Map-based)
│   ├── audit-log.ts      # InMemoryAuditLog implements AuditPort + AuditRecord type
│   ├── stub-gating.ts    # StubGating implements GatingPort (default; pass non-hard, require-approve hard)
│   ├── gsd-engine.ts     # GsdEngine: startSession/startRound/advancePhase/approveTransition/overrideGate
│   └── index.ts          # barrel export
└── test/
    └── gsd-engine.spec.ts # 6+ сценариев: FSM, gating fail, hard gate, override, round history, determinism

apps/api/src/
├── gsd/                                  # НОВЫЙ NestJS-модуль
│   ├── gsd.module.ts                     # imports: ContextModule, RolesModule, ConsensusModule
│   ├── gsd-engine.service.ts             # @Injectable, обёртка над GsdEngine с InMemory defaults
│   ├── session-store.adapter.ts          # SessionStorePort impl (делегирует в InMemorySessionStore)
│   ├── gating.adapter.ts                 # GatingPort impl (Phase 6: StubGating; Wave 7: ConsensusService)
│   └── audit.adapter.ts                  # AuditPort impl (делегирует в InMemoryAuditLog)
└── app.module.ts                         # ИЗМЕНИТЬ: imports += GsdModule

apps/api/package.json                     # ИЗМЕНИТЬ: +1 workspace-dep (@orchestra/gsd-engine)
```

### Файлы, которые НЕ трогать (anti-conflict)

| Зона | Почему нельзя | Проверка |
|---|---|---|
| `packages/domain/src/agent.ts`, `context.ts`, `decision.ts`, `kg.ts` | Существующие контракты. Расширяем только `gsd.ts`/`consensus.ts` (добавление) + создаём `session.ts`/`events.ts` | `git diff packages/domain/src/agent.ts packages/domain/src/context.ts packages/domain/src/decision.ts packages/domain/src/kg.ts` → пусто |
| `packages/{role-router,providers,context-service,prompt-registry,knowledge-graph,consensus-engine}/src/` | Фазы 2-5 заморожены. GSD Engine их только консьюмит | `git diff` → пусто по каждой |
| `apps/web/` | Frontend — Wave 8+. Conducting Score UI требует GSD state, но рендеринг не в этой фазе | `git diff apps/web/` → пусто |
| `docs/**` | Канон-документы. Architecture.md §9 / GSD Integration.md — источник правды для FSM | `git diff docs/` → пусто |
| `role-manifests/`, `prompts/` | Seed-данные | `git diff` → пусто |
| `.planning/phases/0[1-5]/` | Замороженные фазы | `git diff` → пусто |
| `tsconfig.base.json`, `pnpm-workspace.yaml` | packages/* covers gsd-engine автоматически; paths domain уже есть | `git diff` → пусто |

**Единственные изменения вне нового пакета и нового NestJS-модуля:**
- `packages/domain/src/gsd.ts` — +PhaseStatus (добавление, GSDPhase не трогать)
- `packages/domain/src/consensus.ts` — GSDAction из `string` → structured union (см. §2 caveat)
- `packages/domain/src/session.ts` — НОВЫЙ
- `packages/domain/src/events.ts` — НОВЫЙ
- `packages/domain/src/index.ts` — +2 export строки
- `apps/api/src/app.module.ts` — +1 import
- `apps/api/package.json` — +1 dep

---

## 2. Domain-расширение (контракты, которые добавляет кодер)

> **ВНИМАНИЕ:** это первая фаза, правящая domain. Главное правило — **только добавление,
> не ломка**. После расширения typecheck ВСЕХ 9 существующих пакетов должен остаться green
> (это D-01 регрессионный критерий).

### 2.1. `packages/domain/src/session.ts` (НОВЫЙ)

```typescript
import type { GSDPhase } from './gsd.js';
import type { ISO8601 } from './decision.js';

/** Идентификатор сессии. Сегодня string (branded-тип опционален, не обязателен). */
export type SessionId = string;
export type RoundId = string;

/** Статус раунда. См. Orchestra_TC.md §5. */
export type RoundStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** См. docs/Orchestra_TC.md §5 (сущность Round). */
export interface Round {
  id: RoundId;
  sessionId: SessionId;
  number: number;
  phase: GSDPhase;
  status: RoundStatus;
  startedAt: ISO8601;
  completedAt?: ISO8601;
}

/** См. docs/Orchestra_TC.md §5 (сущность Session). */
export interface Session {
  id: SessionId;
  name: string;
  projectId: string;
  currentPhase: GSDPhase;
  rounds: Round[];
  createdAt: ISO8601;
  updatedAt: ISO8601;
}
```

### 2.2. `packages/domain/src/gsd.ts` (РАСШИРИТЬ — не ломать)

```typescript
/** Фазы жизненного цикла GSD. См. docs/GSD Integration.md §1. (СУЩЕСТВУЕТ — не трогать) */
export type GSDPhase =
  | 'Discover' | 'Goal' | 'Specification' | 'Architecture'
  | 'Implementation' | 'Review' | 'Consensus' | 'Iteration';

/** Статус фазы в рамках сессии. См. docs/Architecture.md §9. (НОВОЕ) */
export type PhaseStatus =
  | 'not_started'
  | 'in_progress'
  | 'gated'              // gating fail — переход заблокирован, ждёт override/итерации
  | 'awaiting_approval'  // hard gate — ждёт human approve (Architecture ADR / Consensus Decision)
  | 'completed';
```

### 2.3. `packages/domain/src/consensus.ts` — GSDAction (РАСШИРИТЬ — caveat)

> **CAVEAT (важно):** сегодня `GSDAction = string` (consensus.ts:22). Consensus Engine
> (Phase 5) в `buildNextAction` возвращает строки `'transition from X'` / `'iterate: gaps...'`.
> Phase 6 НЕ ломает это — GSDAction остаётся обратно-совместимым. Кодер добавляет
> **дискриминированный union как ДОПОЛНЕНИЕ**, а старый `string`-алиас сохраняет:

```typescript
// consensus.ts — было:
// export type GSDAction = string;

// consensus.ts — стало (обратно-совместимо):
export type GSDAction = string;  // сохранён для Phase 5 buildNextAction

/** Структурированное действие FSM (для GSD Engine). Phase 5 остаётся на string. (НОВОЕ) */
export type PhaseTransitionAction =
  | { kind: 'transition'; from: GSDPhase; to: GSDPhase }
  | { kind: 'iterate'; gaps: string[] }
  | { kind: 'exit' };
```

> Это даёт GSD Engine типобезопасный диспатч, не ломая ConsensusReport.nextAction (string).
> Wave 7 унифицирует (когда Consensus Engine начнёт возвращать PhaseTransitionAction).

### 2.4. `packages/domain/src/events.ts` (НОВЫЙ)

```typescript
import type { SessionId, RoundId } from './session.js';
import type { GSDPhase } from './gsd.js';
import type { ISO8601 } from './decision.js';

/** Базовые поля события. См. docs/Architecture.md §5. (публикация на Event Bus = Wave 7) */
export interface DomainEvent {
  id: string;          // детерминированный (см. §5)
  type: string;
  sessionId: SessionId;
  occurredAt: ISO8601;
}

/** См. Architecture.md §5 каталог. Издатель: GSD Engine. */
export interface RoundStarted extends DomainEvent {
  type: 'RoundStarted';
  roundId: RoundId;
  phase: GSDPhase;
}

export interface PhaseChanged extends DomainEvent {
  type: 'PhaseChanged';
  from: GSDPhase;
  to: GSDPhase;
  gatingVerdict: 'pass' | 'fail' | 'overridden';  // 'overridden' — был owner-override
}

export interface OwnerOverrideApplied extends DomainEvent {
  type: 'OwnerOverrideApplied';
  phase: GSDPhase;
  reason: string;
}
```

### 2.5. `packages/domain/src/index.ts` (РАСШИРИТЬ)

Добавить 2 строки:
```typescript
export * from './session.js';
export * from './events.js';
```

---

## 3. Hexagonal-порты и FSM (packages/gsd-engine/src/)

### 3.1. `types.ts` — порты

```typescript
import type {
  Session, SessionId, Round, RoundId,
  GSDPhase, PhaseStatus, GatingVerdict, DomainEvent,
} from '@orchestra/domain';

/** Порт персистенции состояния сессии. Default impl: InMemorySessionStore. */
export interface SessionStorePort {
  create(session: Session): Promise<void>;
  get(sessionId: SessionId): Promise<Session | null>;
  update(session: Session): Promise<void>;
  listRounds(sessionId: SessionId): Promise<Round[]>;
}

/** Результат оценки gating. Consensus Engine в Wave 7 будет реальным источником. */
export interface GatingResult {
  verdict: GatingVerdict;
  gaps: string[];         // при fail — список пробелов (метрики ниже порога)
  phase: GSDPhase;
}

/** Порт оценки gating. Default impl (Phase 6): StubGating. Wave 7: реальный адаптер. */
export interface GatingPort {
  evaluate(sessionId: SessionId, phase: GSDPhase): Promise<GatingResult>;
}

/** Запись аудита (owner-override и др.). */
export interface AuditRecord {
  id: string;             // детерминированный
  sessionId: SessionId;
  phase: GSDPhase;
  reason: string;
  occurredAt: string;
}

/** Порт аудиторского лога. Default impl: InMemoryAuditLog. */
export interface AuditPort {
  record(entry: Omit<AuditRecord, 'id' | 'occurredAt'> & { id?: string }): Promise<AuditRecord>;
  list(sessionId: SessionId): Promise<AuditRecord[]>;
}

/** Порт публикации событий (Event Bus). Phase 6: no-op default. Wave 7: реальная шина. */
export interface EventPublisherPort {
  publish(event: DomainEvent): Promise<void>;
}

export interface GsdEngineOptions {
  store?: SessionStorePort;
  gating?: GatingPort;
  audit?: AuditPort;
  events?: EventPublisherPort;
}
```

### 3.2. `phase-machine.ts` — FSM (детерминированный, канон из Architecture.md §9)

```typescript
import type { GSDPhase } from '@orchestra/domain';

/**
 * Карта переходов FSM. Источник: docs/Architecture.md §9 state diagram.
 * null = терминал (exit). Iteration → Specification — единственный возврат.
 * При gating fail на Consensus → Iteration (обрабатывается в advancePhase, не в map).
 */
export const TRANSITION_MAP: Record<GSDPhase, GSDPhase | null> = {
  Discover: 'Goal',
  Goal: 'Specification',
  Specification: 'Architecture',
  Architecture: 'Implementation',
  Implementation: 'Review',
  Review: 'Consensus',
  Consensus: null,        // терминал: exit при PASS+approve, ИЛИ Iteration при FAIL
  Iteration: 'Specification',
};

/** Фазы с обязательным human-approve (GSD Integration.md §4). */
export const HARD_GATES: readonly GSDPhase[] = ['Architecture', 'Consensus'] as const;

export function isTerminal(phase: GSDPhase): boolean {
  return TRANSITION_MAP[phase] === null;
}

export function nextPhase(phase: GSDPhase): GSDPhase | null {
  return TRANSITION_MAP[phase];
}

export function isHardGate(phase: GSDPhase): boolean {
  return HARD_GATES.includes(phase);
}

export function canTransition(phase: GSDPhase): boolean {
  return !isTerminal(phase);
}
```

### 3.3. `gsd-engine.ts` — оркестратор FSM

```typescript
import type {
  Session, SessionId, Round, RoundId,
  GSDPhase, PhaseStatus, PhaseChanged, RoundStarted, OwnerOverrideApplied,
} from '@orchestra/domain';
import type {
  SessionStorePort, GatingPort, AuditPort, EventPublisherPort, GsdEngineOptions, GatingResult,
} from './types.js';
import { InMemorySessionStore } from './in-memory-store.js';
import { StubGating } from './stub-gating.js';
import { InMemoryAuditLog } from './audit-log.js';
import { isTerminal, nextPhase, isHardGate, canTransition } from './phase-machine.js';

/**
 * GSD Engine — конечный автомат фаз GSD (Architecture.md §9, GSD Integration.md).
 * NOT an LLM, NOT a DB. Pure orchestration of FSM + gating + human-approval.
 *
 * Invariant'ы (GSD Integration.md §3):
 * 1. advancePhase блокирует при gating fail (без override — перехода нет).
 * 2. Architecture/Consensus — hard gates: переход требует approve.
 * 3. overrideGate логируется в AuditPort (аудиторский след).
 */
export class GsdEngine {
  constructor(private readonly options: GsdEngineOptions = {}) {
    this.store = options.store ?? new InMemorySessionStore();
    this.gating = options.gating ?? new StubGating();
    this.audit = options.audit ?? new InMemoryAuditLog();
    this.events = options.events ?? { publish: async () => {} };  // no-op default (D-F2)
  }
  // ... поля store/gating/audit/events ...

  async startSession(input: { name: string; projectId: string }): Promise<Session>;
  async startRound(sessionId: SessionId): Promise<Round>;
  async advancePhase(sessionId: SessionId): Promise<AdvancePhaseResult>;
  async approveTransition(sessionId: SessionId): Promise<Session>;
  async overrideGate(sessionId: SessionId, reason: string): Promise<Session>;
  async getSession(sessionId: SessionId): Promise<Session | null>;
  async listRounds(sessionId: SessionId): Promise<Round[]>;
}

/**
 * Результат advancePhase. Дискриминированный union для типобезопасной обработки UI/API.
 */
export type AdvancePhaseResult =
  | { status: 'transitioned'; from: GSDPhase; to: GSDPhase; event: PhaseChanged }
  | { status: 'gated'; phase: GSDPhase; gaps: string[] }                      // gating fail
  | { status: 'awaiting_approval'; phase: GSDPhase }                          // hard gate, ждёт approve
  | { status: 'terminal'; phase: GSDPhase }                                   // Consensus exit
  | { status: 'iteration'; from: GSDPhase; to: 'Iteration'; gaps: string[] }; // Consensus fail → Iteration
```

#### Алгоритм `advancePhase(sessionId)`:

```
1. session = store.get(sessionId); if (!session) throw UnknownSessionError
2. phase = session.currentPhase
3. if isTerminal(phase) return { status: 'terminal', phase }   // Consensus уже пройден
4. result = gating.evaluate(sessionId, phase)
5. if result.verdict === 'fail':
     // Special case: Consensus fail → Iteration (GSD Integration.md §1)
     if phase === 'Consensus':
         session.currentPhase = 'Iteration'
         session.phaseStatus = 'in_progress'  // (в Round пишется, PhaseStatus в сессии)
         emit PhaseChanged{ from:'Consensus', to:'Iteration', gatingVerdict:'fail' }
         store.update(session)
         return { status:'iteration', from:'Consensus', to:'Iteration', gaps: result.gaps }
     // Иначе — блокировка, ждём override/новую итерацию
     return { status:'gated', phase, gaps: result.gaps }
6. // gating pass
7. if isHardGate(phase) && !session.approvals[phase]:
     session.phaseStatus = 'awaiting_approval'
     store.update(session)
     return { status:'awaiting_approval', phase }
8. // Выполняем переход
   target = nextPhase(phase); if (!target) → terminal
   session.currentPhase = target
   session.phaseStatus = 'not_started'
   emit PhaseChanged{ from:phase, to:target, gatingVerdict:'pass' }
   store.update(session)
   return { status:'transitioned', from:phase, to:target, event }
```

> **Заметка о PhaseStatus в Session:** для MVP PhaseStatus можно держать в отдельной
> `Map<SessionId, PhaseStatus>` внутри engine (или как поле `session.phaseStatus`).
> Кодер выбирает — но канон: `Session` в domain должен остаться чистой сущностью данных,
> без runtime-логики. Опционально добавить `phaseStatus?: PhaseStatus` в Session (§2.1).

---

## 4. Defaults (повторяют канон Phase 4 MockHttpPort)

### 4.1. `in-memory-store.ts` — InMemorySessionStore

`Map<SessionId, Session>` в памяти. `create/get/update/listRounds`. Round.id =
`round-${sessionId}-${number}` (детерминированный, см. §5).

### 4.2. `stub-gating.ts` — StubGating

```typescript
export class StubGating implements GatingPort {
  async evaluate(_sessionId, phase): Promise<GatingResult> {
    // MVP: non-hard-gate фазы → pass (FSM свободно идёт до Architecture).
    // Hard gates (Architecture/Consensus) → pass, но advancePhase всё равно потребует approve.
    // Это позволяет тестировать FSM end-to-end без Consensus Engine (D-F4).
    return { verdict: 'pass', gaps: [], phase };
  }
}
```

> StubGating всегда возвращает `pass` — реальный gating будет в Wave 7 через Consensus.
> **Hard gate проверяется ОТДЕЛЬНО в advancePhase (шаг 7)**, не в gating. Это разделение
> ответственности: GatingPort = confidence/метрики (Consensus), hard gate = human approval
> (FSM-инвариант).

### 4.3. `audit-log.ts` — InMemoryAuditLog

`AuditRecord[]` в памяти. `record/list`. record.id = `audit-${sessionId}-${index}`
(детерминированный).

---

## 5. Детерминизм (КРИТИЧНО — повторяет Phase 5 канон)

`GsdEngine` — **чистая функция от входа** при фиксированных stubs:
- `Session.id` = `session-${projectId}-${timestamp}` — НО timestamp недетерминирован.
  **Решение:** `startSession` принимает опциональный `id?: SessionId` в input. Тесты
  передают явный id. Прод (`apps/api`) генерирует id (допустимо — сессия уникальна по
  времени создания, воспроизводимость не требуется на уровне session-id).
- `Round.id` = `round-${sessionId}-${number}` — детерминированный (number = порядковый).
- `AuditRecord.id` = `audit-${sessionId}-${index}` — детерминированный.
- `DomainEvent.id` = `${type}-${sessionId}-${counter}` — детерминированный.

> `Date.now()` допустим **только** для `createdAt`/`occurredAt`/`startedAt` (временные метки
> сущностей). Он НЕ влияет на id или логику переходов. Тесты, проверяющие детерминизм
> FSM-переходов, не сравнивают timestamp'ы (или передают явные).

---

## 6. NestJS-обёртка (apps/api/src/gsd/)

```typescript
// gsd-engine.service.ts
@Injectable()
export class GsdEngineService {
  private readonly engine: GsdEngine;

  constructor(
    private readonly contextService: ContextService,      // для Wave 7 wiring (пока не вызывается)
    private readonly roleRouterService: RoleRouterService, // для Wave 7 wiring (пока не вызывается)
    private readonly consensusService: ConsensusService,   // для Wave 7 wiring (пока не вызывается)
  ) {
    // Phase 6: InMemory + StubGating defaults. Wave 7: заменить на реальные адаптеры.
    this.engine = new GsdEngine({
      store: new InMemorySessionStoreAdapter(),
      gating: new StubGatingAdapter(),
      audit: new InMemoryAuditLogAdapter(),
    });
  }

  async startSession(name: string, projectId: string): Promise<Session> {
    return this.engine.startSession({ name, projectId });
  }
  async startRound(sessionId: string): Promise<Round> { return this.engine.startRound(sessionId); }
  async advancePhase(sessionId: string): Promise<AdvancePhaseResult> {
    return this.engine.advancePhase(sessionId);
  }
  async approveTransition(sessionId: string): Promise<Session> {
    return this.engine.approveTransition(sessionId);
  }
  async overrideGate(sessionId: string, reason: string): Promise<Session> {
    return this.engine.overrideGate(sessionId, reason);
  }
}

// gsd.module.ts
@Module({
  imports: [ContextModule, RolesModule, ConsensusModule],  // для Wave 7 wiring
  providers: [GsdEngineService],
  exports: [GsdEngineService],
})
export class GsdModule {}
```

`app.module.ts`: `imports: [KgModule, ContextModule, RolesModule, ConsensusModule, GsdModule]`.

> **Note:** GsdEngineService пока не вызывается ни одним controller (HTTP-эндпоинт — Wave 8
> с UI). В этой фазе достаточно, что модуль инжектируется и собирается (build green).
> Повторяет канон Phase 4/5.

---

## 7. must_haves.truths (D-критерии для code review)

### Domain-расширение

- **D-01** `packages/domain/src/session.ts` создан с Session/Round/SessionId/RoundId/RoundStatus.
- **D-02** `packages/domain/src/events.ts` создан с RoundStarted/PhaseChanged/OwnerOverrideApplied
  + DomainEvent base.
- **D-03** `gsd.ts` расширен PhaseStatus; GSDPhase НЕ изменён.
- **D-04** `consensus.ts`: GSDAction остался `string` (обратно-совместимо) + добавлен
  PhaseTransitionAction union. ConsensusReport НЕ сломан.
- **D-05** `index.ts` экспортирует session + events.
- **D-06** **Регрессия:** typecheck ВСЕХ 9 существующих пакетов (до gsd-engine) остался green
  после domain-расширения. `pnpm -r typecheck` — ни одного error в domain/context-service/
  role-router/providers/consensus-engine/knowledge-graph/prompt-registry/api/web.

### FSM (phase-machine.ts)

- **D-07** TRANSITION_MAP покрывает 7 прямых переходов (Discover→Goal→...→Review→Consensus).
- **D-08** `Consensus: null` (терминал). `Iteration: 'Specification'` (единственный возврат).
- **D-09** HARD_GATES = ['Architecture', 'Consensus'].
- **D-10** isTerminal/nextPhase/isHardGate/canTransition — чистые функции, экспортированы.

### GsdEngine API

- **D-11** `startSession({name, projectId})` создаёт Session с currentPhase='Discover',
  сохраняет в store, возвращает Session.
- **D-12** `startRound(sessionId)` создаёт Round с инкрементным number, phase=currentPhase,
  status='in_progress', добавляет в session.rounds.
- **D-13** `advancePhase` возвращает AdvancePhaseResult (дискриминированный union).
- **D-14** `advancePhase` при gating fail на non-Consensus → `{status:'gated', gaps}` (без перехода).
- **D-15** `advancePhase` при gating fail на Consensus → `{status:'iteration', to:'Iteration'}`.
- **D-16** `advancePhase` на hard gate без approve → `{status:'awaiting_approval', phase}`.
- **D-17** `advancePhase` на terminal Consensus → `{status:'terminal', phase}`.
- **D-18** `approveTransition(sessionId)` выставляет approval для текущей hard-gate фазы,
  повторный advancePhase выполняет переход.
- **D-19** `overrideGate(sessionId, reason)` выполняет переход (минуя gating/hard-gate),
  логирует AuditRecord, возвращает обновлённую Session.

### Порты / Store

- **D-20** SessionStorePort/GatingPort/AuditPort/EventPublisherPort — interfaces в types.ts.
- **D-21** InMemorySessionStore/StubGating/InMemoryAuditLog — defaults (как MockHttpPort Phase 4).
- **D-22** `packages/gsd-engine/src/` без `@nestjs`/`@prisma`/сетевых библиотек.
  `grep -rn "@nestjs\|@prisma\|node-fetch\|axios" packages/gsd-engine/src/` → пусто.

### NestJS

- **D-23** GsdModule создан, imports ContextModule/RolesModule/ConsensusModule,
  providers/exports [GsdEngineService].
- **D-24** AppModule.imports += GsdModule. api build green.
- **D-25** apps/api/package.json += `"@orchestra/gsd-engine": "workspace:*"`.

### Тесты / verifier

- **D-26** `gsd-engine.spec.ts` существует, минимум 6 сценариев (см. §8). node:test + node:assert.
- **D-27** Test-script: `"test": "node --import tsx --test test/gsd-engine.spec.ts"`
  (явный путь — урок Phase 5 D-E5).
- **D-28** `pnpm --filter @orchestra/gsd-engine test` → все green, exit 0.

### Build / регрессия

- **D-29** `pnpm -r typecheck` → 10 пакетов green (9 + gsd-engine). Exit 0.
- **D-30** `pnpm --filter @orchestra/gsd-engine build` → dist/ сгенерирован, exit 0.
- **D-31** `pnpm --filter @orchestra/api build` → green (с GsdModule). Exit 0.
- **D-32** `pnpm --filter @orchestra/consensus-engine build` + role-router + providers → green
  (Phase 4/5 не сломаны).
- **D-33** Clean rebuild api: `rm -rf apps/api/dist && build` → `apps/api/dist/main.js` существует.
- **D-34** `apps/web/` не тронут (регрессия исключена через git status).

---

## 8. Тестовый сьют (часть verifier'а)

`packages/gsd-engine/test/gsd-engine.spec.ts` — минимум 6 сценариев:

```typescript
describe('GsdEngine', () => {
  // T1: startSession → Session с currentPhase='Discover', rounds=[]
  //     startRound → Round{number:1, phase:'Discover', status:'in_progress'}

  // T2: advancePhase по FSM Discover→Goal→Specification (non-hard, StubGating pass)
  //     3 последовательных advancePhase дают 3 transitioned-результата, currentPhase='Specification'

  // T3: advancePhase на Architecture (hard gate) без approve → {status:'awaiting_approval'}
  //     approveTransition(sessionId) → повторный advancePhase → {status:'transitioned', to:'Implementation'}

  // T4: advancePhase на Consensus с gating fail (injected mock gating) → {status:'iteration', to:'Iteration'}
  //     затем advancePhase на Iteration → {status:'transitioned', to:'Specification'}

  // T5: overrideGate(sessionId, 'test override') → AuditRecord залогирован,
  //     audit.list(sessionId) возвращает запись с reason='test override'
  //     переход выполнен минуя gating

  // T6: Детерминизм — startSession с явным id, прогон FSM, сравнение раундов (id детерминированы,
  //     round-<sessionId>-1, round-<sessionId>-2...). Timestamp'ы не сравниваем.

  // T7 (опц.): terminal — дойти до Consensus pass+approve → {status:'terminal'}, повторный advancePhase снова terminal
});
```

---

## 9. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-34 PASS.
2. `pnpm -r typecheck` + build 10 пакетов green.
3. `pnpm --filter @orchestra/gsd-engine test` → 6/6+ green.
4. Anti-conflict: `git diff` по всем защищённым зонам (§1 таблица) → пусто, КРОМЕ
   разрешённых domain-расширений (session.ts/events.ts новые, gsd.ts/consensus.ts дополнены).
5. Pipeline Orchestra имеет исполняемый жизненный цикл:
   `startSession → startRound → advancePhase (FSM) → approveTransition (hard gate) → overrideGate (audit)`.

**Фаза НЕ выполнена, если:**
- Domain-расширение сломало typecheck существующих пакетов (D-06 FAIL).
- FSM пропускает hard gate или gating fail (D-14/D-15/D-16 FAIL).
- overrideGate не логирует в аудит (D-19 FAIL) — ломает GSD Integration §3 инвариант.
- gsd-engine зависит от @nestjs/@prisma (D-22 FAIL).
- Phase 4/5 регрессия (D-32 FAIL).

---

## 10. Anti-conflict явный (повтор для кодера)

КОДЕР НЕ ТРОГАЕТ:
- `packages/domain/src/{agent,context,decision,kg}.ts` — существующие контракты.
- `packages/{role-router,providers,context-service,prompt-registry,knowledge-graph,consensus-engine}/` — фазы 2-5.
- `apps/web/`, `docs/`, `role-manifests/`, `prompts/`, `.planning/phases/0[1-5]/`.
- `tsconfig.base.json`, `pnpm-workspace.yaml`.

КОДЕР СОЗДАЁТ/ИЗМЕНЯЕТ:
- `packages/domain/src/session.ts` (новый), `events.ts` (новый).
- `packages/domain/src/gsd.ts` (+PhaseStatus), `consensus.ts` (+PhaseTransitionAction).
- `packages/domain/src/index.ts` (+2 export).
- `packages/gsd-engine/**` (новый пакет).
- `apps/api/src/gsd/**` (новый модуль).
- `apps/api/src/app.module.ts` (+1 import), `apps/api/package.json` (+1 dep).

---

## 11. Порядок работы кодера

1. **Domain-расширение** (§2): session.ts, events.ts, gsd.ts (+PhaseStatus), consensus.ts
   (+PhaseTransitionAction), index.ts. Прогнать `pnpm --filter @orchestra/domain typecheck` → green.
2. **Регрессия D-06:** `pnpm -r typecheck` → все 9 существующих пакетов green.
3. **Скелет пакета** gsd-engine (package.json, tsconfig.json, src/, test/).
4. **phase-machine.ts** (FSM) + юнит-проверка переходов в голове.
5. **types.ts** (порты) → **in-memory-store.ts** → **stub-gating.ts** → **audit-log.ts**.
6. **gsd-engine.ts** (оркестратор, алгоритм §3.3).
7. **index.ts** (barrel).
8. **test/gsd-engine.spec.ts** (T1-T7).
9. **NestJS-обёртка** apps/api/src/gsd/ + app.module.ts + package.json.
10. Прогон verifier: `pnpm install` → `pnpm -r typecheck` → `pnpm -r build` →
    `pnpm --filter @orchestra/gsd-engine test`. Всё green.
11. `6-01-SUMMARY.md` (по образцу Phase 5 SUMMARY).

**Оценка:** ~3-4 часа.

---

## 12. Design notes (почему так)

1. **Domain-расширение вместо локальных типов.** В отличие от Phase 4/5 (где типы жили в
   пакете), Session/Round — сущности, шарящиеся между пакетами (ContextPacket.sessionId,
   ConsensusReport.roundId, Decision.roundId). Держать их в gsd-engine значило бы копить
   техдолг. Owner-решение (AskUserQuestion) — расширить domain.

2. **GSDAction обратно-совместимо.** Phase 5 buildNextAction возвращает string. Ломать =
   регрессия Phase 5. Кодер добавляет PhaseTransitionAction как дополнение, string остаётся.
   Wave 7 унифицирует.

3. **GatingPort = абстракция над Consensus.** В Phase 6 StubGating (всегда pass). Это
   позволяет тестировать FSM end-to-end без LLM/Consensus (повторяет MockHttpPort канон).
   Wave 7 (D-F4) подставит реальный адаптер → ConsensusService.run(). Развязка чистая.

4. **Hard gate ОТДЕЛЬНО от gating.** GatingPort = confidence/метрики (Consensus, данные).
   Hard gate = human approval (FSM-инвариант, Architecture.md §9). Не смешивать: gating
   может pass, но hard gate всё равно требует approve (Consensus phase).

5. **EventPublisherPort = no-op default (D-F2).** GsdEngine формирует DomainEvent объекты
   (для будущего emit), но publish = no-op. Wave 7 подключит Redis+BullMQ. Это закладывает
   точки расширения без premature infrastructure.

6. **NestJS без endpoint'а (повтор Phase 4/5).** GsdEngineService не вызывается HTTP-роутом.
   Wave 8 (UI) добавит контроллеры. Смысл — собрать FSM + доказать build/testability.

7. **PhaseStatus — опционально в Session.** Кодер решает: поле в Session ИЛИ отдельная Map
  в engine. Канон: Session — чистая сущность данных, без runtime-логики. Если поле нужно
   UI — добавить `phaseStatus?: PhaseStatus` в Session (§2.1 опционально).

---

## 13. Долги, которые фаза ОТКРЫВАЕТ

- **D-F1** Prisma/PostgreSQL персистенция SessionStore. **Когда:** Wave 7 (закроет D-B2).
  **Блокирует:** НЕТ (InMemorySessionStore работает для MVP).
- **D-F2** Event Bus публикация RoundStarted/PhaseChanged. **Когда:** Wave 7 (закроет
  D-D1/D-C4). **Блокирует:** НЕТ (events формируются, emit = no-op).
- **D-F3** KG-запись артефактов фаз. **Когда:** Wave 7. **Блокирует:** НЕТ.
- **D-F4** Реальная wiring GatingPort → ConsensusService. **Когда:** Wave 7. **Блокирует:**
  НЕТ (StubGating позволяет тестировать FSM).

Все 4 — non-blocking, имеют явный Wave. MVP FSM работает с ними как known-limitations.

---

## 14. Что получает Orchestra после Phase 6

Pipeline Orchestra имеет **исполняемый жизненный цикл GSD**:

```
startSession('feature X', 'proj-1')
  → startRound → advancePhase (Discover→Goal→...→Consensus)
  → approveTransition (hard gate на Architecture)
  → overrideGate (audit record при необходимости)
  → terminal (Consensus exit + Decision sign-off)
```

GSD Engine связывает Context/RoleRouter/Consensus в единую систему (API готов, реальная
wiring трёх сервисов в advancePhase — Wave 7, D-F4).

**Phase 7 кандидаты (Wave 7):**
- **Event Bus** (Redis+BullMQ) — закроет D-F2 + D-D1 + D-C4 + D-E2 одной фазой.
- **Decision Repository** (Prisma) — закроет D-F1 + D-E3 + D-B2 (персистенция).
- **GatingPort wiring** — подключить ConsensusService.run() к GatingPort (D-F4).
- **HTTP API + UI Conducting Score** — Wave 8.

Безопасно стартовать Phase 7: D-29 typecheck стабильно зелёный на 10 пакетах, GsdEngine
управляет FSM с детерминированными id, hexagonal-порты готовы к подключению Event Bus и
Prisma. Phase 6 готова к исполнению.
