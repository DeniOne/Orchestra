---
phase: 8b
slug: 08b-conducting-score-ui
wave: B-8
title: "Conducting Score UI MVP — CRUD сессий + conduct controls, потребляет REST API Phase 8"
milestone: "Orchestra MVP — Wave 8b (UI Conducting Score)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-19
status: DRAFT
verifier: build-gate (pnpm --filter @orchestra/web typecheck + build) + runtime-gate (live web dev server → live API → успешный CRUD+conduct цикл с evidence) + regression-gate (Phase 5/6/7/8 spec'и green, typecheck 10/10)
baseline_before: "Phase 8 PASS (commit 0df6f67): apps/api/dist/main.js работает, 7 REST-эндпоинтов SessionsController, CORS открыт для Next.js. apps/web — пустой Next.js 15 skeleton (layout.tsx + page.tsx 'в разработке'). Никаких UI-библиотек, state-management, data-fetching ещё нет."
depends_on:
  - "Phase 8 (0df6f67) — REST API контракт: POST/GET /sessions, /rounds, /advance, /approve, /override"
  - "@orchestra/domain — типы Session/Round/GSDPhase для UI контракта"
closes_debts:
  - "Wave 8b: Orchestra получает визуальный интерфейс дирижёра (первая UI-фаза в проекте)"
  - "UI Canon §1 Conducting Score — минимальная материализация (полная партитура → Wave 8c+)"
opens_debts_expected:
  - "D-8b-2: Real-time WebSocket/SSE (сейчас polling или manual refresh) — Wave 8c (D-H2)"
  - "D-8b-3: Decision Confidence gauges — требуют backend-данных (role responses, confidence metrics), сейчас REST их не возвращает — Wave 8c+"
  - "D-8b-4: Discussion Graph UI — Wave 8c+"
  - "D-8b-5: Full Conducting Score (партитура с дорожками-ролями) — Wave 8c+, когда backend отдаёт per-role responses"
---

# PLAN 8b-01 — Conducting Score UI MVP

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8b-01-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **EVIDENCE-RULE (DEBT-8b-PROCESS, owner-mandated 2026-07-19):** для каждого runtime-D
> критерия (D-14..22 ниже) SUMMARY **обязан** содержать буквальный copy-paste вывода команды:
> - Полная команда (включая URL, payload, env-vars)
> - Полный HTTP-статус или скриншот результата
> - Полный response body (или релевантная часть)
> - Для dev-серверов: PID/порт + команда остановки (kill/Stop-Process)
>
> **Без evidence = auto-FAIL D-критерия**, независимо от остального. Это механический
> критерий — его нельзя обмануть формулировкой «работает ✅». Tech lead перепроверяет runtime-D
> лично тем же curl/браузером, если evidence выглядит неполным.

## 0. Контекст фазы (почему и что)

### 0.1. Текущее состояние

Phase 8 (PASS, commit `0df6f67`) заморозила REST API: SessionsController с 7 эндпоинтами
управляет полным GSD-циклом, CORS открыт для Next.js, ValidationPipe работает, advance
требует PostgreSQL (owner-decision §3 README-CONTRACT-PHASE-8). Backend готов к UI.

`apps/web/` — пустой skeleton: Next.js 15.5 + React 19.2 + TypeScript 5.6, только
`layout.tsx` + `page.tsx` с текстом «Conducting Score UI — в разработке». Никаких
Tailwind/shadcn/TanStack/Zustand. Architecture.md §3 фиксирует целевой стек: Next.js 15,
React 19, TypeScript, **Tailwind, shadcn/ui, TanStack Query, Zustand**.

Phase 8b = **первая UI-фаза в проекте**. Доставляет минимально-полезный Conducting Score UI,
который даёт дирижёру визуальный контроль над GSD-сессиями через REST API Phase 8.

### 0.2. Scope (owner-decision 2026-07-19)

**Scope MVP: CRUD сессий + conduct controls.** UI позволяет:
- Видеть список сессий
- Создавать новую сессию (имя + projectId)
- Открывать детальную страницу сессии: текущая фаза, раунды, состояние
- Управлять сессией: Start Round, Advance, Approve, Override (кнопки вызывают REST)
- Видеть результат gating (transitioned / gated с gaps / awaiting_approval)

**НЕ в scope (забор на Wave 8c+):**
- **Полная Conducting Score партитура** (дорожки-роли, такты-раунды) — требует per-role
  responses, которых REST Phase 8 не возвращает (D-8b-5).
- **Decision Confidence gauges** — требуют confidence metrics из Consensus, REST не отдаёт
  (D-8b-3).
- **Real-time WebSocket/SSE** — сейчас polling/manual refresh (D-8b-2, D-H2).
- **Discussion Graph** — Wave 8c+ (D-8b-4).
- **Аутентификация** — D-H1, Wave 8+.
- **Локализация на русский** — UI Canon §8 требует, но MVP scoped to RU-only labels inline.

### 0.3. Стек (owner-decision 2026-07-19)

**Полный canonical стек из Architecture.md:**
- **Tailwind CSS** — utility-first стилизация (v4 — последний stable).
- **shadcn/ui** — компонентная библиотека (Button, Card, Input, Dialog, Badge, Toast).
- **TanStack Query v5** — server-state для REST (cache, revalidation, mutations).
- **Zustand** — client-state (UI-флаги, selected session, modal open-state).

Обоснование: канон из Architecture.md §3. Ставим сразу canonical, чтобы не мигрировать
потом. Setup-оверхед в первой фазе окупается в Wave 8c+.

### 0.4. UI Canon инварианты (соблюдать даже в MVP)

UI Canon §9 — что **запрещено**. В scope MVP применяем релевантные:
- ❌ **Нельзя превращать дорожку роли в чат-пузырь** — в MVP нет дорожек ролей (нет данных),
  но при показе раундов — никаких псевдо-чатов. Round = карточка с метаданными.
- ✅ **Next Phase отключён, пока gating=fail** — кнопка Advance disabled с tooltip «gating fail:
  <gaps>», если последний advance вернул `gated`. Реализовать через `AdvancePhaseResult.status`.
- ✅ **Owner-override с записью** — кнопка Override требует modal с полем `reason`
  (ValidationPipe требует reason: string, MaxLength 1000).
- ✅ **Светлая тема по умолчанию** (UI Canon §8).

### 0.5. Что фаза НЕ меняет

- `apps/api/**` — backend Phase 8, не трогать.
- `packages/**` — заморожены Phase 2-7.
- `docs/**` — канон, не трогать (если не явная правка UI Canon с санкцией).
- `.planning/phases/08-http-api-gateway/**` — Phase 8 заморожена.
- Prisma schema, role-manifests, prompts — не трогать.

---

## 1. Архитектурное решение (главное)

### 1.1. Структура приложения

Next.js 15 App Router, server components по умолчанию, client components для интерактива.

```
apps/web/src/
├── app/
│   ├── layout.tsx              # ИЗМЕНИТЬ: root layout с Providers (TanStack Query)
│   ├── page.tsx                # ИЗМЕНИТЬ: список сессий (/)
│   ├── globals.css             # НОВЫЙ: Tailwind directives + shadcn vars
│   └── sessions/
│       └── [id]/
│           └── page.tsx        # НОВЫЙ: детальная страница сессии
├── providers/
│   └── query-provider.tsx      # НОВЫЙ: TanStack QueryClientProvider (client component)
├── lib/
│   ├── api-client.ts           # НОВЫЙ: fetch wrapper для REST API
│   ├── types.ts                # НОВЫЙ: типы для API responses (или re-use @orchestra/domain)
│   └── utils.ts                # НОВЫЙ: cn() helper для shadcn (clsx + tailwind-merge)
├── hooks/
│   ├── use-sessions.ts         # НОВЫЙ: TanStack Query hooks для /sessions
│   └── use-session.ts          # НОВЫЙ: TanStack Query hooks для /sessions/:id
├── components/
│   ├── ui/                     # НОВЫЙ: shadcn primitives (button, card, input, badge, dialog, label, sonner/toast)
│   ├── session-list.tsx        # НОВЫЙ: список сессий (client component)
│   ├── create-session-dialog.tsx  # НОВЫЙ: modal создания
│   ├── session-detail.tsx      # НОВЫЙ: карточка сессии + conduct controls
│   ├── phase-badge.tsx         # НОВЫЙ: визуализация GSDPhase
│   ├── round-list.tsx          # НОВЫЙ: список раундов сессии
│   └── conduct-controls.tsx    # НОВЫЙ: Start Round / Advance / Approve / Override
└── store/
    └── ui-store.ts             # НОВЫЙ: Zustand store (modal open-state)
```

### 1.2. Data flow

```
User Action → TanStack Query mutation → fetch to API (lib/api-client.ts) → REST API :3001
                ↓                                          ↑
        Updates cache (invalidate /sessions, /sessions/:id)
                ↓
        UI re-renders (server components via router.refresh() + client via Query cache)
```

**TanStack Query** — для server state (sessions list, session detail, mutations).
**Zustand** — для UI state (какой modal открыт, какой session selected в списке).

### 1.3. API URL конфигурация

```typescript
// apps/web/src/lib/api-client.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```

`NEXT_PUBLIC_API_URL` — env для прод-деплоя. По умолчанию `localhost:3001` (apps/api main.ts).

### 1.4. Контракт с @orchestra/domain

UI использует типы из `@orchestra/domain` (уже в deps, transpilePackages настроен):
```typescript
import type { Session, Round, GSDPhase } from '@orchestra/domain';
```

Для `AdvancePhaseResult` (5-вариантный union из gsd-engine) — **НЕ** тянуть пакет gsd-engine в
web (он NestJS-зависимый). Создать локальный type в `lib/types.ts`:
```typescript
export type AdvancePhaseResult =
  | { status: 'transitioned'; from: GSDPhase; to: GSDPhase; event: DomainEvent }
  | { status: 'gated'; phase: GSDPhase; gaps: string[] }
  | { status: 'awaiting_approval'; phase: GSDPhase }
  | { status: 'terminal'; phase: GSDPhase }
  | { status: 'iteration'; phase: GSDPhase; reason: string };
```

> Кодер: сверить с `packages/gsd-engine/src/gsd-engine.ts` (Phase 6), убедиться что union
> соответствует 1:1.

---

## 2. Setup: установка стека

### 2.1. Зависимости

**deps:**
- `@tanstack/react-query` (v5+)
- `zustand` (v5+)
- `tailwindcss` (v4+) + `@tailwindcss/postcss` (v4 PostCSS plugin)
- `clsx`, `tailwind-merge` (для cn() helper)
- `class-variance-authority` (для shadcn variants)
- `lucide-react` (icons для shadcn)
- `sonner` (toast notifications)

**devDeps:**
- `@types/*` при необходимости (большинство типов уже есть)

> **Tailwind v4 vs v3:** кодер проверить, какой latest stable на момент исполнения. v4
> меняет конфигурацию (CSS-first через `@import "tailwindcss"`). Если v4 даёт проблемы с
> Next 15 / shadcn — откатить на v3.4+ (более стабильный с shadcn). Техлид предпочитает v3.4
> для предсказуемости с shadcn, но оставляет выбор кодеру.

### 2.2. shadcn/ui setup

```bash
cd apps/web
pnpm dlx shadcn@latest init
# style: default (или new-york)
# base color: slate (UI Canon — светлая тема)
# css variables: yes
```

Затем добавить компоненты:
```bash
pnpm dlx shadcn@latest add button card input label badge dialog sonner
```

> shadcn CLI создаёт `components/ui/*.tsx` в `src/`. Конфиг `components.json` в корне `apps/web/`.
> Если CLI не работает в монорепо — поставить вручную (файлы копируются в проект, не npm-dep).

### 2.3. Конфигурация Tailwind

`apps/web/src/app/globals.css` (v3.4):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* shadcn slate theme — light mode default (UI Canon §8) */
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    /* ... остальные vars из shadcn init */
  }
}
```

`apps/web/tailwind.config.ts` — shadcn preset.

`apps/web/postcss.config.mjs`:
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

---

## 3. Главные компоненты (спецификация)

### 3.1. SessionList (`components/session-list.tsx`) — client component

- TanStack Query `useQuery({ queryKey: ['sessions'], queryFn: () => apiFetch<Session[]>('/sessions') })`.
  > **ВАЖНО:** Phase 8 REST **НЕ ИМЕЕТ** `GET /sessions` (list). См. §6 gap.
- Render: `<Card>` на каждый session, показывает name, currentPhase (PhaseBadge), updatedAt.
- Клик по карточке → `router.push('/sessions/:id')`.
- Кнопка "Новая сессия" сверху → открывает CreateSessionDialog (Zustand `createModalOpen`).
- Empty state: «Нет сессий. Создайте первую.»

### 3.2. CreateSessionDialog (`components/create-session-dialog.tsx`)

- Modal с двумя `<Input>`: name, projectId.
- shadcn `<Dialog>` управляется Zustand store `ui-store.ts`.
- Submit → TanStack mutation `POST /sessions` → onSuccess: invalidate `['sessions']`, закрыть modal.
- Form validation: name и projectId required (client-side), MaxLength 200/100 соответственно
  (соответствует DTO Phase 8).
- Error toast через `sonner`: «Не удалось создать сессию: <message>».

### 3.3. SessionDetail (`components/session-detail.tsx`) — `/sessions/[id]/page.tsx`

- TanStack `useQuery({ queryKey: ['session', id], queryFn: () => apiFetch<Session>(`/sessions/${id}`) })`.
- Header: session name, PhaseBadge(currentPhase), projectId, dates.
- RoundList: список раундов из `session.rounds`.
- ConductControls: кнопки управления.
- 404 handling: если `getSession` кидает → «Сессия не найдена».

### 3.4. ConductControls (`components/conduct-controls.tsx`)

4 кнопки:
- **Start Round** → `POST /sessions/:id/rounds` → invalidate session detail.
- **Advance** → `POST /sessions/:id/advance` → показать результат (toast + badge update).
  Disabled если последний advance вернул `gated` (UI Canon §9.3). Tooltip показывает gaps.
- **Approve** → `POST /sessions/:id/approve` → invalidate.
- **Override** → открывает OverrideDialog с полем `reason` (required, MaxLength 1000).
  Submit → `POST /sessions/:id/override -d '{"reason":"..."}'` → invalidate.

> **Advance без PostgreSQL (dev):** если API вернул 500 — toast честно говорит
> «Advance требует PostgreSQL. См. README-CONTRACT-PHASE-8 §3.». НЕ маскировать ошибку.

### 3.5. PhaseBadge (`components/phase-badge.tsx`)

Цветовая индикация GSDPhase:
- Discover → slate (нейтральный старт)
- Goal → blue
- Specification → cyan
- Architecture → indigo
- Implementation → green
- Review → amber
- Consensus → emerald (финал)
- Iteration → orange (цикл)

shadcn `<Badge>` с custom variant per phase.

### 3.6. RoundList (`components/round-list.tsx`)

- Из `session.rounds` (уже embedded в Session response).
- Карточка на round: number, phase (PhaseBadge), status (badge: pending/in_progress/completed/failed), startedAt.
- Reverse chronological (новые сверху).

---

## 4. TanStack Query hooks

`hooks/use-sessions.ts`:
```typescript
export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiFetch<Session[]>('/sessions'),
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; projectId: string }) =>
      apiFetch<Session>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}
