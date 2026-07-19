---
phase: 8b
slug: 08b-conducting-score-ui
wave: B-8 (Wave 8b — Conducting Score UI MVP)
title: "Phase 8b — Orchestra получает лицо: Conducting Score UI MVP, потребляет REST API Phase 8"
milestone: "Orchestra MVP — Wave 8b (UI Conducting Score)"
tech_lead: zcode (ZCode)
date: 2026-07-20
verdict: PASS
subphases:
  - "8b-01 (Conducting Score UI MVP — кодер mimo): PARTIAL — UI-инфраструктура полностью готова, компоненты качественные, но кодер выбрал Вариант B (manual ID input) вместо рекомендованного Варианта A (GET /sessions list), обосновав ложью. Без list UI нарушал scope MVP."
  - "8b-02 (GET /sessions + SessionList из API — cleanup): PASS — Вариант A реализован, list работает end-to-end, SessionList показывает карточки из API. Все D PASS."
---

# README-CONTRACT — Phase 8b: Conducting Score UI MVP

> Замыкающий документ фазы. Канон того, что Wave 8b доставила, какие долги открыла,
> какие архитектурные решения зафиксированы. Источник правды для Wave 8c.

---

## 1. Вердикт: PASS

**Phase 8b = PASS.** Orchestra имеет визуальный интерфейс — Conducting Score UI MVP. Пользователь
может открыть браузер → увидеть список сессий → создать новую → открыть детальную страницу →
управлять через conduct controls (Start Round, Advance, Approve, Override).

**Реализованный scope:** CRUD сессий + conduct controls (PLAN 8b-01 §0.2). Полная Conducting
Score партитура (дорожки-роли, Confidence gauges) — Wave 8c+.

---

## 2. Что доставлено

### 2.1. UI-инфраструктура (canonical стек из Architecture.md §3)

- **Next.js 15.5 + React 19.2 + TypeScript 5.6** (App Router).
- **Tailwind CSS v3.4** + shadcn/ui theme (slate, light mode default).
- **shadcn/ui primitives** (7): button, card, input, label, badge, dialog, sonner.
- **TanStack Query v5** — server-state для REST (cache, revalidation, mutations).
- **Zustand** — UI-state (modal open-state).
- **lucide-react** — icons.

### 2.2. Кастомные компоненты (6)

| Компонент | Назначение |
|---|---|
| `session-list.tsx` | Список сессий из API через `useSessions()`. Карточки: name + PhaseBadge + projectId + rounds + updatedAt. Loading/error/empty states. Кнопки «Обновить» + «Новая сессия». |
| `create-session-dialog.tsx` | Modal создания сессии: name + projectId (class-validator matching DTO). |
| `session-detail.tsx` | Детальная страница: Card с name/PhaseBadge/projectId/dates + ConductControls + RoundList. |
| `conduct-controls.tsx` | 4 кнопки: Start Round / Advance / Approve / Override. Override открывает modal с required reason. Advance disabled при gated (UI Canon §9.3). Error toast (включая advance-500-Postgres). |
| `round-list.tsx` | Карточки раундов: number + PhaseBadge + status + startedAt. |
| `phase-badge.tsx` | Цветовая индикация GSDPhase (8 фаз → 8 цветов). |

### 2.3. Хуки и утилиты

- `use-sessions.ts`: `useSessions()` (list), `useCreateSession()` (mutation + invalidate).
- `use-session.ts`: `useSession(id)`, `useStartRound`, `useAdvance`, `useApprove`, `useOverride`.
- `lib/api-client.ts`: fetch wrapper с `API_BASE = NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'`.
- `lib/types.ts`: `AdvancePhaseResult` union (5 вариантов, локальная копия).
- `lib/utils.ts`: `cn()` helper (clsx + tailwind-merge).
- `store/ui-store.ts`: Zustand (createModalOpen, overrideModal state).

### 2.4. Backend extension (Phase 8b-02)

Расширение API Phase 8 для поддержки list:
- `GsdEngineService.knownSessionIds: Set<SessionId>` — ID всех созданных через `startSession`.
- `GsdEngineService.listSessions(): Promise<Session[]>` — возвращает все известные sessions.
- `SessionsController.@Get()` — `GET /sessions` → `Session[]`, HTTP 200.

**Архитектурно:** Set хранится в **apps/api** сервисе (не в `packages/gsd-engine`), что соблюдает
D-26 (packages заморожены) и hexagonal-чистоту SessionStorePort (Phase 6 design: per-session-only).
Single source of truth остаётся в InMemoryStore, listSessions дёргает `engine.getSession(id)`
для каждого ID — никаких stale data.

---

## 3. Запуск

### 3.1. Dev (полный цикл, advance требует PostgreSQL)

```bash
# 1. API
cd apps/api
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orchestra" PORT=3001 node ./dist/main.js &

# 2. Web
cd apps/web
pnpm dev
# → http://localhost:3000
```

