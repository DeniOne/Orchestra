---
phase: 5b
slug: 05b-cleanup-test-script
wave: B-5b
title: "Cleanup-волна 5-02: фикс test-script D-E5 (Phase 5 → чистый PASS)"
milestone: "Orchestra MVP — Wave 5 (Consensus Layer) cleanup"
coder: mimo (Cursor)
tech_lead: zcode (ZCode)
date: 2026-07-18
status: DRAFT
verifier: spec-gate (pnpm --filter @orchestra/consensus-engine test → 6/6 green) + build-gate (pnpm -r typecheck)
baseline_before: "Phase 5 заморожена PARTIAL (commit 9943edd): 32/33 D-PASS, единственный долг D-E5 (test-script broken)"
depends_on:
  - "Phase 5 (consensus-engine.spec.ts существует, 6 сценариев логически PASS)"
closes_debts:
  - "D-E5 (test-script node --import tsx --test не запускает .ts spec на Windows)"
opens_debts_expected: []
---

# PLAN 5b-01 — Cleanup-волна: фикс test-script (D-E5)

> **ТЗ для кодера (mimo, Cursor).** Однострочная правка. Tech Lead уже провёл разведку
> (см. §3) — точное решение известно. Цель: Phase 5 → чистый PASS (32/33 → 33/33).

## 0. Контекст (почему эта волна)

Phase 5 заморожена **PARTIAL** (commit `9943edd`, README-CONTRACT-PHASE-5). Единственный
не-достигнутый критерий — **D-24**: `pnpm --filter @orchestra/consensus-engine test`
возвращает `tests 0, pass 0` (ложно-зелёный: 0 fail, но 0 run).

**Корень (выявлен Tech Lead в валидации Phase 5):** test-script
`"test": "node --import tsx --test"` не передаёт путь к spec-файлу. На Windows + Node 22 +
tsx 4.23 связка `node --test` (без path) + tsx-loader не регистрирует `describe`/`it` из
`.spec.ts` в `test/` — Node ищет только по дефолтному паттерну, но tsx-трансляция ломает
discovery.

Сами тесты логически верны — 6/6 PASS доказаны Tech Lead двумя способами:
1. Компиляция src+test в temp + `node --test <path>` → 6/6 green за 303ms.
2. `node --import tsx --test test/consensus-engine.spec.ts` (явный путь) → 6/6 green
   за 2554ms (tsx транпайлит на лету).

Значит фикс = **передать явный путь к spec в test-script**.

## 1. Единственное изменение (1 файл, 1 строка)

**Файл:** `packages/consensus-engine/package.json`
**Поле:** `scripts.test`

**Было:**
```json
"test": "node --import tsx --test"
```

**Стало:**
```json
"test": "node --import tsx --test test/consensus-engine.spec.ts"
```

> **Почему явный путь, а не glob `test/**/*.spec.ts`?** Разведка Tech Lead показала: Node
> на Windows **не раскрывает** glob в path-аргументе (ищет литеральный файл
> `test/**/*.spec.ts`, получает "Could not find"). Явный путь — единственный надёжно
> рабочий вариант на Windows + Node 22. Если в будущем spec-файлов станет несколько —
> перечислить через пробел: `node --import tsx --test test/a.spec.ts test/b.spec.ts`.
> Это acceptable для MVP (Wave 6+ может перейти на vitest с auto-discovery).

## 2. Файлы, которые НЕ трогать (anti-conflict)

| Зона | Почему | Проверка |
|---|---|---|
| Всё кроме `packages/consensus-engine/package.json` | Это cleanup одной строки | `git diff --stat` должен показать ровно 1 файл, 1 строку changed |
| `packages/consensus-engine/src/**` | Логика ядра — Phase 5 заморожена | `git diff packages/consensus-engine/src/` → пусто |
| `packages/consensus-engine/test/**` | Сами тесты корректны (6/6 PASS) | `git diff packages/consensus-engine/test/` → пусто |
| `apps/api/**`, другие packages | Не относятся к test-script | `git diff` → пусто |
| `domain`, фазы 2-4, docs, web | Замороженные зоны | `git diff` → пусто |