```

`hooks/use-session.ts`:
```typescript
export function useSession(id: string) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => apiFetch<Session>(`/sessions/${id}`),
    enabled: !!id,
  });
}

export function useStartRound(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Round>(`/sessions/${id}/rounds`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });
}

export function useAdvance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<AdvancePhaseResult>(`/sessions/${id}/advance`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });
}

export function useApprove(id: string) { /* аналогично /approve */ }
export function useOverride(id: string) { /* аналогично /override с body reason */ }
```

---

## 5. Zustand store

`store/ui-store.ts`:
```typescript
import { create } from 'zustand';

interface UIState {
  createModalOpen: boolean;
  overrideModalOpen: boolean;
  overrideTargetSessionId: string | null;
  setCreateModalOpen: (open: boolean) => void;
  openOverride: (sessionId: string) => void;
  closeOverride: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  createModalOpen: false,
  overrideModalOpen: false,
  overrideTargetSessionId: null,
  setCreateModalOpen: (open) => set({ createModalOpen: open }),
  openOverride: (sessionId) =>
    set({ overrideModalOpen: true, overrideTargetSessionId: sessionId }),
  closeOverride: () =>
    set({ overrideModalOpen: false, overrideTargetSessionId: null }),
}));
```

---

## 6. Контрактный gap: GET /sessions (list)

**Внимание кодеру:** Phase 8 SessionsController **НЕ ИМЕЕТ** `GET /sessions` (list) эндпоинта.
Реализованные: `POST /sessions` (create), `GET /sessions/:id`, и др. по `:id`.

**Для SessionList нужны все сессии.** Два варианта:

**Вариант A (Рекомендуется):** В рамках Phase 8b тронуть `apps/api` минимально — добавить
`GET /sessions` эндпоинт в SessionsController, который возвращает массив всех Session из
GsdEngineService. Это **требует** добавить метод `listSessions()` в GsdEngineService (Phase 6
зона), что нарушает anti-conflict PLAN 8-01.

**Вариант B:** Phase 8b работает только с детальными страницами `/sessions/:id` (пользователь
вводит ID руками). SessionList показывает «закладки» из localStorage (client-side). Нет
серверного list.

> **Кодер:** если выбираешь Вариант A — техлид должен санкционировать трогание `apps/api`.
> В PLAN это **разрешено** через §6 (этот раздел): кодер добавляет `listSessions()` в
> GsdEngineService и `@Get()` в SessionsController. Это расширение API Phase 8 в рамках
> Phase 8b — официально разрешено данным PLAN'ом.

**Техлид рекомендует Вариант A** — без list UI бесполезен (нет способа найти сессии). В InMemory
store list тривиален: `Array.from(this.store.sessions.values())`.

---

## 7. must_haves.truths (D-критерии)

### Setup / зависимости

- **D-01** `apps/web/package.json` добавлены deps: `@tanstack/react-query`, `zustand`,
  `tailwindcss`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `sonner`.
  Запуск `pnpm install` green.
- **D-02** Tailwind работает: `apps/web/src/app/globals.css` имеет `@tailwind` directives (v3)
  ИЛИ `@import "tailwindcss"` (v4). Класс `bg-blue-500` рендерится в HTML.
- **D-03** shadcn primitives в `src/components/ui/`: button, card, input, label, badge, dialog,
  sonner. Минимум 7 компонентов. `components.json` существует в `apps/web/`.

### App structure

- **D-04** `apps/web/src/app/layout.tsx` обёрнут в `<QueryProvider>` (client component с
  `QueryClientProvider`). `<Toaster />` от sonner примонтирован.
- **D-05** `apps/web/src/app/page.tsx` — SessionList (список сессий).
- **D-06** `apps/web/src/app/sessions/[id]/page.tsx` — SessionDetail (детальная страница).
- **D-07** `apps/web/src/lib/api-client.ts` — fetch wrapper с `API_BASE = NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'`.
- **D-08** `apps/web/src/lib/types.ts` — `AdvancePhaseResult` union (5 вариантов) соответствует
  `packages/gsd-engine/src/gsd-engine.ts` 1:1.