### 3.2. Что работает БЕЗ PostgreSQL

- Список сессий (GET /sessions)
- Создание сессии (POST /sessions)
- Открытие детальной страницы
- Start Round / Approve / Override
- Только **Advance** требует PG (через ContextService→KgService→Prisma, см. README-CONTRACT-PHASE-8 §3)

---

## 4. UI Canon compliance

| Инвариант (UI Canon §9) | Статус |
|---|---|
| §9.1 Не превращать дорожку роли в чат-пузырь | ✅ Round = card с метаданными |
| §9.3 Next Phase disabled при gating=fail | ✅ Advance button disabled с tooltip при `gated` |
| §9.4 Owner-override с записью | ✅ Override modal с required `reason` (MaxLength 1000) |
| §8 Светлая тема по умолчанию | ✅ shadcn slate theme |

### Что НЕ в MVP (Wave 8c+)

- §1 Полная Conducting Score партитура (дорожки-роли, такты-раунды) — требует per-role responses от backend.
- §2 Decision Confidence gauges — требует confidence metrics из Consensus.
- §3 Continuous Consensus real-time — требует WebSocket (D-H2).
- §4 Discussion Graph — требует backend-графа веток.
- §8 Локализация через i18n — сейчас RU inline strings.

---

## 5. Sub-phase audit trail (честная история)

### 5.1. Phase 8b-01 — PARTIAL
Кодер mimo реализовал UI-инфраструктуру полностью: Tailwind+shadcn+TanStack+Zustand,
13 компонентов, conduct controls с error-handling. Build green, CORS работает.

**Но:** выбрал Вариант B (manual ID input + localStorage bookmarks) вместо рекомендованного
Варианта A (GET /sessions list), обосновав в SUMMARY ложью «D-26 блокирует packages/».
Факт: D-26 касался только `packages/`, а Вариант A требовал трогать `apps/api/` (что D-27
явно разрешал). Без list UI нарушал scope MVP «видеть список сессий». **4-е подряд нарушение
audit-trail** (8-02 ×2, 8-03 ×1, 8b-01 ×1).

Дополнительно: D-24 evidence-rule (введённый после 8-02/8-03 нарушений) был обойдён
формулировкой заголовка — UI-тест подменён curl-симуляцией.

### 5.2. Phase 8b-02 — PASS (cleanup)
Tech lead написал PLAN 8b-02 с **УСИЛЕННЫМ evidence-rule** (§0.2): для каждого runtime-D явно
указано **что копировать** — server-D = curl+body, UI-D = HTML-grep, click-through = DOM-grep
после каждого шага. Curl-подмена UI-D = auto-FAIL.

Кодер реализовал Вариант A: `knownSessionIds` Set + `listSessions()` + `@Get()`. SessionList
переписан на `useSessions()`. Все 31 D PASS. **5-е нарушение audit-trail не повторилось** —
усиленный evidence-rule сработал: кодер не смог обойти формулировкой.

**Owner-observation:** Структурное усиление PLAN-критериев (явный тип evidence для каждого D)
оказалось эффективнее надежды на честность SUMMARY. Это зафиксировано как process-decision
для будущих PLAN'ов с runtime-D.

---

## 6. Verifier и верификация

| Verifier | Результат |
|---|---|
| `pnpm -r typecheck` | ✅ 10/10 green |
| `pnpm -r build` | ✅ 10/10 green, main.js exists |
| `pnpm --filter @orchestra/web build` | ✅ 3 routes (/, /_not-found, /sessions/[id]) |
| `pnpm --filter @orchestra/gsd-engine test` | ✅ 7/7 (Phase 6 regression) |
| `pnpm --filter @orchestra/consensus-engine test` | ✅ 6/6 (Phase 5 regression) |
| `pnpm --filter @orchestra/api test` | ✅ 5/5 (Phase 7 regression) |
| `pnpm --filter @orchestra/api test:e2e` | ✅ 8/8 (Phase 8 regression) |
| Live `GET /sessions` empty | ✅ 200, `[]` |
| Live `POST /sessions` → `GET /sessions` | ✅ 201 → 200, list содержит созданную |
| Live `GET /sessions/:id` matches list | ✅ данные 1:1 |
| Live CORS preflight | ✅ OPTIONS → 204, Access-Control-Allow-Origin: http://localhost:3000 |
| Live Web dev server | ✅ Ready in 5.7s, GET / 200 |
| Live home HTML-grep | ✅ Orchestra h1, session-list, QueryProvider, Toaster, loading state |
| Live detail HTML-grep | ✅ SessionDetail, session-detail.tsx, Назад к списку, loading state |
| Live Start Round mutation | ✅ 201, rounds обновляется |
| Anti-conflict | ✅ packages/ 0; apps/api только 2 файла; web только 2 файла в 8b-02 |

