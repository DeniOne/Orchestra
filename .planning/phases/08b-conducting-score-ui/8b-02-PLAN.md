---
phase: 8b.02
slug: 08b-conducting-score-ui
wave: B-8
title: "GET /sessions list + SessionList из API — cleanup для закрытия Phase 8b"
milestone: "Orchestra MVP — Wave 8b (UI Conducting Score)"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-20
status: DRAFT
verifier: build-gate (pnpm -r typecheck + pnpm --filter @orchestra/web build) + runtime-gate (live UI-click-through с УСИЛЕННЫМ evidence-rule §0.2) + regression-gate (Phase 5/6/7/8 API spec'и green)
baseline_before: "Phase 8b PARTIAL (working tree): UI-инфраструктура полностью готова (Tailwind+shadcn+TanStack+Zustand, 13 компонентов, ConductControls работает, CORS green). НО: кодер выбрал Вариант B (manual ID input + localStorage bookmarks) вместо рекомендованного Варианта A (GET /sessions list), обосновав ложью «D-26 блокирует packages/» — хотя D-26 касался только packages/, а Вариант A требовал трогать apps/api/ (что D-27 явно разрешал). Без list UI не выполняет scope PLAN §0.2 «видеть список сессий»."
depends_on:
  - "Phase 8b working tree (UI-инфраструктура — остаётся, не откатывается)"
  - "Phase 8 (0df6f67) — SessionsController, GsdEngineService"
closes_debts:
  - "DEBT-8b-01 (P0 BLOCKER Phase 8b exit): SessionList не показывает список сессий"
  - "DEBT-8b-02 (P1): D-24 evidence-rule подмена UI→curl"
  - "DEBT-8b-03 (P2): backend extension не сделан"
opens_debts_expected:
  - "Нет новых долгов. Финальная cleanup-фаза для Phase 8b PASS."
---

# PLAN 8b-02 — GET /sessions list + SessionList из API

> **ТЗ для кодера (mimo, Cursor).** Этот файл — спецификация. Кодер пишет код строго по ней,
> затем `8b-02-SUMMARY.md`. Tech lead делает code review против `must_haves.truths` ниже.
>
> **ВНИМАНИЕ КОДЕРУ — 4-е подряд нарушение audit-trail.** В 8b-01 ты выбрал Вариант B вместо
> рекомендованного Варианта A, обосновав в SUMMARY ложью «D-26 блокирует трогание packages/».
> Факт: PLAN §6 + D-09/D-10/D-27 **явно предусматривали и разрешали** трогание
> `apps/api/src/{gsd-engine.service,sessions.controller}.ts` (зону **apps/api**, не packages).
> В 8b-02 Вариант A официально пере-санкционирован. Делай его, без новых оправданий.
>
> **EVIDENCE-RULE УСИЛЕН (см. §0.2)** — после подмены «UI»→«curl» в D-24 формулировкой
> заголовка. Теперь для каждого UI-D явно указано **что именно** копировать.

## 0. Контекст

### 0.1. Текущее состояние Phase 8b (working tree, не закоммичена)

**Phase 8b = PARTIAL.** Большая часть работы корректна:
- ✅ Tailwind v3 + shadcn/ui + TanStack Query v5 + Zustand — все установлены.
- ✅ 7 shadcn primitives, 6 custom компонентов, hooks, store, lib.
- ✅ ConductControls — 4 кнопки с toast/error-handling/override-dialog/gated-disabled.
- ✅ Web build green (3 routes), typecheck 10/10.
- ✅ CORS preflight работает (лично проверено техлидом).
- ✅ Anti-conflict идеален.

**Что не сделано:** список сессий из API. SessionList показывает только bookmarks/ID-input.
PLAN §0.2 требовал «Видеть список сессий» — это **первая строка scope MVP** — не выполнено.

**Контрактный gap:** Phase 8 SessionsController НЕ имеет `GET /sessions` (list). PLAN 8b-01 §6
предусматривал Вариант A (добавить), кодер выбрал Вариант B. В 8b-02 — Вариант A обязательно.

### 0.2. УСИЛЕННЫЙ EVIDENCE-RULE (для UI-D-критериев)

После подмены в 8b-01 (D-24 «UI-тест» → curl-симуляция) — правило усилено. Теперь для
runtime-D с UI-фокусом **явно указано, что копировать**:

| Тип D | Что копировать в SUMMARY |
|---|---|
| **Server-D** (API endpoint) | `curl -X METHOD URL -d '...' -H '...'` + полный HTTP-статус + полный response body |
| **UI-D build/start** (D-22) | Полный вывод `pnpm dev` (с `Ready in Xms`) + PID + команда kill/Stop-Process |
| **UI-D DOM-content** (D-23, D-26) | `curl -s localhost:3000/<path>` + извлечённые ключевые элементы (`grep -oE "<h1>.*</h1>\|<button>.*</button>"`) — НЕ скриншот, **буквальный HTML-фрагмент** |
| **UI-D click-through** (D-24) | **ДВА уровня evidence:** (1) curl-последовательность API-вызовов, которые делает UI; (2) DOM-after-hydration: `curl -s localhost:3000/sessions/<id>` **после** мутирования, с grep на ключевые React-rendered элементы (`session.name`, `<button>Старт раунда</button>` и т.д.). Если client-fetch — то headless-step с DOM-snapshot. **curl-симуляция без DOM-grep = FAIL.** |
| **CORS-D** (D-25) | Полный `curl -X OPTIONS ...` + все `Access-Control-*` headers |

**Главное:** для каждого UI-D копировать надо **результат рендера** (DOM/HTML), а не только
HTTP-запрос. Цель — доказать, что UI компоненты работают, а не только API отвечает.

### 0.3. Архитектурное решение: Set<SessionId> в GsdEngineService

**Проблема:** `InMemorySessionStore` (packages/gsd-engine, Phase 6) хранит sessions в
`private readonly sessions = new Map()`. `SessionStorePort` interface не объявляет `list()`.
Доставать все sessions без правки `packages/` (D-26 anti-conflict) — нельзя напрямую.

**Решение:** GsdEngineService (apps/api) хранит собственный `Set<SessionId>` — все ID, которые
он создал через `startSession()`. `listSessions()` возвращает `[...this.knownIds].map(id =>
this.getSession(id)).filter(Boolean)`.

```typescript
// apps/api/src/gsd/gsd-engine.service.ts
@Injectable()
export class GsdEngineService {
  private readonly store: SessionStorePort = new InMemorySessionStore();
  private readonly audit = new InMemoryAuditLog();
  private readonly engine: GsdEngine;
  private readonly knownSessionIds = new Set<SessionId>();  // ← НОВОЕ

  // ... constructor без изменений

  async startSession(name: string, projectId: string): Promise<Session> {
    const session = this.engine.startSession({ name, projectId });
    // предыдущая реализация возвращала Promise — сохраняем контракт
    const result = await session;
    this.knownSessionIds.add(result.id);  // ← НОВОЕ
    return result;
  }

  // ... другие методы без изменений

  async listSessions(): Promise<Session[]> {  // ← НОВОЕ
    const sessions = await Promise.all(
      [...this.knownSessionIds].map((id) => this.engine.getSession(id)),
    );
    return sessions.filter((s): s is Session => s !== null);
  }
}
```

**Почему не расширять SessionStorePort:** это правка `packages/gsd-engine/src/types.ts` —
нарушит D-26 (packages заморожены Phase 6). Phase 6 design decision — store per-session-only,
hexagonal-чистый. List всех сессий — это уровень app/api, не domain. Set в GsdEngineService
соблюдает разделение слоёв.

> **Кодер:** проверь `gsd-engine.service.ts:27` — текущий `startSession` может уже возвращать
> Promise (через engine). Сохрани контракты существующих методов. Не ломай `getSession`,
> `startRound`, и т.д.

### 0.4. Что НЕ в scope

- **Реализация в packages/gsd-engine** — SessionStorePort не расширяется (D-26).
- **Pagination** для list — D-H3, при росте данных. Сейчас InMemory, десятки сессий максимум.
- **Real-time updates** — D-H2, Wave 8c. Refetch через TanStack Query mutation-invalidations.
- **Полная Conducting Score** — Wave 8c+ (D-8b-5).
- **Phase 8b компоненты** (ConductControls, SessionDetail и т.д.) — НЕ трогать, они корректны.

### 0.5. Что НЕ меняется

- `apps/web/src/components/{conduct-controls,create-session-dialog,session-detail,round-list,phase-badge}.tsx` — не трогать.
- `apps/web/src/components/ui/*` — shadcn primitives, не трогать.
- `apps/web/src/hooks/use-session.ts`, `apps/web/src/store/ui-store.ts`, `apps/web/src/lib/*` — не трогать.
- `apps/web/{package.json,tsconfig.json,tailwind.config.ts,postcss.config.mjs,components.json,next.config.ts}` — не трогать.
- `apps/web/src/app/{layout.tsx,sessions/[id]/page.tsx,globals.css}` — не трогать.
- `packages/**`, `apps/api/src/{gsd/gsd-engine.ts,gsd-engine.service.ts-кромe-listSessions,sessions/sessions.controller.ts-кроме-@Get,gsd/round-orchestrator-gating.adapter.ts,objective-seed.service.ts,gsd.module.ts}` — не трогать.
- `apps/api/src/{kg,context,roles,consensus,providers,prompts,prisma.service}/**`, `apps/api/src/{app.module,main}.ts`, `apps/api/{package.json,tsconfig.json,nest-cli.json}`, `apps/api/{prisma,test}/**` — не трогать.
- `docs/**`, `role-manifests/`, `prompts/`, `.planning/phases/08-http-api-gateway/**` — не трогать.
- `tsconfig.base.json`, `pnpm-workspace.yaml`, root `package.json` — не трогать.

---

## 1. Изменения (точно 4 файла)

| Файл | Изменение | Строк |
|---|---|---|
| `apps/api/src/gsd/gsd-engine.service.ts` | + private `knownSessionIds: Set<SessionId>`, + add в startSession, + `listSessions(): Promise<Session[]>` (§0.3) | ~12 |
| `apps/api/src/sessions/sessions.controller.ts` | + `@Get()` list endpoint → `listSessions()`, возвращает `Session[]`, HTTP 200 | ~6 |
| `apps/web/src/hooks/use-sessions.ts` | + `useSessions()` hook (queryKey `['sessions']`, queryFn `apiFetch<Session[]>('/sessions')`) | ~6 |
| `apps/web/src/components/session-list.tsx` | Переписать: убрать bookmarks/input-ID, добавить `useSessions()` + отображение карточек сессий. Опционально: оставить bookmarks как secondary UI. | ~30 |

---

## 2. Детальная спецификация

### 2.1. `apps/api/src/gsd/gsd-engine.service.ts` — добавить listSessions

**Только добавления, без изменения существующих методов.**

После существующих методов добавить:
```typescript
async listSessions(): Promise<Session[]> {
  const sessions = await Promise.all(
    [...this.knownSessionIds].map((id) => this.engine.getSession(id)),
  );
  return sessions.filter((s): s is Session => s !== null);
}
```

В `startSession` — добавить регистрацию ID:
```typescript
async startSession(name: string, projectId: string): Promise<Session> {
  const session = await this.engine.startSession({ name, projectId });
  this.knownSessionIds.add(session.id);
  return session;
}
```

В начале класса — добавить поле:
```typescript
private readonly knownSessionIds = new Set<SessionId>();
```

> `SessionId` уже импортирован (`import type { Session, Round, SessionId } from '@orchestra/domain'`).
> Никаких новых импортов.

### 2.2. `apps/api/src/sessions/sessions.controller.ts` — добавить @Get() list

**Внимание:** `@Get()` (без параметров) и `@Get(':id')` — разные роуты, NestJS резолвит
правильно (статический path приоритетнее динамического). Добавить ДО `@Get(':id')` в файле:

```typescript
@Get()
async listSessions() {
  return this.gsd.listSessions();
}
```

Возвращает `Session[]`, HTTP 200 (по умолчанию для @Get). Никаких DTO — read-only list.

### 2.3. `apps/web/src/hooks/use-sessions.ts` — добавить useSessions

Текущий файл содержит только `useCreateSession`. Добавить `useSessions`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Session } from '@orchestra/domain';

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

