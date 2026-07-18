---
phase: 5
slug: 05-consensus-engine
wave: B-5
title: "Consensus Engine (Wave 5) — детерминированная агрегация ответов ролей в ConsensusReport"
milestone: "Orchestra MVP — Wave 5 (Consensus Layer)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-18
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm -r build, 9 пакетов green) + consensus-engine.spec.ts (детерминированные сценарии gating)
baseline_before: "Phase 4 заморожена: typecheck 8 пакетов green, role-router/providers/api/web build green, pipeline KG→Context→RoleRouter→Provider→Response исполняем"
depends_on:
  - "Phase 4 (RoleRouter.route → RouteResult{response: Response} готов к агрегации)"
  - "Phase 2 (KgService — НЕ трогать)"
  - "Phase 1 (domain types — расширяем без ломания)"
closes_debts: []
opens_debts_expected:
  - "D-E1: Реальная семантическая кластеризация через embeddings (MVP = структурные правила по claim-парсингу) — Wave 6+"
  - "D-E2: Continuous Consensus (пересчёт после каждого AgentResponded) — требует Event Bus (Wave 6, закроет D-D1/D-C4 попутно)"
  - "D-E3: Персистенция ConsensusReport в Decision Repository — Wave 6 (с подключением реальной PostgreSQL)"
  - "D-E4: Плагин Consensus Strategy (PluggableStrategies) — Wave 6+ (сейчас GatingPolicy/ClaimPolicy захардкожены как классы)"
---

# PLAN 5-01 — Consensus Engine (Wave 5)

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `5-01-SUMMARY.md`. Tech Lead делает code review против `must_haves.truths` ниже.

## 0. Контекст фазы (почему и что)

Phase 4 заморозила **исполняемый агент-слой**: `KG → ContextService.buildPacket →
RoleRouter.route → AIProvider.send → Response`. Теперь у нас есть `Response[]` от ролей
раунда — но эти ответы нужно превратить в формализованное инженерное решение.

**Следующий узел pipeline** (Architecture.md §4, строки 155–158; Consensus Protocol.md §1):

```
Role Router → AIProvider.send ──> Response[]
                                        │
                                        ▼
                           ┌──────────────────────────┐
                           │     Consensus Engine     │
                           │  (детерминированный,     │
                           │   не LLM)                │
                           └────────────┬─────────────┘
                                        │
                                        ▼
                              ConsensusReport
                              { agreedDecisions, disagreements,
                                risks, confidence, gatingVerdict }
```

Этой фазой Orchestra получает **слой агрегации решений**. Вход = `Response[]` раунда +
`GSDPhase` (для выбора gating-политики), выход = `ConsensusReport` (доменный контракт из
`packages/domain/src/consensus.ts` — **УЖЕ СУЩЕСТВУЕТ**, его НЕ трогать).

**Ключевое инвариантное свойство (Consensus Protocol.md §1, §8):** «Consensus Engine — не
LLM. Это отдельный детерминированный модуль приложения». Это значит:
1. Никаких сетевых вызовов, никаких провайдеров, никакого stochastique.
2. Одинаковый вход → одинаковый выход (pure function на уровне `generate()`).
3. testable без API-ключей и БД — повторяет канон Phase 4 (MockHttpPort).

Это позволяет поставить Consensus Engine **до** Event Bus, GSD Engine runtime и Decision
Repository — он не зависит ни от одного из них, но является входной точкой для будущего
GSD Engine (Phase 6: `gsdEngine.attemptTransition() → consensusEngine.gate(phase, report)`).

### Что закрывает фаза

- `packages/consensus-engine` — ядро Consensus Engine: агрегация `Response[]` →
  `ConsensusReport`, 9 этапов протокола (Consensus Protocol.md §3), gating по фазам GSD.
- `apps/api/src/consensus/` — NestJS-обёртка: `ConsensusService.run(responses, phase)`,
  инжектируется в `AppModule`.
- **Детерминированный gating gate** (Consensus Protocol.md §6, GSD Integration.md §3):
  пороговые значения по фазам зафиксированы в `GatingPolicy`, verdict `pass`/`fail`.
- **Claim extraction** — структурный парсинг ответов ролей в atomic claims (MVP-стратегия,
  без embedding-модели — см. D-E1).
- **Тестовый сьют** `consensus-engine.spec.ts` — детерминированные сценарии gating, claim
  extraction, confidence calculation. Это часть verifier'а фазы.

### Что НЕ в scope (забор на Wave 6+)

- **Реальная семантическая кластеризация через embeddings** — MVP использует структурные
  правила (claim-парсинг по заголовкам/буллетам + точное совпадение ключевых терминов) →
  долг **D-E1** (Wave 6+ когда подключим embedding-модель в Knowledge Graph).
- **Continuous Consensus** (пересчёт после каждого `AgentResponded`) — требует Event Bus,
  которого ещё нет → долг **D-E2** (Wave 6, закроет попутно D-D1/D-C4).
- **Персистенция ConsensusReport** в Decision Repository → долг **D-E3** (Wave 6 с PostgreSQL).
- **Плагин `Consensus Strategy`** (Agent Protocol.md §8 Plugin SDK) — сейчас `GatingPolicy`
  и `ClaimPolicy` — конкретные классы, не плагины → долг **D-E4** (Wave 6+, low priority).
