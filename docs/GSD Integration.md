# GSD Integration

> Жизненный цикл GSD в Orchestra: фазы, артефакты, gating, роль человека-дирижёра на каждом шаге.
> Смежные: [Architecture.md](Architecture.md) (GSD Engine), [Consensus Protocol.md §6](Consensus%20Protocol.md#6-gating-по-фазам-gsd) (gating), [Agent Protocol.md](Agent%20Protocol.md).

Каждая задача в Orchestra проходит одинаковый жизненный цикл GSD (Goal → Spec → Develop). Переход на следующую фазу **невозможен** до завершения текущей — и пока Decision Confidence не пройдёт порог gating, и пока человек не подтвердит переход.

---

## 1. Жизненный цикл GSD

```text
Discover
   ↓
Goal
   ↓
Specification
   ↓
Architecture
   ↓
Implementation
   ↓
Review
   ↓
Consensus
   ↓
Iteration  ◀── (если gating FAIL)
```

GSD — это конечный автомат внутри GSD Engine (см. [Architecture.md §9](Architecture.md#9-жизненный-цикл-gsd-как-системный-flow)). Каждая фаза produces конкретный инженерный артефакт, который становится узлом Knowledge Graph.

---

## 2. Фаза → Артефакт → Результат

| Фаза | Ключевая роль | Артефакт на выходе | Узел Knowledge Graph |
|---|---|---|---|
| **Discover** | Gemini | Research notes | `Research` |
| **Goal** | ChatGPT | Goal statement | `Goal` |
| **Specification** | ChatGPT + GLM | Specification | `Requirement`, `Specification` |
| **Architecture** | ChatGPT | ADR | `ADR`, `Architecture` |
| **Implementation** | MiMo | Code, migration | `Code`, `Task` |
| **Review** | Critic | Review report | `Review` |
| **Consensus** | Consensus Engine | Consensus Report + Decision | `Decision`, `Consensus` |
| **Iteration** | (loop) | Updated artifacts | версионные `replaces`/`supersedes` |

---

## 3. Gating-правила

Переход между фазами контролируется Decision Confidence (см. [Consensus Protocol.md §6](Consensus%20Protocol.md#6-gating-по-фазам-gsd)). GSD Engine запрашивает gating-вердикт у Consensus Engine и публикует `PhaseChanged` на Event Bus только при `pass`.

| Переход | Ключевая метрика | Порог |
|---|---|---|
| Goal → Specification | Architecture Confidence | 70 % |
| Specification → Architecture | Research Coverage | 75 % |
| Architecture → Implementation | Architecture Confidence | 85 % |
| Implementation → Review | Implementation Confidence | 80 % |
| Review → Consensus | Risk Coverage | 70 % |
| Consensus → exit | overall | 80 % |

При `fail` — переход в `Iteration` с явным списком пробелов (недостающие исследования, непокрытые риски). Обход gating возможен только через **owner-override** дирижёра с записью в аудит.

---

## 4. Человек как финальный арбитр

Orchestra не принимает необратимых решений самостоятельно. **Human Governance**: ИИ предлагает, спорит, исследует, реализует — но окончательное решение всегда утверждает человек.

### Роль человека на каждой фазе

| Фаза | Роль человека (дирижёра) |
|---|---|
| Discover | Утверждает тему исследования |
| Goal | Формулирует/уточняет цель |
| Specification | Утверждает требования |
| Architecture | **Обязательно утверждает ADR** |
| Implementation | Запускает кодогенерацию (триггер MiMo) |
| Review | Знакомится с выводами Critic |
| Consensus | **Обязательно утверждает финальное Decision** и переход фазы |
| Iteration | Направляет итерацию (что доработать) |

Архитектурные изменения, переходы между фазами GSD и запуск кодогенерации требуют подтверждения пользователя. Роль человека — главный архитектор процесса и владелец решения.

---

## 5. Человек-дирижёр (концепция)

Пользователь Orchestra — не оператор чата и не «тот, кто печатает промпты». Это **дирижёр**: управляет ансамблем специализированных агентов, задаёт темп (фазы GSD), вводит инструменты (роли) по мере необходимости, утверждает аккорды (решения) на репетиционных знаках (ADR).

Эта концепция определяет весь UI Conducting Score (см. [UI Canon.md §1](UI%20Canon.md#1-conducting-score--первичный-ui-паттерн)) и поясняется в [Vision 2030.md §Human Governance](Vision%202030.md).

---

## 6. Связь с внешним GSD-циклом (RAI_EP)

Orchestra реализует GSD как **внутренний** конечный автомат системы. Параллельно существует внешний GSD-цикл техлида (например, skill `/gsd` в проекте RAI_EP), который работает над *самой разработкой Orchestra*:

```
Внешний GSD (RAI_EP)         →  PLAN-файл (ТЗ для кодера) → код → review → gate
Внутренний GSD (Orchestra)   →  Discover → Goal → ... → Consensus → Decision
```

Эти два цикла **не смешиваются**: внешний строит Orchestra как продукт, внутренний — работает внутри Orchestra над решениями пользователя. Документы этого репозитория (`docs/`) описывают именно внутренний GSD Orchestra.

### Правила разделения фаз

- Отдельный долг → отдельный PLAN → отдельная фаза внешнего GSD.
- Правки eval-артефактов (`scripts/`) ≠ pipeline/descriptor/kernel-fix — разные зоны ответственности внешнего GSD.
- Никаких fake-green: commit-сообщения и контракты обязаны отражать фактический результат (честный audit trail).

---

## 7. MVP-спринты Orchestra

| Sprint | Содержимое |
|---|---|
| **Sprint 1** | Создание проекта; авторизация; создание сессии; управление ролями; подключение OpenAI |
| **Sprint 2** | Подключение GLM; подключение Gemini; единый Role Router; хранилище истории |
| **Sprint 3** | GSD Engine; управление фазами; Timeline; история раундов |
| **Sprint 4** | Consensus Engine; экспорт Markdown; экспорт ADR; просмотр различий между раундами |
| **Sprint 5** | Подключение MiMo; стриминг ответов; настраиваемые системные промпты; подготовка к публичному релизу |

---

## 8. Дорожная карта Orchestra

### MVP
Ручной запуск ролей; последовательные раунды; GSD Engine; Consensus Engine; экспорт ADR.

### Версия 1.5
Параллельная работа нескольких агентов; автоматическое определение следующей роли; анализ стоимости и токенов; Knowledge Graph.

### Версия 2.0
Автономные цепочки обсуждений; планировщик агентных задач; GitHub-интеграция; автоматическая генерация Pull Request; генерация тестов; генерация документации; поддержка локальных моделей.

### Версия 3.0
Несколько независимых Council; межпроектный граф знаний; самообучающийся Context Service; метрики качества решений; сравнение эффективности различных моделей; корпоративный режим с несколькими пользователями.

Долгосрочное направление развития — в [Vision 2030.md §Дорожная карта 2030+](Vision%202030.md).

---

## 9. Архитектурный принцип GSD

GSD — обязательный жизненный цикл каждой задачи. Он:

- определяет, **какие артефакты** появляются на каждой фазе (§2);
- **блокирует** переход фазы до достаточной уверенности (§3);
- ставит **человека-дирижёра** на каждой контрольной точке (§4);
- **изолирует** внешний цикл разработки Orchestra от внутреннего цикла принятия решений (§6).

Система проектируется как расширяемая операционная среда для коллективной работы человека и специализированных ИИ-агентов, а не как очередной интерфейс для общения с моделями.