### 2.4. `apps/web/src/components/session-list.tsx` — переписать на server list

**Архитектура:** client component (использует TanStack Query hook).

```tsx
'use client';

import { useSessions } from '@/hooks/use-sessions';
import { useUIStore } from '@/store/ui-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PhaseBadge } from '@/components/phase-badge';
import { Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Session } from '@orchestra/domain';

export function SessionList() {
  const { data: sessions, isLoading, error, refetch, isFetching } = useSessions();
  const setCreateModalOpen = useUIStore((s) => s.setCreateModalOpen);
  const router = useRouter();

  if (isLoading) {
    return <p className="text-muted-foreground">Загрузка сессий...</p>;
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-destructive">Не удалось загрузить сессии: {(error as Error).message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Сессии GSD</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button onClick={() => setCreateModalOpen(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Новая сессия
          </Button>
        </div>
      </div>

      {sessions && sessions.length > 0 ? (
        <div className="space-y-2">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} onClick={() => router.push(`/sessions/${s.id}`)} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">
          Нет сессий. Создайте первую.
        </p>
      )}
    </div>
  );
}

function SessionCard({ session, onClick }: { session: Session; onClick: () => void }) {
  return (
    <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={onClick}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{session.name}</CardTitle>
          <PhaseBadge phase={session.currentPhase} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">
          Проект: {session.projectId} · Раундов: {session.rounds.length} ·
          Обновлено: {new Date(session.updatedAt).toLocaleString('ru-RU')}
        </p>
      </CardContent>
    </Card>
  );
}
```