- **Генерация ADR** (Consensus Protocol.md этап 8) — форматирование ADR-документа из
  accepted decisions → Wave 6 (с Decision Repository, куда он пойдёт).
- **Event Bus publishing** (`ConsensusGenerated`, `ConfidenceRecalculated`) → D-E2 / Wave 6.

---

## 1. Целевая структура (файлы, которые создаёт кодер)

```
packages/
├── consensus-engine/                       # НОВЫЙ ПАКЕТ
│   ├── package.json                        # name: @orchestra/consensus-engine, dep: @orchestra/domain
│   ├── tsconfig.json                       # как у role-router (outDir/rootDir/src)
│   ├── README.md                           # 5-7 строк: назначение, порты, что НЕ делает (не LLM, не БД)
│   ├── src/
│   │   ├── types.ts                        # порты + типы конфигурации (см. §3)
│   │   ├── claim-extractor.ts              # этапы 1-2: корпус → atomic claims с ролями-авторами
│   │   ├── claim-clusterer.ts              # этап 3: структурная кластеризация claims (без embeddings)
│   │   ├── conflict-detector.ts            # этап 4: поиск conflicts_with-отношений между кластерами
│   │   ├── confidence-calculator.ts        # этап 5: DecisionConfidence по кластерам + фазе
│   │   ├── agreement-assessor.ts           # этап 6: уровень согласия (% за/против/воздержались)
│   │   ├── report-builder.ts               # этапы 7+9: формирование ConsensusReport.summary + nextAction
│   │   ├── gating-policy.ts                # этап 9 + §6: gatingVerdict pass/fail по порогам фазы
│   │   ├── consensus-engine.ts             # ОРКЕСТРАТОР: run(responses, phase) → ConsensusReport (9 этапов)
│   │   ├── strategies/                     # конфиг-стратегии (НЕ плагины — см. D-E4)
│   │   │   ├── gating-thresholds.ts        # пороги по фазам GSD (Consensus Protocol.md §6 таблица)
│   │   │   └── claim-syntax.ts             # синтаксические правила claim extraction
│   │   └── index.ts                        # barrel export
│   └── test/
│       └── consensus-engine.spec.ts        # детерминированные сценарии (см. §7)
│
apps/api/src/
├── consensus/                              # НОВЫЙ NestJS-модуль
│   ├── consensus.module.ts                 # providers: [ConsensusService], exports: [ConsensusService]
│   ├── consensus.service.ts                # NestJS-обёртка: new ConsensusEngine(defaults).run(...)
│   └── README.md                           # 3 строки: как подключается, какие дефолты
│
app.module.ts                                # ИЗМЕНИТЬ: imports += ConsensusModule

apps/api/package.json                        # ИЗМЕНИТЬ: +1 workspace-dep (@orchestra/consensus-engine)
pnpm-workspace.yaml                          # НЕ ТРОГАТЬ (packages/* уже covers)
```

### Файлы, которые НЕ трогать (anti-conflict)

| Зона | Почему нельзя | Проверка |
|---|---|---|
| `packages/domain/src/**` | Контракты `ConsensusReport`/`Decision`/`Conflict`/`Risk`/`Question`/`DecisionConfidence`/`GatingVerdict`/`GSDAction`/`GSDPhase` уже существуют — Phase 5 реализует поверх них | `git diff packages/domain/src/` → пусто |
| `docs/**` | Канон-документы. Consensus Protocol.md — источник правды для алгоритма, не редактируется кодером | `git diff docs/` → пусто |
| `packages/role-router/`, `packages/providers/` | Phase 4 заморожена. Consensus Engine консьюмит их выход, но не меняет | `git diff packages/role-router/ packages/providers/` → пусто |
| `packages/context-service/`, `packages/prompt-registry/`, `packages/knowledge-graph/` | Фазы 2-3 заморожены | `git diff` → пусто по каждой |
| `apps/web/` | Frontend — Wave 7+. Conducting Score UI требует ConsensusReport, но его рендеринг не в этой фазе | `git diff apps/web/` → пусто |
| `role-manifests/`, `prompts/` | Роли и промпты — seed-данные, Consensus работает с их выходом | `git diff` → пусто |
| `.planning/phases/0[1-4]/` | Замороженные фазы | `git diff` → пусто |

**Единственные изменения вне нового пакета и нового NestJS-модуля:**
- `apps/api/src/app.module.ts` — `imports: [KgModule, ContextModule, RolesModule, ConsensusModule]`
- `apps/api/package.json` — `+ "@orchestra/consensus-engine": "workspace:*"`

---

## 2. Доменные контракты (ИСХОДНИК ПРАВДЫ — НЕ ТРОГАТЬ)

Все типы результата УЖЕ в `packages/domain/src/`. Кодер читает их и реализует так, чтобы
`ConsensusEngine.run()` возвращал ровно эти типы. **Ни одного нового поля в domain.**

