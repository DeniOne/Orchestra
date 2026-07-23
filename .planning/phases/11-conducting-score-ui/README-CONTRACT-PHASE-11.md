---
phase: 11
slug: 11-conducting-score-ui
wave: "Wave 11 — Conducting Score UI"
title: "Persist layer + Conducting Score UI на РЕАЛЬНЫХ данных LLM"
milestone: "Orchestra MVP — Wave 11 (Conducting Score)"
tech_lead: zcode (ZCode) — self-execute (owner-decision)
date_closed: 2026-07-24
verdict: PASS
verifier: build-gate (typecheck 10/10, api+web build) + regression-gate (gsd 7/7, consensus 6/6, api unit 5/5, api e2e 8/8) + runtime-gate (LIVE: docker → real API → advance → GET /sessions возвращает round с responses[] (реальный LLM контент 3668+5914 chars) + consensus (confidence метрики))
baseline_before: "Wave 10 PASS: Orchestra на живых LLM. НО responses эфемерны (D-9-6), consensus discarded, UI = round cards only."
baseline_after: "Wave 11 PASS: responses+consensus persist на Round, Conducting Score UI (gauges+staves+consensus panel) на РЕАЛЬНЫХ данных."
---

# README-CONTRACT-PHASE-11 — Persist Layer + Conducting Score UI

## Вердикт: PASS

Wave 11 = Orchestra получает визуальный Conducting Score на РЕАЛЬНЫХ данных LLM.
Persist layer сохраняет per-role responses + ConsensusReport на Round (D-9-6 закрыт).
3 новых UI компонента рендерят эти данные (D-8b-3 gauges, D-8b-5 score закрыты).

## Что доставлено

### Phase A — Persist layer (закрывает D-9-6)

**Архитектурное решение (runtime finding, честный audit trail):**
PLAN 11-01 предполагал "Option A" — persist внутри `RoundOrchestratorGatingAdapter`.
Runtime-gate вскрыл **split-brain**: adapter и `GsdEngine.advancePhase` делают отдельные
`store.get` → разные объекты в памяти → adapter мутит свою копию, engine перезаписывает своей
(без responses). Переключились на **"Option B"**: расширить `GatingResult` (responses?/consensus?),
adapter возвращает артефакты, engine (канонический owner session) persistит в едином `store.update`.

- `packages/domain/src/session.ts`: Round + `responses?: RoundResponse[]` + `consensus?: ConsensusReport` + тип `RoundResponse`.
- `packages/gsd-engine/src/types.ts`: GatingResult + `responses?: RoundResponse[]` + `consensus?: ConsensusReport`.
- `packages/gsd-engine/src/gsd-engine.ts`: `persistRoundArtifacts()` — mutates session.rounds (status=completed, completedAt, responses, consensus) before store.update. Вызывается в обоих advance paths (transitioned + iteration).
- `apps/api/src/gsd/round-orchestrator-gating.adapter.ts`: returns responses+consensus через GatingResult (НЕ persist сам).

**Данные текут через существующий `GET /sessions/:id`** (Prisma Json round-trip) — 0 новых endpoints.

### Phase B — Conducting Score UI (закрывает D-8b-3, D-8b-5)

- `confidence-gauges.tsx`: 5 gauge bars (architecture/implementation/research/risk/test), green/yellow/red по threshold фазы. НЕ overall (Canon §9.2).
- `score-staves.tsx`: дорожки ролей с РЕАЛЬНЫМ контентом (expand/collapse). НЕ chat-bubble (Canon §9.1).
- `consensus-panel.tsx`: gating verdict banner + summary + disagreements + openQuestions + risks.
- `round-list.tsx`: рендерит gauges+staves+consensus per round.
- `session-detail.tsx`: gauges последнего round в шапке.

## Runtime-gate — объективное доказательство

```
POST /sessions/:id/advance → HTTP 200 transitioned
GET /sessions/:id:
  round.status: completed | completedAt: SET
  responses: 2 items
    [0] Researcher: 3668 chars — The user has asked for research on "persist-final"...
    [1] Critic / Red Team: 5914 chars — # Critical Analysis of Orchestra System ## 🔴 CRITICAL FLAWS IDENTIFIED...
  consensus: HAS (verdict=pass)
    confidence: {"overall":26,"architecture":27,"riskCoverage":0,"testCoverage":17,"implementation":0,"researchCoverage":100}
```

РЕАЛЬНЫЕ ответы (gemini-2.5-flash research 3668 chars + claude-sonnet-4.5 critique 5914 chars),
РЕАЛЬНЫЕ confidence метрики (детерминированные формулы, 0-100 scale). Данные persistнуты, не эфемерны.

## Долги

**Закрывает:** D-9-6 (persist responses), D-8b-3 (gauges), D-8b-5 (score), ConsensusReport persistence.
**Открывает:** D-11-1 (continuous consensus WS), D-11-2 (discussion graph), D-11-3 (streaming viz).