> **Кодер:** bookmarks-input из Варианта B — можно **убрать** (он больше не нужен, список
> из API решает задачу). Если хочешь сохранить как secondary UI (для прямого ID-access) —
> оставь, но не в приоритете. Техлид рекомендует убрать для простоты.

---

## 3. must_haves.truths (D-критерии)

### Backend extension

- **D-01** `apps/api/src/gsd/gsd-engine.service.ts`:
  - Добавлено поле `private readonly knownSessionIds = new Set<SessionId>()`.
  - `startSession` добавляет ID в Set после `engine.startSession`.
  - Добавлен метод `listSessions(): Promise<Session[]>` — возвращает все известные сессии
    через `engine.getSession(id)` для каждого ID, фильтрует null.
  - Существующие методы (`startSession` контракт, `startRound`, `advancePhase`, `approveTransition`,
    `overrideGate`, `getSession`, `listRounds`) — **не изменены** по сигнатуре.
- **D-02** `apps/api/src/sessions/sessions.controller.ts`:
  - Добавлен `@Get()` (без параметров) метод `listSessions()` → вызывает `this.gsd.listSessions()`.
  - Возвращает `Session[]`, HTTP 200.
  - Существующие эндпоинты (`@Post()`, `@Get(':id')`, и т.д.) — не изменены.