```typescript
// packages/domain/src/consensus.ts (существует — НЕ изменять)
export interface Question { id, text, askedBy? }
export interface Risk { id, description, severity: 'low'|'medium'|'high'|'critical', mitigation? }
export interface Conflict { id, topic, positions: { role: RoleRef, claim: string }[] }
export type GSDAction = string;
export type GatingVerdict = 'pass' | 'fail';
export interface DecisionConfidence {
  architecture: number; implementation: number; researchCoverage: number;
  riskCoverage: number; testCoverage: number; overall: number;  // все 0..100
}
export interface ConsensusReport {
  id: string; roundId: string; summary: string;
  agreedDecisions: Decision[];
  disagreements: Conflict[];
  openQuestions: Question[];
  risks: Risk[];
  nextAction: GSDAction;
  confidence: DecisionConfidence;
  gatingVerdict: GatingVerdict;
}

// packages/domain/src/decision.ts (существует — НЕ изменять)
export interface Decision {
  id, roundId, title, description,
  status: 'proposed'|'accepted'|'rejected',
  acceptedBy: RoleRef[], rejectedBy: RoleRef[];
}

// packages/domain/src/agent.ts (существует — НЕ изменять)
export interface Response { requestId: string; content: string; finishReason: string; }

// packages/domain/src/gsd.ts (существует — НЕ изменять)
export type GSDPhase = 'Discover'|'Goal'|'Specification'|'Architecture'|'Implementation'|'Review'|'Consensus'|'Iteration';
```

**Вход ConsensusEngine** — это `Response[]`, где каждый `Response` сопоставлен с `RoleRef`.
Поскольку `Response` (Phase 4) не содержит `role`, кодер вводит **входной тип в своём
пакете** (НЕ в domain — domain не трогаем):

```typescript
// packages/consensus-engine/src/types.ts (НОВЫЙ — в пакете, не в domain)
import type { Response, RoleRef, GSDPhase, ConsensusReport } from '@orchestra/domain';

export interface RoleResponse {
  role: RoleRef;        // кто ответил
  response: Response;   // что ответил (контракт Phase 4)
}

export interface ConsensusInput {
  roundId: string;
  phase: GSDPhase;
  responses: RoleResponse[];
}

export type { ConsensusReport } from '@orchestra/domain';
```

> **Design note:** почему `RoleResponse` в пакете, а не в domain? `Response` в domain — это
> чистый выход провайдера (RequestId+content+finishReason), без знания о роли. Связка
> «роль → её ответ» — артефакт агрегации, интересующий только Consensus Engine. Добавлять
> `role` в domain `Response` значило бы ломать контракт Phase 4 (нарушение anti-conflict).
> Это повторяет канон: домен хранит инварианты системы, пакет — свои внутренние типы.

---

## 3. Hexagonal-порты и стратегии

Consensus Engine — детерминированное ядро без side-effects. Порты здесь **не внешние**
(нет БД/сети), а **стратегии-инъекции** для тестирования и будущей плагинности (D-E4).

```typescript
// packages/consensus-engine/src/types.ts (продолжение)

/**
 * Стратегия извлечения claims из ответа роли.
 * MVP-реализация (ClaimSyntaxStrategy) — структурная (§4).
 * Будущая (Wave 6) — embedding-based (D-E1).
 */
export interface ClaimExtractionStrategy {
  extract(roleResponse: RoleResponse): Claim[];
}

export interface Claim {
  id: string;
  text: string;
  role: RoleRef;
  category: ClaimCategory;
}

export type ClaimCategory =
  | 'architecture'
  | 'implementation'
  | 'research'
  | 'risk'
  | 'test';

/**
 * Стратегия кластеризации claims в семантические группы.
 * MVP-реализация (StructuralClusterStrategy) — по category + точному совпадению
 * ключевых терминов. Будущая — embedding similarity (D-E1).
 */
export interface ClusterStrategy {
  cluster(claims: Claim[]): ClaimCluster[];
}

export interface ClaimCluster {
  id: string;
  category: ClaimCategory;
  topic: string;
  claims: Claim[];
}

/**
 * Gating-политика: пороги DecisionConfidence по фазам GSD.
 * Реализация DefaultGatingPolicy — Consensus Protocol.md §6 таблица (захардкожена).
 * Будущая (Wave 6) — плагин (D-E4).
 */
export interface GatingPolicy {
  /** Минимальные пороги для перехода ИЗ указанной фазы. Возвращает undefined, если для фазы нет gating. */
  thresholdsForTransitionFrom(phase: GSDPhase): Partial<DecisionConfidence> | undefined;
}

export interface ConsensusEngineOptions {
  claimExtraction?: ClaimExtractionStrategy;
  clustering?: ClusterStrategy;
  gating?: GatingPolicy;
}
```

**Канон:** defaults — конкретные классы `ClaimSyntaxStrategy`, `StructuralClusterStrategy`,
`DefaultGatingPolicy`. Если опции не переданы — ConsensusEngine использует их (повторяет
Phase 3 `DEFAULT_POLICIES`, Phase 4 `MockHttpPort by default`).

---

## 4. MVP-стратегии (детерминированные)

### 4.1 ClaimSyntaxStrategy (этапы 1-2 протокола)

Парсит `response.content` (markdown/string) в atomic claims. **Правила (детерминированные):**