### Backend extension (Вариант A, §6)

- **D-09** `apps/api/src/gsd/gsd-engine.service.ts`: добавлен метод `listSessions(): Promise<Session[]>`.
  Возвращает все сессии из InMemorySessionStore.
- **D-10** `apps/api/src/sessions/sessions.controller.ts`: добавлен `@Get()` (без параметров)
  → `listSessions()`. Возвращает `Session[]`, HTTP 200.

### Функциональность

- **D-11** SessionList: при загрузке показывает список всех сессий (или empty state).
- **D-12** CreateSessionDialog: форма name + projectId, submit создаёт сессию, список обновляется.
- **D-13** SessionDetail: показывает name, currentPhase (PhaseBadge), rounds, dates.
- **D-14** ConductControls: 4 кнопки (Start Round, Advance, Approve, Override) вызывают
  соответствующие REST эндпоинты.
- **D-15** Override открывает modal с required `reason` (MaxLength 1000), submit вызывает
  `/override -d '{"reason":"..."}'`.
- **D-16** Advance disabled с tooltip, если последний advance вернул `gated` (UI Canon §9.3).
- **D-17** Error toast через sonner для любой mutation-fail (включая advance-500 без PG —
  честное сообщение «Advance требует PostgreSQL»).
- **D-18** Фаза 5/6/7 regression: API spec'и всё ещё green после добавления `listSessions`.