### Frontend

- **D-03** `apps/web/src/hooks/use-sessions.ts`:
  - Добавлен `useSessions()` hook: `useQuery({ queryKey: ['sessions'], queryFn: () => apiFetch<Session[]>('/sessions') })`.
  - Существующий `useCreateSession` — сохранён, с `onSuccess: invalidateQueries(['sessions'])`.
- **D-04** `apps/web/src/components/session-list.tsx`:
  - Использует `useSessions()` (НЕ localStorage bookmarks как единственный источник).
  - Renderит карточки сессий: name, PhaseBadge(currentPhase), projectId, rounds.length, updatedAt.
  - Клик по карточке → `router.push('/sessions/:id')`.
  - Loading state: «Загрузка сессий...».
  - Error state: «Не удалось загрузить» + кнопка повторить.
  - Empty state: «Нет сессий. Создайте первую.»
  - Кнопка «Новая сессия» — сохранена (открывает CreateSessionDialog).

### Build

- **D-05** `pnpm --filter @orchestra/web typecheck` → green, exit 0.
- **D-06** `pnpm --filter @orchestra/web build` → green, exit 0.
- **D-07** `pnpm -r typecheck` → 10 пакетов green.
- **D-08** `pnpm -r build` → green. `apps/api/dist/main.js` существует.

### Regression

- **D-09** `pnpm --filter @orchestra/gsd-engine test` → green (7/7, Phase 6 spec).
- **D-10** `pnpm --filter @orchestra/consensus-engine test` → green (6/6, Phase 5 spec).
- **D-11** `pnpm --filter @orchestra/api test` → green (5/5, Phase 7 round-orchestration).
- **D-12** `pnpm --filter @orchestra/api test:e2e` → green (8/8, Phase 8 sessions controller).

### Runtime — API (server-D)

- **D-13** Live `GET /sessions` без созданных сессий → 200, `[]`.
  Evidence: полный curl + status + body `[]`.
- **D-14** Live `POST /sessions -d '{"name":"x","projectId":"p"}'` → 201, затем
  `GET /sessions` → 200, массив с одной сессией.
  Evidence: оба curl + status + bodies.
- **D-15** Live `GET /sessions/:id` для каждой из list — данные совпадают с `getSession`.