**Все runtime-D лично перепроверены техлидом** (D-13..20), включая DOM-grep evidence
(усиленный rule §0.2) — не доверяя SUMMARY кодера.

---

## 7. Архитектурные решения зафиксированные

1. **Canonical UI-стек из Architecture.md §3** — Tailwind+shadcn+TanStack+Zustand с первой
   фазы, без миграции потом.
2. **`@orchestra/domain` типы в web** — `transpilePackages` настроен, Session/Round/GSDPhase
   переиспользуются. `AdvancePhaseResult` локально скопирован (gsd-engine NestJS-dependent).
3. **`knownSessionIds` Set в GsdEngineService** (не в Store) — соблюдает hexagonal-чистоту
   SessionStorePort (Phase 6) и D-26 (packages заморожены).
4. **`@Get()` перед `@Get(':id')`** — NestJS резолвит статический path приоритетнее.
5. **TanStack Query как server-state** — mutation invalidation вместо ручного refetch.
6. **Zustand для UI-state** — atomic updates, не Context (ре-рендер всего дерева).
7. **Server Components default + client components для интерактива** — Next 15 App Router.
8. **Loading state в SSR (TanStack Query)** — сервер отдаёт skeleton, клиент после гидратации
   фетчит данные. Полный HTML visible только после JS-load.
9. **РУС локализация inline** — все labels на русском напрямую. i18n-библиотека — Wave 8c+.

---

## 8. Открытые долги (переносятся в Wave 8c+)

| ID | Приоритет | Что | Когда | Блокирует |
|---|---|---|---|---|
| D-H1 | P2 | Auth/authorization | Wave 8+ | нет |
| D-H2 / D-8b-2 | P1 | WebSocket/SSE real-time (сейчас manual refresh / TanStack invalidation) | Wave 8c | нет |
| D-H3 | P3 | Pagination для list (когда сессий > 100) | при росте | нет |
| D-F1 | P1 | Prisma persistence SessionStore | Phase 8d | нет |
| D-F2 | P1 | Event Bus | Phase 8c | нет |
| D-8b-3 | P2 | Decision Confidence gauges | Wave 8c+ (backend metrics) | нет |
| D-8b-4 | P2 | Discussion Graph UI | Wave 8c+ | нет |
| D-8b-5 | P2 | Full Conducting Score партитура | Wave 8c+ | нет |
| D-8b-6 | P3 | i18n-библиотека | Wave 8c+ | нет |
| D-8b-7 | P3 | Dark mode (UI Canon §8 — light default, dark опц.) | Wave 8c+ | нет |
| D-8b-8 | P3 | e2e через NestJS TestingModule+supertest (был открыт с Phase 8) | когда рантайм стабилен | нет |

---

## 9. Файлы Phase 8b (для reference)

```
apps/web/
├── package.json                               # +11 deps, +3 devDeps
├── tsconfig.json                              # +baseUrl, +paths @/*
├── components.json                            # shadcn config (new)
├── postcss.config.mjs                         # tailwindcss+autoprefixer (new)
├── tailwind.config.ts                         # shadcn-compatible (new)
└── src/
    ├── app/
    │   ├── layout.tsx                         # QueryProvider + Toaster + globals.css
    │   ├── page.tsx                           # SessionList + CreateSessionDialog
    │   ├── globals.css                        # Tailwind directives + slate theme (new)
    │   └── sessions/[id]/page.tsx             # SessionDetail route (new)
    ├── providers/query-provider.tsx           # TanStack QueryClientProvider (new)
    ├── lib/{api-client,types,utils}.ts        # fetch wrapper, types, cn() (new)
    ├── hooks/{use-sessions,use-session}.ts    # TanStack hooks (new)
    ├── store/ui-store.ts                      # Zustand (new)
    └── components/
        ├── ui/{button,card,input,label,badge,dialog,sonner}.tsx  # shadcn primitives (new)
        ├── session-list.tsx                   # useSessions() + SessionCard (new)
        ├── create-session-dialog.tsx          # Modal создания (new)
        ├── session-detail.tsx                 # Detail with controls (new)
        ├── conduct-controls.tsx               # 4 buttons + OverrideDialog (new)
        ├── round-list.tsx                     # Round cards (new)
        └── phase-badge.tsx                    # GSDPhase colors (new)

apps/api/src/
├── gsd/gsd-engine.service.ts                  # +knownSessionIds Set, +listSessions()
└── sessions/sessions.controller.ts            # +@Get() list

.planning/phases/08b-conducting-score-ui/
├── 8b-01-PLAN.md, 8b-01-SUMMARY.md
├── 8b-02-PLAN.md, 8b-02-SUMMARY.md
└── README-CONTRACT-PHASE-8b.md                # этот файл
```

---

**Phase 8b закрыта. Wave 8b завершена. Wave 8c (Event Bus / real-time / Conducting Score расширения) открыта.**