### Build / typecheck

- **D-19** `pnpm --filter @orchestra/web typecheck` → green, exit 0.
- **D-20** `pnpm --filter @orchestra/web build` → green, exit 0. Static export / SSG работает.
- **D-21** `pnpm -r typecheck` → 10 пакетов green (api + web + 8 пакетов).

### Runtime (evidence-rule применяется — §0 EVIDENCE-RULE)

- **D-22** Web dev server: `pnpm --filter @orchestra/web dev` стартует на `:3000`, в консоли
  `Ready in XXXms`. **Evidence:** copy-paste вывода консоли + PID + команда kill.
- **D-23** Браузер на `localhost:3000` загружает SessionList без ошибок в консоли.
  **Evidence:** скриншот или текстовое описание DOM (`<main>` содержит список или empty state).
- **D-24** Полный E2E цикл через UI:
  1. Открыть `localhost:3000` → SessionList загружен.
  2. Кликнуть "Новая сессия" → CreateSessionDialog открыт.
  3. Ввести name="test-ui", projectId="proj-1" → submit → SessionList обновился, в нём новая сессия.
  4. Кликнуть на сессию → SessionDetail загружен, currentPhase="Discover", rounds=[].
  5. Кликнуть "Start Round" → rounds обновился, появился round #1 status=in_progress.
  6. Кликнуть "Advance" → результат показан (toast + badge). С PG: `transitioned` Discover→Goal.
     Без PG: toast «Advance требует PostgreSQL».
  **Evidence:** пошаговое описание с HTTP-запросами (Network tab) или скриншотами.
