# 🎼 Orchestra

> **Models are replaceable. Process is permanent.**
> Orchestra — операционная система инженерного мышления, а не интерфейс к языковым моделям.

Orchestra — это операционная среда для принятия инженерных решений, в которой человек и специализированные ИИ-агенты совместно проектируют, анализируют, реализуют и сопровождают сложные системы. Главной единицей работы является **не сообщение, а инженерное решение**.

Это **не** мультичат и **не** оболочка над несколькими LLM. Это платформа, где:

- **GSD** определяет жизненный цикл разработки;
- **Knowledge Graph** хранит знания проекта;
- **Context Service** доставляет каждой роли только необходимую информацию;
- **Role Router** обеспечивает независимость агентов;
- **Consensus Engine** превращает экспертную дискуссию в формализованные инженерные решения;
- **Decision Repository** сохраняет результаты в виде воспроизводимых артефактов;
- **Conducting Score** делает всё это видимым для дирижёра как партитура, а не как чат.

> 🚧 **Статус:** активная стадия проектирования и MVP-разработки. Репозиторий сейчас содержит документацию уровня open-source проекта. Код в `apps/`/`packages/` — roadmap (см. ниже).

---

## Что решает Orchestra

Сегодня большинство IDE помогают писать код. **Orchestra помогает принимать правильные инженерные решения.**

Объектами системы являются: требования, архитектурные решения, гипотезы, исследования, спецификации, ADR, задачи, риски, знания проекта. Сообщения — лишь транспортный механизм.

---

## Документация

Полная документация в [`docs/`](docs/). Каждый документ отвечает на один вопрос:

| Документ | Отвечает на вопрос |
|---|---|
| [docs/Vision 2030.md](docs/Vision%202030.md) | **Зачем?** Идеология, философия, направление развития |
| [docs/Architecture.md](docs/Architecture.md) | **Как устроено?** C4-диаграммы, компоненты, Event Bus, Knowledge Graph |
| [docs/Orchestra_TC.md](docs/Orchestra_TC.md) | **Что реализовать?** Исполняемое ТЗ для кодера |
| [docs/GSD Integration.md](docs/GSD%20Integration.md) | **Как проходит жизненный цикл?** Фазы, артефакты, gating, роль дирижёра |
| [docs/Context Protocol.md](docs/Context%20Protocol.md) | **Как доставляется контекст?** Context Packet, Memory Layers, компрессия |
| [docs/Consensus Protocol.md](docs/Consensus%20Protocol.md) | **Как формируется решение?** Алгоритм, Decision Confidence, gating |
| [docs/Agent Protocol.md](docs/Agent%20Protocol.md) | **Как взаимодействуют роли?** Манифесты, контракты адаптеров, Plugin SDK |
| [docs/UI Canon.md](docs/UI%20Canon.md) | **Как выглядит интерфейс?** Conducting Score, layout, Confidence UI |

---

## Философия (кратко)

1. **Models are replaceable. Process is permanent.** — Модели приходят и уходят; постоянен только процесс.
2. **Context over Conversation.** — Качество решения определяет контекст, а не длина переписки.
3. **Knowledge over Messages.** — Ценность в графе знаний, сообщения — лишь транспорт.
4. **Engineering over Chat.** — Среда инженерного мышления, а не ещё один мессенджер с ИИ.

Полностью — в [docs/Vision 2030.md §Философия](docs/Vision%202030.md).

---

## Целевая структура репозитория (roadmap layout)

Физически сейчас реализована только папка `docs/`. Ниже — план структуры, к которой проект будет приводиться по мере разработки:

```text
orchestra/
├── README.md                     ✅
├── LICENSE                       ✅   Apache 2.0
├── CONTRIBUTING.md               ✅
├── docs/                         ✅   вся инженерная документация
│   ├── Vision 2030.md            ✅
│   ├── Architecture.md           ✅
│   ├── Orchestra_TC.md           ✅
│   ├── GSD Integration.md        ✅
│   ├── Context Protocol.md       ✅
│   ├── Consensus Protocol.md     ✅
│   ├── Agent Protocol.md         ✅
│   ├── UI Canon.md               ✅
│   └── ADR/                      ⏳   Architecture Decision Records (по мере роста)
├── apps/                         ⏳   приложения (web, api)
├── packages/                     ⏳   переиспользуемые пакеты (gsd-engine, context-service, ...)
├── examples/                     ⏳   примеры плагинов и ролей
└── prompts/                      ⏳   системные промпты ролей (architect.md, critic.md, ...)
```

Легенда: ✅ существует, ⏳ roadmap.

---

## Quick start

MVP в активной разработке. Чтобы понять систему, начните с:

1. [docs/Vision 2030.md](docs/Vision%202030.md) — «зачем».
2. [docs/Architecture.md](docs/Architecture.md) — «как устроено».
3. [docs/Orchestra_TC.md](docs/Orchestra_TC.md) — «что реализовать».

Как только появится код — сюда будет добавлена инструкция по запуску (`pnpm install`, `docker compose up`, и т.д.).

---

## Участие в разработке

См. [CONTRIBUTING.md](CONTRIBUTING.md). Документация — на русском языке, стиль существующих документов в `docs/`.

---

## Лицензия

[Apache License 2.0](LICENSE).
