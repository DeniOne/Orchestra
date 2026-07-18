# Agent Protocol

> Роли, их декларативные манифесты, контракты адаптеров LLM, плагин-контракты и правила маршрутизации.
> Смежные: [Architecture.md](Architecture.md) (Role Router), [Context Protocol.md](Context%20Protocol.md) (входной пакет), [Consensus Protocol.md](Consensus%20Protocol.md).

Не существует «главного ИИ». Каждый агент отвечает **только** за свою область компетенции. Все сообщения проходят через единый Role Router, а в конце каждого раунда Consensus Engine формирует итоговое решение.

---

## 1. Роли

### ChatGPT — Chief Architect
**Отвечает за**: архитектуру; системное проектирование; декомпозицию; стратегии; долгосрочные последствия; выявление рисков.
**Никогда не пишет код.**

### GLM — Tech Lead
**Отвечает за**: реализацию; производительность; стек технологий; инфраструктуру; API; базы данных; DevOps.
**Не занимается бизнес-логикой.**

### Gemini — Researcher
**Отвечает за**: исследования; поиск альтернатив; новые технологии; сравнение подходов; best practices.

### Critic — Red Team
**Отвечает за**: поиск ошибок; угрозы; логические противоречия; нарушение SOLID/GSD/архитектурных принципов.
**Критик обязан искать недостатки даже у хороших решений.**

### MiMo — Senior Software Engineer
**Отвечает за**: написание кода; рефакторинг; миграции; тесты; исправление ошибок.
**MiMo не принимает архитектурных решений самостоятельно.**

### Consensus Engine (не LLM)
Отдельный модуль приложения (см. [Consensus Protocol.md](Consensus%20Protocol.md)). Собирает ответы всех ролей; выявляет согласованные решения; фиксирует разногласия; формирует итог; определяет следующий шаг GSD.

---

## 2. Agent Independence

Каждый агент обладает:

- собственной памятью (через изолированный Context Packet);
- собственным контекстом (контекстная политика роли);
- собственными ограничениями (`allowedOutputs`);
- собственной областью ответственности.