- **D-25** CORS работает: fetch из web (:3000) к api (:3001) не блокируется. Evidence: в
  Network tab статус 200, headers содержат `Access-Control-Allow-Origin: http://localhost:3000`.

### Anti-conflict

- **D-26** `packages/**` (src + package.json + tsconfig): ноль изменений.
  `git diff packages/` → пусто.
- **D-27** `apps/api/src/`: изменения ТОЛЬКО в `gsd-engine.service.ts` (+listSessions) и
  `sessions.controller.ts` (+@Get listSessions). Другие файлы `apps/api/src/` — ноль diff.
- **D-28** `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/prisma/`, `apps/api/test/`:
  ноль изменений.
- **D-29** `docs/`, `role-manifests/`, `prompts/`, `.planning/phases/08-http-api-gateway/`:
  ноль изменений.
- **D-30** Root config (`tsconfig.base.json`, `pnpm-workspace.yaml`, root `package.json`):
  ноль изменений.

### Discipline

- **D-31** В SUMMARY 8b-01 для каждого runtime-D (D-22..25) присутствует буквальный evidence
  (команда + вывод / скриншот). Без evidence = auto-FAIL. См. §0 EVIDENCE-RULE.
- **D-32** Если Web dev-сервер запускался в ходе верификации — в SUMMARY указан PID/порт +
  команда остановки. Никаких зависших процессов после завершения работы (урок из 8-03, где
  осталось 10+ зомби-node).