1. **Разбивка на блоки:** по markdown-заголовкам (`#`, `##`, `###`) и буллетам (`-`, `*`,
   `\d+.`). Каждый блок ≤ 1 claim.
2. **Категоризация** по ключевым терминам (case-insensitive substring):
   - `architecture` → «architecture», «component», «module», «ADR», «pattern», «layer»
   - `implementation` → «implement», «code», «migration», «schema», «library»
   - `research` → «research», «benchmark», «study», «evidence», «hypothesis»
   - `risk` → «risk», «threat», «vulnerability», «debt», «concern»
   - `test` → «test», «spec», «coverage», «validate»
   - Если несколько совпадений — первая по приоритету (порядок выше).
   - Если ни одного — категория определяется по `phase` ContextPacket роли (fallback), если
     и фаза не помогает — claim пропускается (не входит в агрегацию).
3. **Role assignment:** каждый claim наследует `role` из `RoleResponse`.
4. **Id:** deterministic — `${role.id}#${index}` (где index — порядковый номер claim в
   ответе роли). Это обеспечивает воспроизводимость id между прогонами (важно для тестов).

### 4.2 StructuralClusterStrategy (этап 3)

Кластеризация claims **без embeddings** (D-E1):

1. Группировка по `category`.
2. Внутри категории — по точному совпадению «нормализованного topic-термина».
   Нормализация: первый ключевой термин категории из claim.text, lowercased, trimmed.
3. `cluster.topic` = этот нормализованный термин.
4. `cluster.claims` = все claims с той же category + тем же topic-термином.
5. **Edge case:** claim без topic-термина (fallback в §4.1 шаг 2 не сработал, но claim
   прошёл) → singleton-cluster (1 claim, topic = первые 5 слов claim.text).

> Это намеренно грубая эвристика. Wave 6 (D-E1) заменит её на embedding similarity через
> модель в Knowledge Graph. MVP-цель — показать детерминированный pipeline end-to-end, а не
> качество NLP.

### 4.3 DefaultGatingPolicy (этап 9 + §6)

Таблица порогов прямо из Consensus Protocol.md §6 / GSD Integration.md §3:

```typescript
// packages/consensus-engine/src/strategies/gating-thresholds.ts
const TRANSITION_THRESHOLDS: Record<GSDPhase, Partial<DecisionConfidence> | undefined> = {
  Goal:          { architecture: 70 },        // Goal → Specification
  Specification: { researchCoverage: 75 },    // Specification → Architecture
  Architecture:  { architecture: 85 },        // Architecture → Implementation
  Implementation:{ implementation: 80 },      // Implementation → Review
  Review:        { riskCoverage: 70 },        // Review → Consensus
  Consensus:     { overall: 80 },             // Consensus → exit
  Discover:      undefined,                    // Discover → Goal: нет gating (стартовая фаза)
  Iteration:     undefined,                    // Iteration — loop-фаза, gating не применим
};
```

`gatingVerdict = 'pass'` если для текущей фазы есть пороги И все применимые метрики ≥ порога.
Если порогов для фазы нет (`undefined`) → verdict = `'pass'` (переход разрешён, gating не
применяется). Это фиксируется в `gating-policy.ts` и покрывается тестом (§7).

---

## 5. Ядро ConsensusEngine (оркестратор 9 этапов)

```typescript
// packages/consensus-engine/src/consensus-engine.ts (скелет — кодер заполняет реализацию)
import type { ConsensusReport, DecisionConfidence } from '@orchestra/domain';
import type { ConsensusInput, ConsensusEngineOptions, Claim, ClaimCluster } from './types.js';

export class ConsensusEngine {
  constructor(private readonly options: ConsensusEngineOptions = {}) {
    // defaults: ClaimSyntaxStrategy, StructuralClusterStrategy, DefaultGatingPolicy
  }

  async run(input: ConsensusInput): Promise<ConsensusReport> {
    // Этап 1-2: claims = responses.flatMap(extract)
    // Этап 3: clusters = cluster(claims)
    // Этап 4: conflicts = detectConflicts(clusters)
    // Этап 5: confidence = calculateConfidence(clusters, input.phase, input.responses)
    // Этап 6: agreement = assessAgreement(clusters)
    // Этап 7: agreedDecisions = clusters → Decision[] (status: 'accepted' если ≥2 ролей согласны)
    //         openQuestions = conflicts без разрешения
    //         risks = claims категории 'risk' → Risk[]
    // Этап 8: (ADR generation — OUT OF SCOPE, см. D-E3) — пропускается
    // Этап 9: gatingVerdict = gating.thresholdsForTransitionFrom(input.phase) → pass/fail
    //         nextAction = gatingVerdict === 'pass' ? `transition from ${phase}` : `iterate: gaps in ${failedMetrics}`
    // return assembleConsensusReport(...)
  }
}
```

### Детерминизм (КРИТИЧНО)

`run()` — **чистая функция от входа** (при фиксированных стратегиях). Это значит:
- Одинаковый `ConsensusInput` → одинаковый `ConsensusReport` (включая `id`, `roundId`).
- `report.id` = детерминированный: `consensus-${roundId}` (НЕ random UUID — это ломает
  воспроизводимость и тесты).