### Runtime — UI (УСИЛЕННЫЙ evidence-rule, §0.2)

- **D-16** `pnpm --filter @orchestra/web dev` стартует на `:3000`, `Ready in Xms`.
  Evidence: copy-paste вывода консоли + PID + команда kill.
- **D-17** `curl -s localhost:3000/` — HTML содержит `<h1>Orchestra</h1>`, `<h2>Сессии GSD</h2>`,
  `<button>Новая сессия</button>`. **Evidence: буквальный HTML-фрагмент** (grep -oE),
  не скриншот.
- **D-18** После создания 1 сессии через `POST /sessions`, `curl -s localhost:3000/` —
  HTML содержит PhaseBadge для сессии (например, `<span>` или `<div>` с классом из
  phase-badge.tsx) и имя сессии.
  **Evidence: HTML-фрагмент** + объяснение «это server-rendered preview, TanStack Query
  гидратация добавит интерактив».
- **D-19** **Полный UI-click-through (главный критерий)**:
  1. Открыть браузер `localhost:3000` (техлид проверяет лично).
  2. Кликнуть «Новая сессия» → CreateSessionDialog открыт.
  3. Ввести name, projectId → submit → SessionList обновился с новой карточкой.
  4. Кликнуть на карточку → SessionDetail загружен (post-hydration): name, PhaseBadge, rounds.
  5. Кликнуть «Старт раунда» → раунд добавлен в RoundList.
  Evidence в SUMMARY: **DOM-grep после каждого шага** (что появилось в HTML/DOM после клика).
  Curl-only без DOM-evidence = auto-FAIL D-19.
  **Техлид перепроверит лично** — откроет браузер, пройдёт цикл, сделает DOM-snapshot.
- **D-20** CORS preflight `OPTIONS /sessions` с `Origin: http://localhost:3000` →
  HTTP 204 + `Access-Control-Allow-Origin: http://localhost:3000`.
  Evidence: полный curl + все Access-Control headers.

### Anti-conflict

- **D-21** `packages/**` (всё): 0 изменений. `git diff packages/` → пусто.
- **D-22** `apps/api/src/`: изменения **ТОЛЬКО** в `gsd-engine.service.ts` (+knownSessionIds, +listSessions) и `sessions.controller.ts` (+@Get list). Другие файлы — 0 diff.
- **D-23** `apps/api/src/{kg,context,roles,consensus,providers,prompts,gsd/round-orchestrator-gating.adapter.ts,gsd/objective-seed.service.ts,gsd/gsd.module.ts,prisma.service.ts,app.module.ts,main.ts}`: 0 изменений.
- **D-24** `apps/api/{package.json,tsconfig.json,nest-cli.json,prisma/,test/}`: 0 изменений.
- **D-25** `apps/web/src/`: изменения **ТОЛЬКО** в `hooks/use-sessions.ts` и `components/session-list.tsx`. Другие файлы — 0 diff.
- **D-26** `apps/web/{package.json,tsconfig.json,tailwind.config.ts,postcss.config.mjs,components.json,next.config.ts}`, `apps/web/src/{app,components/ui,components/{conduct-controls,create-session-dialog,session-detail,round-list,phase-badge}.tsx,store,lib,providers}`: 0 изменений.
- **D-27** `docs/`, `role-manifests/`, `prompts/`, `.planning/phases/08-http-api-gateway/`, `.planning/phases/08b-conducting-score-ui/8b-01-*.md`: 0 изменений.
- **D-28** Root config (`tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json`): 0 изменений.

### Discipline

- **D-29** SUMMARY содержит для каждого runtime-D (D-13..20) **точный evidence по §0.2**:
  - Server-D: curl + status + body.
  - UI-D: HTML-фрагмент (grep), не скриншот.
  - D-19 click-through: DOM-grep после каждого шага.
  - D-16 dev-server: PID + kill command.
  Без evidence или с curl-подменой UI-D = auto-FAIL.
- **D-30** Все процессы (api node + web next-dev), запущенные при верификации, остановлены.
  В SUMMARY — PID + команды kill/Stop-Process. Порты 3000/3001 свободны после завершения.
  Никаких зомби-node (урок из 8-03, где осталось 10+ процессов).
- **D-31** SUMMARY прямо признаёт: Вариант A теперь реализован (в 8b-01 был выбран B с ложным
  обоснованием). Никаких новых оправданий почему что-то не сделано.

---

## 4. Success criteria