---

## 8. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-32 PASS (с evidence для D-22..25).
2. Web dev server поднимается, SessionList + SessionDetail работают против live API.
3. Полный CRUD+conduct цикл проходим через UI (D-24).
4. CORS работает, error-handling через toast.
5. Regression Phase 5/6/7/8 API spec'и green (после добавления listSessions).
6. Anti-conflict: packages/ не тронут, apps/api изменён только в 2 файлах (+listSessions).

**Фаза НЕ выполнена, если:**
- Web dev server не поднимается (D-22 FAIL) или браузер показывает blank screen.
- E2E цикл не проходит через UI (D-24 FAIL).
- Mutation-fail молча проглатывается (D-17 FAIL) — нет error toast.
- Кодер тронул что-то вне разрешённых зон (D-26..30 FAIL).
- Summary без evidence для runtime-D (D-31 FAIL) — это принципиально.
- Зависшие node-процессы после работы (D-32 FAIL).

---

## 9. Порядок работы кодера

1. **Прочитать** PLAN полностью. Особенно §0 (EVIDENCE-RULE), §2 (setup), §6 (контрактный gap),
   §7 (D-критерии, особенно D-31 evidence-rule).
2. **Установить стек (§2):** deps в package.json, pnpm install. Tailwind + shadcn init.
3. **Backend extension (§6, Вариант A):** `listSessions()` в GsdEngineService, `@Get()` в
   SessionsController. Регрессия: `pnpm --filter @orchestra/api test:e2e` green.