## 3. Разведка Tech Lead (обоснование выбранного fix)

Tech Lead (ZCode) провёл 4 эксперимента перед написанием этого PLAN:

| Кандидат | Команда | Результат |
|---|---|---|
| 1. Glob path | `node --import tsx --test test/**/*.spec.ts` | ❌ FAIL — Node не раскрывает `**` на Windows, ищет литеральный файл |
| 2. **Явный путь** | `node --import tsx --test test/consensus-engine.spec.ts` | ✅ **PASS — 6/6 green, exit 0, 2554ms** |
| 3. Флаги без path | `node --import tsx --test --test-name-pattern=".*"` | ❌ FAIL — пустой вывод, 0 тестов |
| 4. Bare (оригинал) | `node --import tsx --test` | ❌ FAIL — `tests 0, pass 0` (исходный баг) |

**Вывод:** кандидат 2 (явный путь) — единственный рабочий. Это и есть фикс.

## 4. must_haves.truths (D-критерии)

- **D-01** `packages/consensus-engine/package.json` script `test` содержит явный путь к
  `test/consensus-engine.spec.ts`. Проверка: `grep '"test"' packages/consensus-engine/package.json`
  → содержит `test/consensus-engine.spec.ts`.
- **D-02** `pnpm --filter @orchestra/consensus-engine test` → `# tests 6, # pass 6,
  # fail 0`, exit 0. **Это и есть закрытие D-E5.**
- **D-03** Изменён ровно 1 файл (`packages/consensus-engine/package.json`), ровно 1 строка.
  `git diff --stat` → `1 file changed, 1 insertion(+), 1 deletion(-)`.
- **D-04** `pnpm -r typecheck` → 9 пакетов green (регрессия исключена, но проверить).
- **D-05** Никакие другие файлы не изменены. `git diff --stat` по всем защищённым зонам
  (§2) → пусто.

## 5. Success criteria

**Волна выполнена, когда:**
1. D-01..D-05 PASS.
2. `pnpm --filter @orchestra/consensus-engine test` → 6/6 green, exit 0 (D-E5 закрыт).
3. Phase 5 итоговый вердикт → **PASS (33/33)**. Tech Lead обновляет README-CONTRACT-PHASE-5
   (D-24: FAIL → ✅ PASS) и MEMORY (D-E5: [DONE 2026-07-18]).

**Не выполнена, если:**
- Тесты по-прежнему 0 run или красные.
- Изменено >1 файла (лишние правки = scope creep).
- Typecheck упал.

## 6. Порядок работы кодера

1. Открыть `packages/consensus-engine/package.json`.
2. Заменить строку `"test": "node --import tsx --test"` на
   `"test": "node --import tsx --test test/consensus-engine.spec.ts"`.
3. Прогнать: `pnpm --filter @orchestra/consensus-engine test` → убедиться 6/6 green.
4. Прогнать: `pnpm -r typecheck` → убедиться 9 пакетов green.
5. `git diff --stat` → убедиться ровно 1 файл, 1 строка.
6. Написать `5b-01-SUMMARY.md` (короткий: что изменено, результат test, duration ~2мин).

**Оценка:** ~2 минуты.

## 7. После волны (Tech Lead)

- Code review: D-01..D-05 против `git diff`.
- Verifier: `pnpm --filter @orchestra/consensus-engine test` → 6/6 green.
- Обновить `README-CONTRACT-PHASE-5.md`: D-24 FAIL → ✅ PASS, вердикт PARTIAL → **PASS**.
- Обновить MEMORY: `D-E5 [DONE 2026-07-18]`.
- Atomic commit + push: `fix(phase-5b): cleanup test-script D-E5 — Phase 5 → PASS (33/33)`.

Phase 5 окончательно закрыта. Pipeline готов к Phase 6 (GSD Engine).