**Никакой агент не знает больше необходимого.** Прямой обмен сообщениями между агентами запрещён — всё идёт через Role Router и Context Service (см. [Context Protocol.md §главный инвариант](Context%20Protocol.md#8-архитектурный-принцип)).

---

## 3. Role Manifest

Каждая роль описывается декларативно. **Добавление новой роли не требует изменения кода ядра.**

```yaml
id: architect

displayName: Chief Architect
provider: openai
model: gpt-5.5

responsibilities:
  - architecture
  - strategy
  - decomposition

allowedOutputs:
  - ADR
  - Architecture
  - Review

contextPolicy:
  profile: architect          # ссылка на контекстную политику
  max_tokens: 32000

generation:
  temperature: 0.2
  systemPromptRef: prompts/architect.md
```

### Схема RoleManifest

```typescript
interface RoleManifest {
  id: string;                          // уникальный идентификатор роли
  displayName: string;
  provider: string;                    // id AIProvider из реестра
  model: string;

  responsibilities: string[];          // области компетенции
  allowedOutputs: OutputType[];        // ADR | Architecture | Review | Code | ...

  contextPolicy: {
    profile: string;                   // ссылка на политику в Context Service
    max_tokens: number;
  };

  generation: {
    temperature: number;
    systemPromptRef: string;           // путь в Prompt Registry
  };

  // опционально: ограничения фаз GSD, в которых роль активна
  activePhases?: GSDPhase[];
}
```

---

## 4. Message Router

Role Router — единая точка диспетчеризации. Любое сообщение, идущее к агенту или от него, проходит через него.

Структура сообщения:

```yaml
Round:
Author:        # роль-отправитель (или Conductor)
Recipient:     # роль-адресат
Phase:         # текущая фаза GSD
Priority:
Dependencies:  # какие ответы должны быть получены раньше
Prompt:        # системный промпт (из Prompt Registry)
Context:       # ContextPacket (из Context Service)
Response:      # заполняется после ответа провайдера
```

### Правила маршрутизации

1. Сообщение без валидного Context Packet **отклоняется**.
2. Роль может быть адресатом только в фазах из своего `activePhases` (если задано).
3. `Dependencies` определяют частичный порядок ответов в рамках раунда.
4. Результат агента возвращается в Role Router, **не** напрямую другому агенту.
5. Critic получает изолированный контекст — без доступа к чужим критическим замечаниям (см. [Context Protocol.md §политики](Context%20Protocol.md#5-контекстные-политики)).

---

## 5. Prompt Registry

Для каждой роли существует отдельный системный промпт.

```
/prompts
  architect.md
  tech_lead.md
  critic.md
  researcher.md
  engineer.md
```

**Редактирование промптов производится без перекомпиляции приложения** (hot-reload). Версия промпта фиксируется в каждом Context Packet для воспроизводимости.

---

## 6. Интеграции (адаптерная модель)

Первая версия поддерживает адаптерную модель. **Добавление нового провайдера не требует изменения ядра.**

Поддерживаемые провайдеры MVP:

- OpenAI (ChatGPT)
- GLM (Z.AI)
- Gemini (Google)
- MiMo (подключается через такой же адаптер)

---

## 7. AI Provider SDK

Все модели подключаются одинаково. Это позволяет заменить OpenAI на локальную модель без изменения бизнес-логики.

```typescript
interface AIProvider {
  send(packet: ContextPacket): Promise<Response>;
  stream(packet: ContextPacket): AsyncIterable<Token>;
  cancel(requestId: string): Promise<void>;
  estimateTokens(packet: ContextPacket): Promise<number>;
  estimateCost(packet: ContextPacket): Promise<number>;
  health(): Promise<ProviderHealth>;
}

interface ProviderHealth {
  status: 'up' | 'degraded' | 'down';
  latencyMs: number;
  rateLimitRemaining?: number;
}
```

| Метод | Назначение |
|---|---|
| `send` | Синхронный полный ответ |
| `stream` | Потоковая генерация токенов (обязательно для UX Conducting Score) |
| `cancel` | Остановка ответа любого агента (требование нефункциональных требований) |
| `estimateTokens` / `estimateCost` | Бюджетный предикт до отправки |
| `health` | Проверка доступности провайдера |

---

## 8. Plugin SDK

Любой компонент подключается как плагин. Полная точка расширения Orchestra.

### Типы плагинов

| Тип | Что расширяет |
|---|---|
| `AI Provider` | Новый LLM-провайдер (включая локальные) |
| `Context Provider` | Новый источник знаний для Knowledge Graph |
| `Consensus Strategy` | Альтернативный алгоритм кластеризации/оценки уверенности |
| `Knowledge Extractor` | Парсер артефактов в узлы графа |
| `Exporter` | Новый формат экспорта (Markdown, PDF, JSON, ADR, Session Archive) |
| `Reviewer` | Дополнительный критический анализ |
| `Notification Provider` | Каналы уведомлений |
| `GSD Phase Extension` | Кастомные фазы жизненного цикла |

### Контракт Plugin

```typescript
interface Plugin {
  id: string;
  name: string;
  version: string;
  type: PluginType;                     // один из типов выше

  initialize(): Promise<void>;
  dispose(): Promise<void>;
}

interface AIProviderPlugin extends Plugin {
  type: 'AI Provider';
  provider: AIProvider;                 // реализация контракта из §7
}
```

Жизненный цикл: `initialize()` при старте Orchestra → регистрация в реестре плагинов → `dispose()` при остановке. События регистрации публикуются на Event Bus (см. [Architecture.md §Event Bus](Architecture.md#5-event-bus)).

---

## 9. Главный принцип

Роли в Orchestra — это **не** конкретные модели и **не** фиксированный набор. Это декларативные манифесты с явной областью компетенции, собственной контекстной политикой и контрактом вывода. Модели взаимозаменяемы (через `AIProvider`), роли расширяемы (через Role Manifest), всё остальное — плагины. Ядро не меняется при добавлении ни роли, ни провайдера, ни стратегии консенсуса.