4. **lib/ (§1.3, §1.4):** api-client.ts, types.ts (AdvancePhaseResult union), utils.ts (cn).
5. **providers/ (§1.1):** QueryProvider.
6. **store/ (§5):** ui-store.ts (Zustand).
7. **hooks/ (§4):** use-sessions.ts, use-session.ts.
8. **components/ui/:** shadcn primitives (через CLI или вручную).
9. **components/:** session-list, create-session-dialog, session-detail, phase-badge,
   round-list, conduct-controls, override-dialog.
10. **app/:** layout.tsx (QueryProvider wrapper), page.tsx (SessionList), sessions/[id]/page.tsx
    (SessionDetail), globals.css (Tailwind).
11. **Typecheck + build (D-19..21):** `pnpm --filter @orchestra/web typecheck && build`,
    `pnpm -r typecheck` 10/10.
12. **Runtime verifier (D-22..25) с EVIDENCE:**
    - Запустить API: `node apps/api/dist/main.js` (нужен PG для advance; без PG — 6/7 эндпоинтов).
    - Запустить web: `pnpm --filter @orchestra/web dev` → :3000.
    - Открыть `localhost:3000`, пройти цикл (D-24).
    - **Записать evidence** для каждого D-22..25 (команды + выводы / скриншоты).
    - **Остановить оба процесса** (kill + Stop-Process / taskkill). Записать PID/команды.
13. **Regression (D-18):** `pnpm --filter @orchestra/api test`, `test:e2e`, gsd-engine test,
    consensus-engine test — все green.
14. **Anti-conflict (D-26..30):** git diff по защищённым зонам — пусто.
15. **Написать `8b-01-SUMMARY.md`** с evidence для каждого runtime-D (D-31).

**Оценка:** ~2-3 дня (setup стека + компоненты + backend extension + verification).

---

## 10. Design notes

1. **Server vs Client components.** Next 15 App Router: server components по умолчанию.
   SessionList и SessionDetail — client components (используют TanStack Query hooks).
   Root layout — server component, но оборачивает children в `<QueryProvider>` (client).
   НЕ делать всё client-side — где можно, держать server.

2. **Почему TanStack Query, не useEffect+useState.** REST mutations требуют cache invalidation
   (createSession → invalidate list; startRound → invalidate session detail). Руками —
   race conditions и баги. TanStack Query решает canonical.

3. **Почему Zustand, не React Context.** UI-флаги (modals) меняются часто. Context провоцирует
   re-render всего дерева. Zustand — atomic updates только подписчиков. Канон Architecture.md.

4. **Светлая тема по умолчанию (UI Canon §8).** shadcn slate theme — light mode. Dark mode —
   Wave 8c+. Не premature.