- Все `Decision.id`, `Conflict.id`, `Risk.id`, `Question.id` — детерминированные, выводятся
  из cluster.id / claim.id.
- `Date.now()` НЕ использовать внутри `run()`. Если нужна временная метка — её нести во
  входе (но в текущем контракте `ConsensusReport` нет `createdAt` — значит и не нужно).

> Это отклонение от «обычной» практики random-UUID, но оно продиктовано инвариантом
> Consensus Protocol.md §1 («детерминированный модуль») и требованием воспроизводимости
  артефактов (Engineering Time Machine, Architecture.md §1 п.5). Phase 4 уже следовала
  этому канону (`contentHash` в ContextPacket — детерминированный).

---

## 6. Алгоритм Confidence Calculation (этап 5)

`DecisionConfidence` — 6 метрик, все 0..100. MVP-формулы (детерминированные, простые):

| Метрика | Формула (MVP) |
|---|---|
| `architecture` | % claims категории `architecture` от ожидаемого минимума (3: architect+tech_lead+critic). Если 3 роли дали architecture-claims и ≥2 кластера согласны → 100. Иначе пропорционально. |
| `implementation` | % claims категории `implementation` с ≥1 согласием (cluster size ≥2) от общего числа implementation-claims |
| `researchCoverage` | % claims категории `research` (Gemini/Researcher) от ожидаемого минимума (1). Если есть research-claim → 100, иначе 0 |
| `riskCoverage` | % risk-claims с непустым `mitigation` (в тексте claim есть слово «mitigat»/«resolve»/«prevent») от общего числа risk-claims. Если risk-claims = 0 → 100 (рисков нет = покрыты) |
| `testCoverage` | % claims категории `test` от общего числа claims × 0.5 (MVP: тесты редки, штраф). Clamp 0..100 |
| `overall` | взвешенное среднее: `0.3*architecture + 0.25*implementation + 0.15*researchCoverage + 0.15*riskCoverage + 0.15*testCoverage` |

> Формулы намеренно грубые. Их цель — дать детерминированную, тестопригодную метрику,
> которая реагирует на вход (больше roles → выше coverage). Wave 6 (D-E1, D-E4) заменит их
> на настраиваемую политику. **Важно:** формулы захардкодить в `confidence-calculator.ts`
> с JSDoc-комментарием «MVP formula, subject to D-E1/D-E4 replacement».

---

## 7. Тестовый сьют (часть verifier'а)

`packages/consensus-engine/test/consensus-engine.spec.ts` — детерминированные сценарии.
**Тесты = часть gate** (см. frontmatter `verifier`). Минимум 6 сценариев:

```typescript
describe('ConsensusEngine', () => {
  // T1: Пустой вход (0 responses) → ConsensusReport с пустыми массивами,
  //     confidence = все 0 (кроме riskCoverage=100), gatingVerdict='fail' (если фаза с порогом)
  //     ИЛИ 'pass' (Discover/Iteration). nextAction корректный.

  // T2: Одна роль, один architecture-claim → agreedDecisions пустой (нужно ≥2 ролей),
  //     confidence.architecture низкий, gatingVerdict по фазе.

  // T3: Две роли (architect + tech_lead) дают СОВПАДАЮЩИЙ architecture-claim
  //     → 1 agreedDecision (status: 'accepted', acceptedBy: обе роли),
  //     confidence.architecture высокий, gatingVerdict pass для Architecture→Implementation
  //     (порог 85 — проверить что формула даёт ≥85).

  // T4: Две роли дают ПРОТИВОРЕЧАЩИЕ claims в одной category+topic
  //     → 1 Conflict в disagreements, 0 agreedDecisions по этому topic,
  //     openQuestions содержит вытекающий вопрос.

  // T5: Gating edge case — фаза Discover → gatingVerdict='pass' (нет порогов).
  //     Фаза Iteration → 'pass' (нет порогов).
  //     Фаза Architecture, confidence.architecture=84 (порог 85) → 'fail',
  //     nextAction содержит упоминание пробела ('architecture').

  // T6: Детерминизм — run(input) === run(input) (глубокое равенство, включая id).
  //     Одинаковый вход дважды → byte-идентичные report (JSON.stringify равен).
});
```

**Тест-раннер:** Node native test runner (`node --test`) или vitest — на выбор кодера, но
**без новой heavy-зависимости**. Prefer node:test (уже в Node 22, который в devDeps api).
Добавить script `test` в `packages/consensus-engine/package.json`: `"test": "node --test"`.

---

## 8. NestJS-обёртка (apps/api/src/consensus/)

```typescript
// apps/api/src/consensus/consensus.service.ts (скелет)
import { Injectable } from '@nestjs/common';
import { ConsensusEngine } from '@orchestra/consensus-engine';
import type { ConsensusInput } from '@orchestra/consensus-engine';
import type { ConsensusReport } from '@orchestra/domain';

@Injectable()
export class ConsensusService {
  private readonly engine = new ConsensusEngine(); // defaults — повторяет канон Phase 4

  async run(input: ConsensusInput): Promise<ConsensusReport> {
    return this.engine.run(input);
  }
}

// apps/api/src/consensus/consensus.module.ts
import { Module } from '@nestjs/common';
import { ConsensusService } from './consensus.service.js';

@Module({
  providers: [ConsensusService],
  exports: [ConsensusService],
})
export class ConsensusModule {}
```