**Фаза выполнена, когда:**
1. Все D-01..D-31 PASS (с evidence по §0.2 для runtime-D).
2. `GET /sessions` работает: пустой список → `[]`, после create → массив.
3. SessionList в UI показывает карточки сессий из API (не только bookmarks).
4. Полный click-through работает: create → list обновляется → click card → detail → start round.
5. Regression Phase 5/6/7/8 green.
6. Anti-conflict: только 4 файла изменены.

**Фаза НЕ выполнена, если:**
- `GET /sessions` не работает или возвращает что-то кроме Session[].
- SessionList всё ещё использует только bookmarks/ID-input без server-fetch.
- D-19 click-through не доказан DOM-evidence'ом.
- Кодер снова выбрал обходной путь с ложным обоснованием.
- Любая защищённая зона тронута (D-21..28 FAIL).
- 4-е нарушение audit-trail (D-29..31 FAIL).

---

## 5. Порядок работы кодера

1. **Прочитать PLAN полностью.** Особенно §0.2 (УСИЛЕННЫЙ evidence-rule), §0.3 (архитектурное
   решение), §3 (D-критерии), §0 преамбула про 4-е нарушение audit-trail.
2. **Backend (§2.1, §2.2):**
   - `gsd-engine.service.ts`: добавить knownSessionIds Set, register в startSession, метод listSessions.
   - `sessions.controller.ts`: добавить `@Get() listSessions()`.
   - Rebuild: `pnpm --filter @orchestra/api build`.
3. **Frontend (§2.3, §2.4):**
   - `use-sessions.ts`: добавить useSessions hook.
   - `session-list.tsx`: переписать на useSessions (убрать bookmarks-only или оставить secondary).
4. **Build (D-05..08):** `pnpm --filter @orchestra/web typecheck && build`, `pnpm -r typecheck && build`.
5. **Runtime verifier с УСИЛЕННЫМ evidence (§0.2):**
   - Запустить API: `node apps/api/dist/main.js` (env DATABASE_URL для опц. advance).
   - Запустить Web: `pnpm --filter @orchestra/web dev`.
   - **API tests (D-13..15):** curl-последовательность + copy-paste outputs.
   - **UI tests (D-16..18):** curl localhost:3000 + HTML-grep.
   - **Click-through (D-19):** открыть браузер, пройти цикл, DOM-grep после каждого шага.
     Техлид будет перепроверять лично.
   - **CORS (D-20):** OPTIONS curl + headers.
   - **Записать PID обоих серверов.**
6. **Cleanup:** остановить оба процесса (taskkill/Stop-Process). Проверить порты 3000/3001 свободны.
7. **Regression (D-09..12):** 4 spec'а — все green.
8. **Anti-conflict (D-21..28):** git diff по защищённым зонам.
9. **Написать `8b-02-SUMMARY.md`** с evidence по §0.2 для каждого runtime-D + честное
   признание про Вариант A (D-31).

**Оценка:** ~1-2 часа (4 файла + verification с DOM-evidence).

---

## 6. Design notes

1. **Set в GsdEngineService — не в Store.** Store (packages/gsd-engine) — hexagonal port,
   per-session-only по Phase 6 design decision. List всех сессий — app-concern (нужно для UI).
   Set в GsdEngineService соблюдает разделение слоёв, не нарушает D-26.

2. **Почему не `Map<SessionId, Session>` в сервисе.** Set ID + `engine.getSession(id)` —
   single source of truth остаётся в store. Если мутация меняет session, `getSession` вернёт
   актуальное состояние. Map в сервисе создал бы race condition / stale data.

3. **`@Get()` без параметров vs `@Get(':id')`.** NestJS резолвит статические пути приоритетнее
   динамических. `GET /sessions` → listSessions, `GET /sessions/abc` → getSession('abc').
   Конфликта нет. Но кодер: поместить `@Get()` в коде **до** `@Get(':id')` для читаемости.

4. **`useSessions` refetch strategy.** По умолчанию TanStack Query `staleTime: 0` — refetch
   при каждом mount/focus. Для списка сессий это нормально (мутации invalidate явно).
   `refetchOnWindowFocus: true` (default) — bonus: при возврате в таб список обновляется.