5. **РУС локализация.** UI Canon §8 требует полную RU локализацию. В MVP — все labels на
   русском inline (`"Новая сессия"`, `"Старт раунда"` и т.д.). Без i18n-библиотеки (Wave 8c+).

6. **Почему `listSessions()` в GsdEngineService — это ОК.** Phase 8 README §5 design decision #7
   говорил: «если понадобится list sessions, она идёт в GsdEngineService через ОТДЕЛЬНУЮ фазу».
   Phase 8b — эта отдельная фаза. Метод тривиальный (return Array from InMemorySessionStore).
   Не ломает Phase 6 архитектуру — extends API surface.

7. **Не деградировать до чата (UI Canon §9.1).** В MVP нет дорожек ролей (нет данных), но при
   показе раундов — карточки с метаданными, никаких chat-bubble. Round = {number, phase,
   status, startedAt} — это card, не message.

8. **Evidence-rule — это ДИСЦИПЛИНА, не прихоть.** После 3 случаев вранья в SUMMARY (8-02 ×2,
   8-03 ×1) owner-mandated формальный критерий. Механический: «есть copy-paste вывода → D PASS,
   нет → D FAIL». Это защищает audit trail от формулировок-вранья. Соблюдай буквально.

---

## 11. Долги, которые фаза ОТКРЫВАЕТ

- **D-8b-2** Real-time WebSocket/SSE — Wave 8c (D-H2). Сейчас polling/manual refresh через
  TanStack Query `refetchInterval` (опционально в MVP).
- **D-8b-3** Decision Confidence gauges — Wave 8c+. Требует расширения REST (role responses,
  confidence metrics из Consensus).
- **D-8b-4** Discussion Graph UI — Wave 8c+. Требует backend-графа веток.
- **D-8b-5** Full Conducting Score (партитура с дорожками) — Wave 8c+. Требует per-role
  responses от backend.
- **D-H1** Auth — Wave 8+.
- **D-8b-6** (опц.) i18n-библиотека для RU — Wave 8c+ (сейчас inline RU strings).

---

## 12. Что получает Orchestra после Phase 8b

**Визуальный интерфейс дирижёра (минимальный).** Пользователь может:
- Открыть браузер → увидеть список сессий.
- Создать новую (имя + projectId).
- Открыть детальную страницу → видеть текущую фазу, раунды.
- Управлять: Start Round, Advance, Approve, Override.
- Видеть gating-статусы, получать feedback через toast.

Это первая материализация UI Canon §1 (Conducting Score) — упрощённая. Wave 8c+ добавит
Confidence gauges, real-time, Discussion Graph, полную партитуру.

**Phase 8b = Orchestra получает лицо.** Backend Phase 8 наконец виден пользователю без curl.

---

## 13. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| shadcn CLI не работает в pnpm-монорепо | средняя | Ручная установка компонентов (файлы копируются в src/components/ui/); shadcn docs описывают manual setup |
| Tailwind v4 конфликтует с shadcn (CJS/ESM, конфиг) | средняя | Откат на Tailwind v3.4 — стабилен с shadcn. Техлид рекомендует v3.4 |
| Next 15 + React 19 edge cases с client components | низкая | Next 15.5 стабильный, React 19.2 — production-ready |
| TanStack Query v5 + Next App Router hydration | низкая | QueryProvider в client component, useQuery в client components. Стандартный паттерн |
| CORS edge case (credentials + origin) | низкая | CORS уже работает (Phase 8 D-11). Fetch без credentials в MVP |
| Кодер снова не даст evidence / оставит зомби-процессы | высокая (по истории) | D-31 + D-32 — формальные критерии, tech lead перепроверяет runtime-D лично |
| listSessions() ломает Phase 6 InMemorySessionStore API | низкая | Store — Map<string,Session>, `Array.from(values())` — тривиально. Regression-gate D-18 ловит |

---

**Конец PLAN 8b-01.** Ждёт `/gsd-execute-phase 8b` (mimo) → `/gsd-validate-phase 8b`.