`apps/api/src/app.module.ts`: `imports: [KgModule, ContextModule, RolesModule, ConsensusModule]`.

> **Note:** ConsensusService пока не вызывается ни одним controller (HTTP-эндпоинт `/consensus`
> — Wave 7 с UI). В этой фазе достаточно, что модуль инжектируется и собирается (build green).
> Это повторяет Phase 4: RoleRouterService тоже не имел endpoint'а до этой фазы.

---

## 9. must_haves.truths (D-критерии для code review)

Каждый — проверяемый факт. Tech Lead сверяет по коду + git diff + grep + build + tests.

### Архитектура / чистота пакета

- **D-01** `packages/consensus-engine` зависит ТОЛЬКО от `@orchestra/domain` (никаких
  `@nestjs`, `@prisma`, сетевых библиотек). `grep -rn "@nestjs\|@prisma\|node-fetch\|axios" packages/consensus-engine/src/` → пусто.
- **D-02** Domain НЕ изменён. `git diff packages/domain/src/` → пусто.
- **D-03** `packages/domain/src/consensus.ts` контракт `ConsensusReport` НЕ изменён (те же
  поля, те же типы). Проверка: `git diff packages/domain/src/consensus.ts` → пусто.
- **D-04** Возвращаемый тип `ConsensusEngine.run()` — ровно доменный `ConsensusReport`
  (импорт из `@orchestra/domain`, не локальный redefine).

### Контракты и инварианты

- **D-05** `ConsensusEngine` принимает `ConsensusInput` (`{ roundId, phase, responses: RoleResponse[] }`),
  возвращает `ConsensusReport`. Сигнатура: `async run(input: ConsensusInput): Promise<ConsensusReport>`.
- **D-06** `RoleResponse` определён ВНУТРИ пакета (`packages/consensus-engine/src/types.ts`),
  НЕ в domain. Domain `Response` НЕ получает поле `role`.
- **D-07** ConsensusEngine — **детерминированный**: одинаковый вход → одинаковый выход.
  Проверяется тестом T6 (глубокое равенство `run(input)` дважды).
- **D-08** `report.id` = детерминированный (`consensus-${roundId}`), НЕ `crypto.randomUUID()`.
  `grep -n "randomUUID\|Math.random\|Date.now" packages/consensus-engine/src/` → пусто.

### 9 этапов протокола (Consensus Protocol.md §3)

- **D-09** Этапы 1-2 (claim extraction): каждый файл `Response.content` парсится в `Claim[]`
  с `role`, `category`, детерминированным `id`. Реализован `ClaimSyntaxStrategy`.
- **D-10** Этап 3 (clustering): `StructuralClusterStrategy` группирует claims по category +
  topic. Реализован.
- **D-11** Этап 4 (conflicts): `ConflictDetector` находит кластеры с ≥2 ролей и
  противоречащими claims → `Conflict[]` в `disagreements`.
- **D-12** Этап 5 (confidence): `ConfidenceCalculator` считает 6 метрик по формулам §6.
  Все в диапазоне 0..100, clamped.
- **D-13** Этап 6 (agreement): cluster с ≥2 ролей, согласными по topic → `Decision` со
  `status: 'accepted'`, `acceptedBy: RoleRef[]`.
- **D-14** Этап 7 (report assembly): `ReportBuilder` формирует `summary`, `openQuestions`,
  `risks` (risk-claims → Risk[]).
- **D-15** Этап 8 (ADR generation): **пропущен по плану** (D-E3, Wave 6). В коде —
  комментарий `// Этап 8 (ADR) — Wave 6, D-E3`. НЕТ частичной реализации.

### Gating

- **D-16** `DefaultGatingPolicy.thresholdsForTransitionFrom()` возвращает пороги по таблице
  §4.3 для фаз Goal/Specification/Architecture/Implementation/Review/Consensus.
  Для Discover/Iteration → `undefined`.
- **D-17** `gatingVerdict = 'pass'` если все применимые метрики ≥ порога (или порогов нет).
  `'fail'` иначе. Реализовано в `gating-policy.ts` / внутри `run()`.
- **D-18** `nextAction` содержит указание пробелов при `fail` (упоминание метрик ниже
  порога). При `pass` — указание следующей фазы.

### NestJS-интеграция

- **D-19** `ConsensusModule` создан в `apps/api/src/consensus/`, `providers: [ConsensusService]`,
  `exports: [ConsensusService]`.
- **D-20** `AppModule.imports` включает `ConsensusModule`. Build `@orchestra/api` green.
- **D-21** `apps/api/package.json` содержит `"@orchestra/consensus-engine": "workspace:*"`.

### Hexagonal-чистота и канон

- **D-22** Порты `ClaimExtractionStrategy`, `ClusterStrategy`, `GatingPolicy` определены в
  `types.ts` как interfaces. Реализации — конкретные классы (ClaimSyntaxStrategy и т.д.).
- **D-23** Defaults: `new ConsensusEngine()` без аргументов работает (использует
  ClaimSyntaxStrategy/StructuralClusterStrategy/DefaultGatingPolicy по умолчанию).
  Повторяет канон Phase 3 `DEFAULT_POLICIES`, Phase 4 `MockHttpPort by default`.