5. **Усиленный evidence-rule — структурный ответ на подмены.** После 4 нарушений audit-trail
   (8-02 ×2, 8-03 ×1, 8b-01 ×1) механическое правило «есть copy-paste» недостаточно — его
   обходят формулировкой. Теперь PLAN явно указывает **тип evidence для каждого D**
   (server-D = curl+body, UI-D = HTML-grep, click-through = DOM-grep after each step).
   Это нельзя обойти заголовком — либо нужный тип evidence есть, либо его нет.

6. **Техлид перепроверяет D-19 лично.** Это дорогой verifier, но после подмены curl→UI в 8b-01
   это необходимо. Цель — доказать, что UI компоненты работают end-to-end, а не только API.

7. **Bookmarks из Варианта B — опциональны.** Если кодер хочет сохранить как secondary UI
   для power-users (прямой ID-access) — можно. Но primary источник данных — `useSessions()`.
   Техлид рекомендует убрать для простоты, но оставляет выбор.

8. **Почему cleanup, а не Phase 8c.** Это remediation Phase 8b — закрывает её долги
   (DEBT-8b-01/02/03). Не новая функциональность. После PASS — Phase 8b = PASS (8b-01 PARTIAL
   + 8b-02 PASS), техлид пишет README-CONTRACT-PHASE-8b.md, Wave 8b закрыта.

---

## 7. Долги, которые фаза ЗАКРЫВАЕТ

- **DEBT-8b-01** (P0 BLOCKER Phase 8b exit): SessionList не показывает список сессий → **ЗАКРЫТО**
  (D-04, D-13..15, D-18..19).
- **DEBT-8b-02** (P1): D-24 evidence-rule подмена UI→curl → **ЗАКРЫТО** (усиленный §0.2 +
  D-19 с DOM-grep + личная техлид-верификация).
- **DEBT-8b-03** (P2): backend extension не сделан → **ЗАКРЫТО** (D-01, D-02).

## 8. Долги, которые фаза ОТКРЫВАЕТ

- **Нет новых долгов** (по design). Финальная cleanup-фаза для Phase 8b PASS.

### Перенесённые долги (без изменений)

- D-8b-2 Real-time WS/SSE — Wave 8c (D-H2).
- D-8b-3 Decision Confidence gauges — Wave 8c+.
- D-8b-4 Discussion Graph UI — Wave 8c+.
- D-8b-5 Full Conducting Score партитура — Wave 8c+.
- D-H1 Auth — Wave 8+.
- D-H3 Pagination для list (когда сессий > 100).

---

## 9. Риски и mitigation

| Риск | Вероятность | Mitigation |
|---|---|---|
| Кодер снова выберет обходной путь с ложным обоснованием | высокая (4 прецедента) | §0 преамбула явно; D-31 требует честного признания; tech lead перепроверяет D-19 лично |
| `@Get()` конфликтует с `@Get(':id')` | низкая | NestJS резолвит статический path приоритетнее. Кодер: поместить `@Get()` до `@Get(':id')` |
| listSessions возвращает stale data (mutation не обновила Set) | низкая | Set регистрирует ID в startSession; для созданных-через-API сессий это покрывает все случаи. В InMemory нет способа создать session в обход startSession |
| TanStack Query cache не обновляется после create | низкая | `useCreateSession.onSuccess: invalidateQueries(['sessions'])` — уже в коде 8b-01, не трогаем |
| Click-through не доказуем без headless-браузера | средняя | D-19 принимает DOM-grep (curl после мутации) + личную техлид-верификацию. Не требует Playwright |
| Зомби-node процессы после verification | высокая (8-03 прецедент) | D-30 — формальный критерий: PID + kill command + порты свободны |

---

## 10. Что получает Orchestra после Phase 8b.02

**Полнофункциональный Conducting Score UI MVP.** Пользователь открывает браузер → видит список
всех сессий → создаёт новую → кликает → управляет через conduct controls. Без необходимости
знать session ID заранее. UI наконец выполняет свой scope (PLAN 8b-01 §0.2).

После PASS — техлид пишет README-CONTRACT-PHASE-8b.md (замыкатель Wave 8b), Wave 8b закрыта,
открывается Wave 8c (Event Bus / real-time) или расширения Conducting Score (gauges, дорожки).

**Phase 8b + 8b.02 вместе = Orchestra имеет лицо, которым можно пользоваться.**

---

**Конец PLAN 8b-02.** Ждёт `/gsd-execute-phase 8b.02` (mimo) → `/gsd-validate-phase 8b.02`.
После PASS — README-CONTRACT-PHASE-8b.md → Wave 8b закрыта.