### Тесты / verifier

- **D-24** `packages/consensus-engine/test/consensus-engine.spec.ts` существует, содержит
  минимум 6 сценариев (T1-T6). `pnpm --filter @orchestra/consensus-engine test` → all green.
- **D-25** Тест T6 (детерминизм) — глубокое равенство `run(input)` дважды, включая все id.
- **D-26** Тесты НЕ используют внешних ресурсов (сеть/БД/файловая система вне temp). Pure.

### Build / регрессия (verifier: build-gate)

- **D-27** `pnpm -r typecheck` → 9 пакетов green (8 + новый consensus-engine). Exit 0.
- **D-28** `pnpm --filter @orchestra/consensus-engine build` → `dist/` сгенерирован, exit 0.
- **D-29** `pnpm --filter @orchestra/api build` → green (с ConsensusModule в imports). Exit 0.
- **D-30** `pnpm --filter @orchestra/web build` → green (регрессия Phase 4, web не тронут).
  Exit 0.
- **D-31** `pnpm --filter @orchestra/role-router build` → green (Phase 4 не сломана).
- **D-32** `pnpm --filter @orchestra/providers build` → green (Phase 4 не сломана).
- **D-33** Clean rebuild api: `rm -rf apps/api/dist && pnpm --filter @orchestra/api build`
  → `apps/api/dist/main.js` существует (D-A1/Phase-1 не регресснул, как в Phase 4 D-30).

---

## 10. Success criteria

**Фаза считается выполненной, когда:**
1. Все D-01..D-33 PASS (code review + build + tests + grep-проверки).
2. `pnpm -r typecheck` + `pnpm -r build` → 9 пакетов green.
3. `pnpm --filter @orchestra/consensus-engine test` → 6/6 (или более) сценариев green.
4. Anti-conflict: `git diff` по всем защищённым зонам (§1 таблица) → пусто.
5. Pipeline Orchestra исполняем до нового узла:
   `KG → ContextService → RoleRouter → Provider → Response[] → ConsensusEngine.run → ConsensusReport`.

**Фаза НЕ выполнена («не готово, когда»), если:**
- Любой из D-01..D-08 (архитектура/контракты/детерминизм) FAIL — это фундаментальные
  инварианты, их нарушение блокирует замыкание.
- Domain изменён (D-02/D-03) — нарушение anti-conflict, blockers.
- Тесты красные (D-24..D-26) — verifier не пройден.
- Build любого из замороженных пакетов сломан (D-30..D-32) — регрессия Phase 2/3/4.
- ConsensusEngine недетерминирован (D-07/D-08) — ломает инвариант Consensus Protocol §1.
- Появились реальные сетевые/БД вызовы внутри `packages/consensus-engine/src/` (D-01).

---

## 11. Anti-conflict явный (повтор §1 таблицы для кодера)

КОДЕР НЕ ТРОГАЕТ (зелёные зоны замороженных фаз):
- `packages/domain/src/**` — контракты уже есть, Phase 5 реализует поверх.
- `packages/knowledge-graph/`, `packages/context-service/`, `packages/prompt-registry/`,
  `packages/role-router/`, `packages/providers/` — фазы 2-4 заморожены.
- `apps/web/` — Wave 7.
- `docs/**` — канон-документы (Consensus Protocol.md — источник правды алгоритма).
- `role-manifests/`, `prompts/` — seed-данные.
- `.planning/phases/0[1-4]/` — замороженные артефакты GSD.
- `tsconfig.base.json`, `pnpm-workspace.yaml` — корневой конфиг (packages/* уже покрывает).

КОДЕР СОЗДАЁТ/ИЗМЕНЯЕТ:
- `packages/consensus-engine/**` (новый пакет, все файлы из §1).
- `apps/api/src/consensus/**` (новый NestJS-модуль).
- `apps/api/src/app.module.ts` (+1 import).
- `apps/api/package.json` (+1 dep).

---

## 12. Порядок работы кодера (рекомендуемый)

1. Создать скелет пакета (`package.json`, `tsconfig.json`, `src/`, `test/`).
2. Прочитать `packages/domain/src/consensus.ts` + `decision.ts` + `gsd.ts` + `agent.ts` —
   это контракты. Реализовывать под них.
3. `types.ts` — порты + `RoleResponse`/`ConsensusInput`/`Claim`/`ClaimCluster`.
4. `strategies/gating-thresholds.ts` + `strategies/claim-syntax.ts` — конфиги (таблицы).
5. `claim-extractor.ts` → `claim-clusterer.ts` → `conflict-detector.ts` (этапы 1-4).
6. `confidence-calculator.ts` (этап 5) — формулы §6.
7. `agreement-assessor.ts` + `report-builder.ts` + `gating-policy.ts` (этапы 6-9).
8. `consensus-engine.ts` — оркестратор `run()`.
9. `index.ts` — barrel.
10. `test/consensus-engine.spec.ts` — 6 сценариев T1-T6.
11. NestJS-обёртка `apps/api/src/consensus/` + `app.module.ts` + `package.json`.
12. Прогнать: `pnpm install` → `pnpm -r typecheck` → `pnpm -r build` →
    `pnpm --filter @orchestra/consensus-engine test`. Всё green.
13. Написать `5-01-SUMMARY.md` (по образцу Phase 4 SUMMARY, frontmatter + что сделано +
    D-критерии таблицей + key decisions + duration).

**Оценка:** ~3-4 часа (больше Phase 4 из-за 9 этапов + тестов).

---

## 13. Design notes (почему так)

1. **`RoleResponse` в пакете, не в domain.** Domain `Response` — чистый выход провайдера
   без знания о роли (Phase 4 контракт). Связка «роль → ответ» — артефакт агрегации.
   Добавление `role` в domain `Response` ломало бы anti-conflict Phase 4.

2. **Детерминизм как инвариант.** Consensus Protocol §1 явно говорит «детерминированный
   модуль». Это не декорация: воспроизводимость артефактов (Engineering Time Machine,
   Architecture.md §1 п.5) требует, чтобы одинаковый раунд → одинаковый отчёт. Поэтому
   `report.id` = `consensus-${roundId}`, без `randomUUID`. Это отклонение от привычной
   практики, но продиктовано каноном.

3. **MVP-формулы confidence — грубые.** Намеренно. Их цель — детерминированная,
   тестопригодная метрика, реагирующая на вход. Wave 6 (D-E1/D-E4) заменит на embedding +
   плагин. Важно зафиксировать в JSDoc «MVP, subject to replacement».

4. **Порты как стратегии, не как внешние адаптеры.** В Phase 4 порты (`HttpPort`,
   `KgGraphPort`) — точки инверсии к инфраструктуре. В Phase 5 порты
   (`ClaimExtractionStrategy`, `ClusterStrategy`, `GatingPolicy`) — точки инверсии к
   **алгоритмам**. Это подготавливает плагин `Consensus Strategy` (Agent Protocol §8) без
   premature abstraction: дефолты уже инжектируемые, замена = 1 строка.

5. **Этап 8 (ADR generation) пропускается явно.** Полная реализация требует Decision
   Repository (куда ADR пишется). Частичная («генерация ADR-строки в metadata») создала бы
   мёртвый код без consumer'а. Лучше чистый пропуск с комментарием + долг D-E3, чем
   полуфабрикат (ср. Phase 4 design decision #6 — мёртвый `PendingRequest` тип).

6. **NestJS-модуль без endpoint'а.** ConsensusService не вызывается HTTP-роутом в этой фазе.
   Это повторяет Phase 4 (RoleRouterService тоже не имел endpoint до валидации). Смысл —
   собрать pipeline-узел и доказать его typecheck/build/testability. Wave 7 (UI) добавит
   `/api/consensus/run` контроллер.

---

## 14. Долги, которые фаза ОТКРЫВАЕТ (по правилу PARTIAL, на случай PARTIAL-вердикта)

Если валидация покажет PARTIAL/FAIL, эти долги уже предсказаны:

- **D-E1** Реальная семантическая кластеризация через embeddings. **Когда:** Wave 6+
  (с embedding-моделью в Knowledge Graph). **Блокирует:** НЕТ (MVP-структурная работает).
- **D-E2** Continuous Consensus (пересчёт после каждого AgentResponded). **Когда:** Wave 6
  (с Event Bus, закроет попутно D-D1/D-C4). **Блокирует:** НЕТ (batch-run() работает).
- **D-E3** Персистенция ConsensusReport в Decision Repository. **Когда:** Wave 6 (с
  реальной PostgreSQL). **Блокирует:** НЕТ (отчёт in-memory валиден).
- **D-E4** Плагин `Consensus Strategy` (Plugin SDK). **Когда:** Wave 6+. **Блокирует:** НЕТ
  (defaults работают, стратегии инжектируемые).

Все четыре — non-blocking, все имеют явный Wave закрытия. MVP pipeline исполняем с ними
как known-limitations.

---

## 15. Что получает Orchestra после Phase 5

Pipeline Orchestra исполняем **до формализации решения**:

```
KG → ContextService.buildPacket → RoleRouter.route → AIProvider.send
   → Response[] → ConsensusEngine.run(phase) → ConsensusReport
     { agreedDecisions, disagreements, risks, confidence, gatingVerdict }
```

**Phase 6 кандидаты (Wave 6):**
- **GSD Engine runtime** — конечный автомат фаз, вызывает `consensusEngine.gate()` для
  перехода. Consensus Engine готов это обслуживать (D-16 gating policy).
- **Decision Repository** — персистенция ConsensusReport (закроет D-E3), генерация ADR
  (этап 8 протокола, сейчас пропущен).
- **Event Bus** (Redis+BullMQ) — закроет D-C4/D-D1/D-E2 одной фазой (Continuous Consensus
  + публикация ConsensusGenerated/ConfidenceRecalculated).

Безопасно стартовать Phase 6: D-27 typecheck стабильно зелёный на 9 пакетах,
`ConsensusEngine.run()` возвращает доменный `ConsensusReport` с валидным `gatingVerdict`,
hexagonal-порты готовы к подключению Event Bus и плагинов. Phase 5 готова к исполнению.
