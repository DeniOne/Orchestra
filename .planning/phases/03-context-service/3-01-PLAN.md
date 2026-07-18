---
phase: 03-context-service
plan: "01"
slice: 03-01
type: execute
wave: 3
depends_on:
  - phase-02-knowledge-graph
requirements:
  - ORCH-03-01   # Context Packet Builder извлекает подграф из KG
  - ORCH-03-02   # Context Service как NestJS-модуль
  - ORCH-03-03   # Prompt Registry (минимальный FS-ридер)
  - ORCH-03-04   # закрытие долгов D-A1, D-B3 (build hygiene)
closes_debts:
  - D-A1   # apps/api tsconfig rootDir — нормализация nest build output
  - D-B3   # apps/web/tsconfig.tsbuildinfo tracked — .gitignore + git rm --cached
autonomous: true
files_modified:
  - apps/api/package.json
  - apps/api/tsconfig.json                  # долг D-A1: + rootDir
  - apps/api/src/app.module.ts
  - .gitignore                              # долг D-B3: + *.tsbuildinfo
files_created:
  - packages/context-service/package.json
  - packages/context-service/tsconfig.json
  - packages/context-service/src/index.ts
  - packages/context-service/src/types.ts
  - packages/context-service/src/subgraph-extractor.ts
  - packages/context-service/src/context-policy.ts
  - packages/context-service/src/packet-builder.ts
  - packages/prompt-registry/package.json
  - packages/prompt-registry/tsconfig.json
  - packages/prompt-registry/src/index.ts
  - packages/prompt-registry/src/prompt-registry.ts
  - apps/api/src/context/context.module.ts
  - apps/api/src/context/context.service.ts
  - apps/api/src/prompts/prompts.module.ts
  - apps/api/src/prompts/prompts.service.ts
  - prompts/architect.md
  - prompts/tech_lead.md
  - prompts/researcher.md
  - prompts/critic.md
  - prompts/engineer.md
must_haves:
  truths:
    - "D-01: packages/context-service/src/subgraph-extractor.ts реализует алгоритм извлечения подграфа из Context Protocol.md §4 (BFS от objective-узла по depends_on/implements/references на глубину k, роль-специфичную) — использует KgNodeData/KgRelationshipData из @orchestra/domain, НЕ зависит от Prisma напрямую"
    - "D-02: packages/context-service/src/context-policy.ts реализует ContextPolicy (include/exclude по NodeType, max_tokens) — контракт из Context Protocol.md §5. Дефолтные политики для 5 ролей (architect/tech_lead/researcher/critic/engineer)"
    - "D-03: packages/context-service/src/packet-builder.ts собирает ContextPacket (все 18 полей из domain/context.ts), применяя политику роли к извлечённому подграфу. Возвращает доменный ContextPacket, не Prisma-DTO"
    - "D-04: ContextPolicy применяет include/exclude фильтрацию узлов по NodeType ДО токен-бюджетного отсева (порядок §4 алгоритма: шаг 4 политики → шаг 5 budget)"
    - "D-05: packages/prompt-registry — автономный пакет, читает .md-файлы из каталога prompts/ (FS). Метод getPrompt(roleId): Promise<string>. Версия промпта = sha256 содержимого (для contentHash воспроизводимости). НЕ зависит от NestJS"
    - "D-06: Prompt Registry hot-reload — ОТСУТСТВУЕТ в этой фазе (заглушка: чтение при вызове). Полный hot-reload+FS-watcher — будущая фаза. Это явно зафиксировано в SUMMARY кодера"
    - "D-07: apps/api/src/context/ — ContextModule + ContextService (NestJS), оркестрирует: subgraph-extractor → context-policy → prompt-registry → packet-builder. AppModule imports ContextModule"
    - "D-08: 5 файлов prompts/*.md существуют (architect, tech_lead, researcher, critic, engineer) — минимальное тело системного промпта для каждой роли (1-3 абзаца, описание роли из Agent Protocol.md §1)"
    - "D-09: ДОЛГ D-A1 ЗАКРЫТ — apps/api/tsconfig.json содержит rootDir: \"./src\". Проверка: после `pnpm --filter @orchestra/api build` файл apps/api/dist/main.js существует по прямому пути (НЕ dist/apps/api/src/main.js)"
    - "D-10: ДОЛГ D-B3 ЗАКРЫТ — .gitignore содержит строку '*.tsbuildinfo'. apps/web/tsconfig.tsbuildinfo удалён из git-индекса (git rm --cached). git status больше не показывает его как modified"
    - "D-11: pnpm -r typecheck зелёный во всех пакетах (domain, knowledge-graph, context-service, prompt-registry, api, web)"
    - "D-12: pnpm --filter @orchestra/context-service build компилируется"
    - "D-13: pnpm --filter @orchestra/prompt-registry build компилируется"
    - "D-14: pnpm --filter @orchestra/api build компилируется с ContextModule + PromptsModule"
  artifacts:
    - path: packages/context-service/src/packet-builder.ts
      provides: ContextPacketBuilder — сборка ContextPacket из подграфа KG + политики роли
    - path: packages/context-service/src/subgraph-extractor.ts
      provides: Алгоритм извлечения релевантного подграфа (Context Protocol §4)
    - path: packages/prompt-registry/src/prompt-registry.ts
      provides: FS-ридер системных промптов ролей с версионированием (sha256)
    - path: apps/api/src/context/context.service.ts
      provides: NestJS ContextService — оркестрация pipeline сборки пакета
    - path: prompts/*.md
      provides: 5 дефолтных системных промптов ролей
  key_links:
    - from: packages/context-service/src/packet-builder.ts
      to: packages/domain/src/context.ts
      via: import type ContextPacket, MemoryLayer, Constraint, OutputSpec
      pattern: builder потребляет доменные типы, отдаёт доменный пакет
    - from: packages/context-service/src/subgraph-extractor.ts
      to: packages/domain/src/kg.ts
      via: import type KgNodeData, KgRelationshipData, KgNodeType
      pattern: extractor оперирует доменными типами графа, не Prisma
    - from: apps/api/src/context/context.service.ts
      to: packages/knowledge-graph (KgService)
      via: KgService.getNeighbors() — источник графа для extractor'а
      pattern: NestJS service → KgService → Prisma (Prisma изолирован в kg)
    - from: apps/api/src/context/context.service.ts
      to: packages/prompt-registry
      via: PromptRegistry.getPrompt(roleId) — источник systemPrompt
      pattern: NestJS service → PromptRegistry → FS
---

# Plan 03-01 — Context Service: Packet Builder + Subgraph Extractor + Prompt Registry (Wave 3)

**Phase:** 03 — context-service
**Wave:** B-3
**Author (Tech Lead):** @zcode-assistant
**Coder:** mimo (через `/gsd-execute-phase 3`)

## Контекст (почему эта фаза)

Phase 2 заложила data layer Knowledge Graph (Prisma-схема `KgNode`/`KgRelationship`, доменные типы в `@orchestra/domain`, `KgService` с CRUD). Но KG сам по себе — только хранилище. Чтобы Orchestra функционировала, нужен **Context Service** — центральный инвариант системы (`Context Protocol.md §8`): ни один агент не получает полную историю, каждый получает специализированный **Context Packet**.

Context Protocol §1 определяет pipeline: `Knowledge Graph → Builder → Memory Layers overlay → Compression → Packet → Role Router → Provider`. Эта фаза реализует **первые 4 узла** (KG → Builder → Memory overlay → Compression → Packet) — то есть ядро Context Service. Role Router и Provider — Wave 4.

Архитектурно Context Service — отдельный **контейнер** (`Architecture.md §3`), зависящий от:
- Knowledge Graph (готов — Phase 2)
- Prompt Registry (отдельный контейнер — создаётся в этой фазе в **минимальном** виде)

**Scope этой фазы (что входит):**
1. `packages/context-service` — новый пакет: алгоритм извлечения подграфа, контекстные политики, сборка ContextPacket.
2. `packages/prompt-registry` — новый пакет: FS-ридер `.md`-промптов, версионирование через sha256. **Без** hot-reload (заглушка — чтение при вызове).
3. `prompts/*.md` — 5 дефолтных системных промптов ролей.
4. `apps/api/src/context/` + `apps/api/src/prompts/` — NestJS-модули-обёртки.
5. **Закрытие долгов D-A1 + D-B3** (build hygiene, обещаны в README Phase 2).

**Scope этой фазы (что НЕ входит — забор на Wave 4+):**
- Полный hot-reload Prompt Registry (FS-watcher, инвалидация кэша) → будущая фаза.
- Token-budget Compression с реальным токенайзером (tiktoken/и т.п.) → заглушка (char-count аппроксимация), полная реализация — Wave 4.
- Role Router, Provider adapters (OpenAI/GLM/Gemini/MiMo) → Wave 4.
- Event Bus publishing (`ContextPacketBuilt` событие) → Wave 5 (с Event Bus).
- Decision Repository → Wave 5.
- Memory Layers overlay с реальной персистенцией → Wave 4 (сейчас — in-memory классификация узлов по Layer 1-5).

## Что делает кодер (пофайлово)

### 1. `packages/context-service/` — новый пакет (ядро Context Service)

**Назначение:** автономный пакет с логикой сборки ContextPacket. Не зависит от NestJS, не зависит от Prisma. Оперирует доменными типами из `@orchestra/domain`.

#### 1a. `packages/context-service/package.json` (новый)

```json
{
  "name": "@orchestra/context-service",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@orchestra/domain": "workspace:*"
  },
  "devDependencies": {
    "typescript": "~5.6"
  }
}
```

#### 1b. `packages/context-service/tsconfig.json` (новый)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

#### 1c. `packages/context-service/src/types.ts` (новый)

Доменные типы для работы Context Service (без Prisma, без NestJS):

```typescript
import type {
  KgNodeType,
  KgNodeData,
  KgRelationshipData,
  ContextPacket,
  Constraint,
  OutputSpec,
} from '@orchestra/domain';

/** Роль-специфичная контекстная политика. См. Context Protocol.md §5. */
export interface ContextPolicy {
  roleId: string;
  /** NodeType, которые включаются в пакет. */
  include: KgNodeType[];
  /** NodeType, которые исключаются (имеет приоритет над include). */
  exclude: KgNodeType[];
  /** Максимум токенов (аппроксимация — символов / 4). */
  maxTokens: number;
  /** Глубина BFS-извлечения подграфа (роль-специфичная). */
  subgraphDepth: number;
}

/** Запрос на сборку ContextPacket. */
export interface BuildPacketRequest {
  sessionId: string;
  projectId: string;
  roundId: string;
  roleId: string;
  objective: string;
  /** Стартовый узел objective в KG (id). Если null — extraction стартует от objective-строки. */
  objectiveNodeId?: string;
  phase: import('@orchestra/domain').GSDPhase;
}

/** Источник данных графа — абстракция, чтобы context-service не зависел от Prisma/KgService. */
export interface KgGraphPort {
  getNode(id: string): Promise<KgNodeData | null>;
  getNeighbors(nodeId: string, direction?: 'in' | 'out' | 'both'): Promise<KgNodeData[]>;
  listNodes(type?: KgNodeType): Promise<KgNodeData[]>;
}

/** Источник системного промпта — абстракция, чтобы context-service не зависел от FS/PromptRegistry. */
export interface PromptPort {
  getPrompt(roleId: string): Promise<{ content: string; version: string }>;
}

export type {
  KgNodeType,
  KgNodeData,
  KgRelationshipData,
  ContextPacket,
  Constraint,
  OutputSpec,
};
```

**Ключевая архитектурная мысль:** `KgGraphPort` и `PromptPort` — **порты** (hexagonal). Пакет `context-service` определяет интерфейсы, а `apps/api` подключает адаптеры (KgService → KgGraphPort, PromptRegistry → PromptPort). Это сохраняет чистоту пакета: его можно тестировать без БД и без FS.

#### 1d. `packages/context-service/src/context-policy.ts` (новый)

Дефолтные политики для 5 ролей + функция применения политики к узлам.

```typescript
import type { KgNodeData, KgNodeType } from '@orchestra/domain';
import type { ContextPolicy } from './types.js';

/** Дефолтные политики ролей. См. Context Protocol.md §5 «Правила формирования по ролям». */
export const DEFAULT_POLICIES: Record<string, ContextPolicy> = {
  // ChatGPT — Chief Architect
  architect: {
    roleId: 'architect',
    include: ['Goal', 'Requirement', 'Architecture', 'ADR', 'Decision', 'Risk'],
    exclude: ['Code', 'Repository'],
    maxTokens: 32000,
    subgraphDepth: 3,
  },
  // GLM — Tech Lead
  tech_lead: {
    roleId: 'tech_lead',
    include: ['Requirement', 'Architecture', 'API', 'Module', 'Entity', 'Service', 'Risk'],
    exclude: ['Research', 'Documentation'],
    maxTokens: 32000,
    subgraphDepth: 2,
  },
  // Gemini — Researcher
  researcher: {
    roleId: 'researcher',
    include: ['Research', 'Requirement', 'Risk', 'Decision'],
    exclude: ['Code', 'Repository', 'Test'],
    maxTokens: 24000,
    subgraphDepth: 3,
  },
  // Critic — Red Team (получает conflicts_with — см. §4 алгоритм шаг 3)
  critic: {
    roleId: 'critic',
    include: ['Goal', 'Requirement', 'Architecture', 'ADR', 'Decision', 'Risk'],
    exclude: [],
    maxTokens: 24000,
    subgraphDepth: 2,
  },
  // MiMo — Senior Software Engineer
  engineer: {
    roleId: 'engineer',
    include: ['Architecture', 'API', 'Module', 'Entity', 'Task', 'Code', 'Test'],
    exclude: ['Research'],
    maxTokens: 32000,
    subgraphDepth: 2,
  },
};

/**
 * Применяет политику к списку узлов: include/exclude по NodeType.
 * Порядок: exclude имеет приоритет (фильтрация первым), затем include.
 * См. Context Protocol.md §4 (шаг 4 алгоритма извлечения).
 */
export function applyPolicy(
  nodes: KgNodeData[],
  policy: ContextPolicy,
): KgNodeData[] {
  return nodes.filter((node) => {
    if (policy.exclude.length > 0 && policy.exclude.includes(node.type)) {
      return false;
    }
    if (policy.include.length === 0) return true;
    return policy.include.includes(node.type);
  });
}

export function getPolicy(roleId: string): ContextPolicy {
  return DEFAULT_POLICIES[roleId] ?? DEFAULT_POLICIES.architect;
}
```

#### 1e. `packages/context-service/src/subgraph-extractor.ts` (новый)

Алгоритм извлечения подграфа из `Context Protocol.md §4`:
1. Старт от objective-узла.
2. BFS-расширение по `depends_on`, `implements`, `references` на глубину `k`.
3. (role=critic) Включение узлов, помеченных `conflicts_with`.

```typescript
import type { KgNodeData } from '@orchestra/domain';
import type { KgGraphPort, ContextPolicy } from './types.js';

/**
 * Извлекает релевантный подграф из Knowledge Graph.
 * Алгоритм: Context Protocol.md §4.
 *
 * @param graph — порт к KG (адаптер KgService в apps/api)
 * @param startNodeId — id стартового узла (objective)
 * @param policy — контекстная политика роли (определяет глубину k)
 * @returns массив узлов подграфа (без дубликатов)
 */
export async function extractSubgraph(
  graph: KgGraphPort,
  startNodeId: string,
  policy: ContextPolicy,
): Promise<KgNodeData[]> {
  const visited = new Set<string>();
  const result: KgNodeData[] = [];
  // BFS
  let frontier: string[] = [startNodeId];
  const maxDepth = policy.subgraphDepth;

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    // Обрабатываем узлы пачкой: соседи каждого узла текущего фронта
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = await graph.getNode(nodeId);
      if (node) result.push(node);

      // Расширение по обоим направлениям (depends_on/implements/references —
      // фильтрация по типу отношений не требуется на уровне узлов: KgGraphPort
      // отдаёт всех соседей, фильтрация по NodeType делает applyPolicy позже).
      const neighbors = await graph.getNeighbors(nodeId, 'both');
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          nextFrontier.push(neighbor.id);
        }
      }
    }
    frontier = nextFrontier;
  }

  return result;
}
```

**Важно для кодера:** `KgGraphPort.getNeighbors` не фильтрует по типу отношения (KgService отдаёт всех соседей). Это намеренно: фильтрация по `RelationshipType` (только `depends_on`/`implements`/`references`) — улучшение Wave 4, когда KgService получит метод с фильтром. В этой фазе extractSubgraph берёт всех соседей и полагается на `applyPolicy` (фильтрация по NodeType) для отсева. Зафиксировать в SUMMARY как допущение.

#### 1f. `packages/context-service/src/packet-builder.ts` (новый)

Сборка `ContextPacket` (все 18 полей из `domain/context.ts`).

```typescript
import type {
  ContextPacket,
  KgNodeData,
  ISO8601,
} from '@orchestra/domain';
import type {
  BuildPacketRequest,
  ContextPolicy,
  KgGraphPort,
  PromptPort,
} from './types.js';
import { extractSubgraph } from './subgraph-extractor.js';
import { applyPolicy, getPolicy } from './context-policy.js';

/**
 * Собирает ContextPacket для роли по запросу.
 * Pipeline: extractSubgraph → applyPolicy → budget cutoff → assemble.
 * См. Context Protocol.md §1, §4.
 */
export async function buildPacket(
  req: BuildPacketRequest,
  graph: KgGraphPort,
  prompts: PromptPort,
): Promise<ContextPacket> {
  const policy = getPolicy(req.roleId);
  const startNode = req.objectiveNodeId;
  if (!startNode) {
    throw new Error(
      'packet-builder: objectiveNodeId is required (objective-string lookup not implemented in this phase)',
    );
  }

  // Шаг 1-3: извлечение подграфа из KG
  const subgraph = await extractSubgraph(graph, startNode, policy);

  // Шаг 4: применение контекстной политики (include/exclude по NodeType)
  const filtered = applyPolicy(subgraph, policy);

  // Шаг 5: токен-бюджетный отсев (аппроксимация: chars/4 ≈ tokens).
  // Полная реализация с tiktoken — Wave 4.
  const budgeted = applyTokenBudget(filtered, policy.maxTokens);

  // Сборка полей пакета из узлов подграфа
  const fields = collectPacketFields(budgeted);

  // Загрузка системного промпта
  const prompt = await prompts.getPrompt(req.roleId);

  const builtAt: ISO8601 = new Date().toISOString();
  const modelTarget = resolveModelTarget(req.roleId);

  const packet: ContextPacket = {
    sessionId: req.sessionId,
    projectId: req.projectId,
    roundId: req.roundId,
    phase: req.phase,
    role: { id: req.roleId, displayName: req.roleId, responsibilities: [] },
    objective: req.objective,
    relevantDecisions: fields.decisions,
    openQuestions: fields.questions,
    knownRisks: fields.risks,
    constraints: fields.constraints,
    artifacts: fields.artifacts,
    conversationSummary: '',
    systemPrompt: prompt.content,
    expectedOutput: { type: 'Review' },
    outputFormat: 'markdown',
    builtAt,
    modelTarget,
    contextPolicyId: `${policy.roleId}@v1`,
    contentHash: '', // вычисляется ниже
  };

  // contentHash = sha256 сериализованного пакета (без самого contentHash).
  // Используем Web Crypto (доступен в Node 20). См. Context Protocol.md §7.
  packet.contentHash = await computeContentHash(packet);
  return packet;
}

/** Aппроксимация токенов: 1 token ≈ 4 char. Отбрасывает хвост узлов при превышении. */
function applyTokenBudget(nodes: KgNodeData[], maxTokens: number): KgNodeData[] {
  const maxChars = maxTokens * 4;
  let used = 0;
  const out: KgNodeData[] = [];
  for (const node of nodes) {
    const nodeChars = estimateNodeChars(node);
    if (used + nodeChars > maxChars) break;
    out.push(node);
    used += nodeChars;
  }
  return out;
}

function estimateNodeChars(node: KgNodeData): number {
  return (node.title.length + (node.description?.length ?? 0));
}

/** Распределяет узлы по полям пакета по NodeType. */
function collectPacketFields(nodes: KgNodeData[]): {
  decisions: { id: string; version: string }[];
  questions: { id: string }[];
  risks: { id: string }[];
  constraints: { id: string; description: string; source?: string }[];
  artifacts: { id: string; type: string; version: string }[];
} {
  const decisions: { id: string; version: string }[] = [];
  const questions: { id: string }[] = [];
  const risks: { id: string }[] = [];
  const constraints: { id: string; description: string; source?: string }[] = [];
  const artifacts: { id: string; type: string; version: string }[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'Decision':
      case 'ADR':
        decisions.push({ id: node.id, version: node.updatedAt });
        break;
      case 'Risk':
        risks.push({ id: node.id });
        break;
      case 'Requirement':
        constraints.push({
          id: node.id,
          description: node.title,
          source: node.description ?? undefined,
        });
        break;
      case 'API':
      case 'Module':
      case 'Entity':
      case 'Architecture':
      case 'Code':
      case 'Research':
        artifacts.push({
          id: node.id,
          type: node.type,
          version: node.updatedAt,
        });
        break;
      // Goal/Service/Test/Task/Repository/Documentation/Decision — общий контекст
    }
  }
  return { decisions, questions, risks, constraints, artifacts };
}

async function computeContentHash(packet: ContextPacket): Promise<string> {
  const { contentHash: _omit, ...rest } = packet;
  const serialized = JSON.stringify(rest);
  // Web Crypto API (Node 20+ global crypto).
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Дефолтные model-target по roleId. Реальный manifest — Wave 4 (Role Router). */
function resolveModelTarget(roleId: string): string {
  const map: Record<string, string> = {
    architect: 'gpt-5.5',
    tech_lead: 'glm',
    researcher: 'gemini',
    critic: 'gpt-5.5',
    engineer: 'mimo',
  };
  return map[roleId] ?? 'unknown';
}
```

#### 1g. `packages/context-service/src/index.ts` (новый)

Barrel export.

```typescript
export * from './types.js';
export { extractSubgraph } from './subgraph-extractor.js';
export { applyPolicy, getPolicy, DEFAULT_POLICIES } from './context-policy.js';
export { buildPacket } from './packet-builder.js';
```

### 2. `packages/prompt-registry/` — новый пакет (минимальный FS-ридер промптов)

**Назначение:** чтение системных промптов ролей из каталога `prompts/*.md`. Версия промпта = sha256 содержимого (для воспроизводимости ContextPacket — `Context Protocol.md §7`).

#### 2a. `packages/prompt-registry/package.json` (новый)

```json
{
  "name": "@orchestra/prompt-registry",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "~5.6"
  }
}
```

#### 2b. `packages/prompt-registry/tsconfig.json` (новый)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

#### 2c. `packages/prompt-registry/src/prompt-registry.ts` (новый)

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Минимальный реестр системных промптов: читает .md из каталога.
 * Версия промпта = sha256 содержимого.
 *
 * НЕ РЕАЛИЗОВАНО в этой фазе (явная заглушка):
 *  - hot-reload (FS-watcher, инвалидация кэша) → будущая фаза
 *  - кэширование в памяти → будущая фаза (сейчас read-per-call)
 *
 * См. docs/Agent Protocol.md §5, docs/Orchestra_TC.md §14.
 */
export class PromptRegistry {
  constructor(private readonly promptsDir: string) {}

  /**
   * Читает системный промпт для роли.
   * @param roleId — architect | tech_lead | researcher | critic | engineer
   * @returns { content, version } — version = sha256(content)
   */
  async getPrompt(roleId: string): Promise<{ content: string; version: string }> {
    const filePath = join(this.promptsDir, `${roleId}.md`);
    const content = await readFile(filePath, 'utf8');
    const version = await sha256(content);
    return { content, version };
  }
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

#### 2d. `packages/prompt-registry/src/index.ts` (новый)

```typescript
export { PromptRegistry } from './prompt-registry.js';
```

### 3. `prompts/*.md` — 5 дефолтных системных промптов (новые)

Каталог в корне проекта (`prompts/`). Каждый файл — 1-3 абзаца: описание роли, её ответственность (из `Agent Protocol.md §1`), ограничения вывода. **Минимальное тело** — не финальные промпты, а seed-версии для проверки pipeline.

#### 3a. `prompts/architect.md`

```markdown
# Chief Architect (ChatGPT)

You are the Chief Architect of the Orchestra system. You are responsible for architecture, system design, decomposition, long-term consequences, and risk identification.

You **never write code**. Your output is architectural: ADRs, decomposition proposals, risk assessments.

Focus on: system invariants, architectural decisions, trade-offs, long-term sustainability. Reject short-term hacks that compromise the architecture.
```

#### 3b. `prompts/tech_lead.md`

```markdown
# Tech Lead (GLM)

You are the Tech Lead of the Orchestra system. You are responsible for implementation, performance, technology stack, infrastructure, APIs, databases, and DevOps.

You do **not** handle business logic. Your output is technical: stack choices, API contracts, data models, performance constraints, deployment topology.

Focus on: feasibility, performance, operational concerns, concrete technical specifications that a Senior Engineer (MiMo) can implement.
```

#### 3c. `prompts/researcher.md`

```markdown
# Researcher (Gemini)

You are the Researcher of the Orchestra system. You explore alternatives, evaluate new technologies, compare approaches, and surface best practices.

Your output is research: comparison matrices, trade-off analyses, evidence-based recommendations with citations.

Focus on: breadth of options, evaluation criteria, objective comparison. Do not commit to a single solution — present the decision space.
```

#### 3d. `prompts/critic.md`

```markdown
# Critic / Red Team

You are the Critic of the Orchestra system. You search for errors, threats, logical contradictions, and violations of SOLID/GSD/architectural principles.

You **must** seek flaws even in good solutions. You operate in isolation — you do not see other critics' remarks, to preserve independence of analysis.

Focus on: failure modes, edge cases, hidden assumptions, principle violations. Your value is in what others missed.
```

#### 3e. `prompts/engineer.md`

```markdown
# Senior Software Engineer (MiMo)

You are the Senior Software Engineer of the Orchestra system. You write code, refactor, migrate, test, and fix bugs.

You do **not** make architectural decisions autonomously. You implement approved architecture and technical specifications.

Focus on: correctness, testability, maintainability, adherence to the provided specification and coding standards. Surface implementation blockers — do not silently work around them.
```

### 4. `apps/api/src/context/` — NestJS ContextModule + ContextService

#### 4a. `apps/api/src/context/context.service.ts` (новый)

Оркестрирует pipeline: subgraph-extractor → context-policy → prompt-registry → packet-builder.
Реализует `KgGraphPort` и `PromptPort` как адаптеры к существующим сервисам.

```typescript
import { Injectable } from '@nestjs/common';
import { KgService } from '../kg/kg.service.js';
import { PromptService } from '../prompts/prompts.service.js';
import {
  buildPacket,
  type KgGraphPort,
  type PromptPort,
  type BuildPacketRequest,
} from '@orchestra/context-service';
import type { ContextPacket } from '@orchestra/domain';

/**
 * Адаптер KgService → KgGraphPort.
 * Context-service пакет не знает о Prisma; этот адаптер транслирует вызовы.
 */
@Injectable()
class KgGraphAdapter implements KgGraphPort {
  constructor(private readonly kg: KgService) {}
  async getNode(id: string) {
    return this.kg.getNode(id);
  }
  async getNeighbors(nodeId: string, direction?: 'in' | 'out' | 'both') {
    return this.kg.getNeighbors(nodeId, direction);
  }
  async listNodes(type?: import('@orchestra/domain').KgNodeType) {
    return this.kg.listNodes(type);
  }
}

/**
 * Адаптер PromptService → PromptPort.
 */
@Injectable()
class PromptAdapter implements PromptPort {
  constructor(private readonly prompts: PromptService) {}
  async getPrompt(roleId: string) {
    return this.prompts.getPrompt(roleId);
  }
}

@Injectable()
export class ContextService {
  private readonly graph: KgGraphAdapter;
  private readonly prompts: PromptAdapter;

  constructor(
    private readonly kg: KgService,
    private readonly promptService: PromptService,
  ) {
    this.graph = new KgGraphAdapter(this.kg);
    this.prompts = new PromptAdapter(this.promptService);
  }

  /**
   * Собирает ContextPacket для роли.
   * Pipeline: KG → extractSubgraph → applyPolicy → budget → assemble.
   */
  async buildPacket(req: BuildPacketRequest): Promise<ContextPacket> {
    return buildPacket(req, this.graph, this.prompts);
  }
}
```

#### 4b. `apps/api/src/context/context.module.ts` (новый)

```typescript
import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { PromptsModule } from '../prompts/prompts.module.js';
import { ContextService } from './context.service.js';

@Module({
  imports: [KgModule, PromptsModule],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
```

### 5. `apps/api/src/prompts/` — NestJS PromptsModule + PromptService

#### 5a. `apps/api/src/prompts/prompts.service.ts` (новый)

```typescript
import { Injectable } from '@nestjs/common';
import { PromptRegistry } from '@orchestra/prompt-registry';
import { resolve } from 'node:path';

/**
 * NestJS-обёртка над PromptRegistry.
 * Каталог prompts/ разрешается относительно корня monorepo (cwd процесса api).
 */
@Injectable()
export class PromptService {
  private readonly registry: PromptRegistry;

  constructor() {
    // prompts/ живёт в корне monorepo. apps/api запускается из apps/api/,
    // поэтому поднимаемся на 2 уровня. Для прод-деплоя — настроить через env.
    const promptsDir = resolve(process.cwd(), '../../prompts');
    this.registry = new PromptRegistry(promptsDir);
  }

  async getPrompt(roleId: string): Promise<{ content: string; version: string }> {
    return this.registry.getPrompt(roleId);
  }
}
```

#### 5b. `apps/api/src/prompts/prompts.module.ts` (новый)

```typescript
import { Module } from '@nestjs/common';
import { PromptService } from './prompts.service.js';

@Module({
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptsModule {}
```

### 6. Обновление существующих файлов

#### 6a. `apps/api/src/app.module.ts` (модифицировать)

Добавить импорт `ContextModule`:

```typescript
import { Module } from '@nestjs/common';
import type { GSDPhase } from '@orchestra/domain';
import { KgModule } from './kg/kg.module.js';
import { ContextModule } from './context/context.module.js';

@Module({
  imports: [KgModule, ContextModule],
})
export class AppModule {}
```

#### 6b. `apps/api/package.json` (модифицировать)

Добавить workspace-зависимости:

```json
{
  "dependencies": {
    "@orchestra/domain": "workspace:*",
    "@orchestra/context-service": "workspace:*",
    "@orchestra/prompt-registry": "workspace:*",
    "@nestjs/common": "^10",
    "@nestjs/core": "^10",
    "@prisma/client": "^6",
    "reflect-metadata": "^0.2",
    "rxjs": "^7"
  }
}
```

### 7. ЗАКРЫТИЕ ДОЛГА D-A1 — нормализация `apps/api/tsconfig.json`

**Долг:** `nest build` кладёт output в `dist/apps/api/src/main.js` вместо `dist/main.js`, потому что `tsconfig.base.json` содержит `baseUrl: "."` + `paths`, и tsc трактует monorepo-root как rootDir.

**Фикс:** добавить явный `rootDir: "./src"` в `apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "module": "CommonJS",
    "moduleResolution": "Node",
    "target": "ES2022"
  },
  "include": ["src"]
}
```

**Проверка D-A1 закрытия:** после `pnpm --filter @orchestra/api build` файл `apps/api/dist/main.js` существует по прямому пути (НЕ `apps/api/dist/apps/api/src/main.js`).

**Внимание кодеру:** `rootDir: "./src"` может вызвать ошибку TS6059 ("file not under rootDir"), если какой-то импорт тянет файл снаружи `src/` (например, через path-mapping `@orchestra/domain`). Если это произойдёт — НЕ убирать rootDir (это откатит фикс). Вместо этого проверить, что `@orchestra/domain` импортируется как type-only (через `paths`), а не как реальный файл. Все импорты domain в apps/api уже `import type` — это должно работать. Если tsc всё равно ругается — сообщить в SUMMARY, не откатывать фикс.

### 8. ЗАКРЫТИЕ ДОЛГА D-B3 — `*.tsbuildinfo` в .gitignore

**Долг:** `apps/web/tsconfig.tsbuildinfo` закоммичен в git (commit `209d130`, Phase 1) и модифицируется каждым билдом → вечная грязь в working tree.

**Фикс:**

#### 8a. `.gitignore` (модифицировать) — добавить в секцию build-artifacts:

```gitignore
# Build artifacts must never live next to sources.
# Source files are .ts only; compiled output goes to dist/.
**/src/**/*.js
**/src/**/*.js.map
**/src/**/*.d.ts
**/src/**/*.d.ts.map
*.tsbuildinfo
```

#### 8b. Убрать файл из git-индекса (НЕ удалять с диска):

```bash
git rm --cached apps/web/tsconfig.tsbuildinfo
```

**Проверка D-B3 закрытия:** `git status` после фикса НЕ показывает `apps/web/tsconfig.tsbuildinfo` как modified (он теперь ignored). Файл остаётся на диске (нужен для инкрементальных билдов), но больше не в git.

### 9. pnpm install

После создания новых пакетов (`packages/context-service`, `packages/prompt-registry`) и обновления `apps/api/package.json`:

```bash
pnpm install
```

Это свяжет workspace-зависимости (`@orchestra/context-service`, `@orchestra/prompt-registry`).

## Anti-conflict (важно для кодера)

**НЕ ТРОГАТЬ:**
- `docs/**` — вся документация заморожена.
- `README.md`, `LICENSE`, `CONTRIBUTING.md` в корне — заморожены.
- `.planning/phases/01-*/` и `.planning/phases/02-*/` — артефакты пред. фаз не редактировать.
- `packages/domain/src/*.ts` — **не менять существующие типы** (gsd.ts, decision.ts, context.ts, agent.ts, consensus.ts, kg.ts). Phase 3 только **потребляет** их. Если тип не хватает — НЕ дополнять на месте, сообщить в SUMMARY (долг).
- `packages/knowledge-graph/**` — не трогать Prisma-схему, KgService. Phase 3 только **потребляет** KgService через адаптер.
- `apps/api/src/kg/` — не менять (только импортировать KgModule в ContextModule).
- `apps/api/prisma/schema.prisma` — не трогать (долг D-B2 — отдельная фаза).
- **Не создавать** Role Router, Provider adapters (OpenAI/GLM/Gemini), GSD Engine runtime, Consensus Engine, Decision Repository — это Wave 4+.
- **Не подключать** реальную токенизацию (tiktoken) — заглушка char/4.
- **Не реализовывать** hot-reload Prompt Registry (FS-watcher) — заглушка read-per-call.
- **Не подключать** Event Bus / Redis / BullMQ — Wave 5.

## Готово, когда (success criteria)

- [ ] `pnpm install` из корня выполняется без ошибок (новые workspace-пакеты связаны).
- [ ] `pnpm -r typecheck` зелёный во всех **6** пакетах (domain, knowledge-graph, context-service, prompt-registry, api, web).
- [ ] `pnpm --filter @orchestra/context-service build` компилируется.
- [ ] `pnpm --filter @orchestra/prompt-registry build` компилируется.
- [ ] `pnpm --filter @orchestra/api build` компилируется с ContextModule + PromptsModule.
- [ ] **D-A1 закрыт:** после `pnpm --filter @orchestra/api build` файл `apps/api/dist/main.js` существует по прямому пути.
- [ ] **D-B3 закрыт:** `*.tsbuildinfo` в `.gitignore`; `git status` не показывает `apps/web/tsconfig.tsbuildinfo`.
- [ ] `packages/context-service` не имеет зависимостей от `@prisma/client` или `@nestjs/*` (только `@orchestra/domain`). Проверка: `grep -r "@prisma\|@nestjs" packages/context-service/src/` → пусто.
- [ ] `packages/prompt-registry` не имеет зависимостей от `@nestjs/*`. Проверка: `grep -r "@nestjs" packages/prompt-registry/src/` → пусто.
- [ ] 5 файлов `prompts/*.md` существуют.
- [ ] `git status` показывает только файлы Phase 3 + `.gitignore` правка + `apps/web/tsconfig.tsbuildinfo` удалён из индекса. Ни одного изменения в `docs/` или существующих типах domain.

## Не готово, когда

- `pnpm install` падает — workspace-зависимости не резолвятся.
- `pnpm -r typecheck` красный — типы не совместимы (особенно: импорт типов из `@orchestra/context-service` в apps/api).
- Кодер добавил Role Router / Provider / Consensus Engine / GSD Engine runtime.
- Кодер отредактировал `docs/`, `packages/domain/src/*.ts` (кроме случаев, оговоренных выше), `packages/knowledge-graph/**`.
- Кодер реализовал hot-reload Prompt Registry (超出 scope, заморозить — будущая фаза).
- D-A1 не закрыт: `apps/api/dist/main.js` не существует по прямому пути после build.
- D-B3 не закрыт: `git status` всё ещё показывает `apps/web/tsconfig.tsbuildinfo` modified.
- `context-service` или `prompt-registry` содержат импорт `@prisma/client` или `@nestjs/*` (нарушение чистоты пакета).
- Кодер дополнил типы в `packages/domain/src/` без явного долга в SUMMARY.

## Архитектурные принципы этой фазы (почему так)

1. **Hexagonal ports (`KgGraphPort`, `PromptPort`).** Пакет `context-service` определяет интерфейсы источников данных, а `apps/api` подключает адаптеры. Это сохраняет чистоту: пакет можно тестировать без БД и FS, и он не утягивает Prisma/NestJS в потребителей типа `apps/web`.

2. **Два отдельных пакета (`context-service` + `prompt-registry`), а не один.** Prompt Registry — отдельный контейнер (`Architecture.md §3`). У него своя эволюция (hot-reload, версионирование, БД--backend в будущем). Слияние с context-service создало бы связанность, которая сломает будущий hot-reload.

3. **Заглушки вместо неполных реализаций.** Token-budget = char/4 (не tiktoken), Prompt Registry = read-per-call (не hot-reload). Это явно зафиксировано в коде и SUMMARY. Принцип: лучше честная заглушка с долгом, чем полу-реализация, которая притворяется готовой.

4. **5 ролей — полный набор из Agent Protocol.md §1.** Политики и промпты создаются для всех 5 (architect, tech_lead, researcher, critic, engineer), не для подмножества. Это даёт Wave 4 (Role Router) готовый контрак.

5. **Закрытие долгов D-A1 + D-B3 в этой фазе.** Обещаны в README Phase 2. D-A1 — нормализация `apps/api/tsconfig.json` (одна строка `rootDir`). D-B3 — `.gitignore` + `git rm --cached` (одна строка + одна команда). Обе правки тривиальны и относятся к build-hygiene, которая нужна именно сейчас (новые пакеты = новый build-output).

## Что даёт эта фаза для Orchestra

- **Ядро Context Service:** pipeline извлечения подграфа → применение политики → токен-бюджет → сборка ContextPacket. Это центральный инвариант Orchestra (`Context Protocol.md §8`).
- **Prompt Registry (минимальный):** FS-ридер промптов с версионированием (sha256). Seed-промпты для 5 ролей. Готов к hot-reload в будущей фазе.
- **Чистая архитектура:** `context-service` и `prompt-registry` — автономные пакеты без Prisma/NestJS. Adapter-слой в `apps/api` связывает их с KgService и FS.
- **Контракт для Wave 4:** Role Router будет вызывать `ContextService.buildPacket()` перед отправкой провайдеру. Provider adapters получат готовый `ContextPacket` (18 полей, contentHash).
- **Закрытие долгов:** D-A1 (build-output layout) + D-B3 (tsbuildinfo hygiene) — clean working tree для следующих фаз.

## Следующий шаг

После PASS этой фазы Wave 4 продолжит:
- `packages/role-router` — диспетчеризация ContextPacket по RoleManifest.
- `packages/providers` — адаптеры AIProvider (OpenAI/GLM/Gemini/MiMo).
- `apps/api/src/roles/` — NestJS-модуль Role Router.
- Полная токенизация (tiktoken) для Compression.
- GSD Engine runtime (конечный автомат фаз).

Безопасно стартовать Wave 4 когда D-11 (typecheck) стабильно зелёный и `ContextService.buildPacket()` возвращает валидный `ContextPacket` с contentHash. Phase 3 заморожена.

## Долги, которые ОСТАЮТСЯ после этой фазы (явно)

| Долг | Статус | Когда |
|---|---|---|
| **D-B2** (из Phase 2) | НЕ закрывается (дубликат schema.prisma) | Wave 5 (фаза подключения БД/миграций) |
| **D-C1** (новый, эта фаза) | Prompt Registry hot-reload — заглушка | Wave 4+ (с FS-watcher) |
| **D-C2** (новый, эта фаза) | Token Compression — аппроксимация char/4 | Wave 4 (с tiktoken) |
| **D-C3** (новый, эта фаза) | Memory Layers overlay — упрощённый (без персистенции) | Wave 4+ |
| **D-C4** (новый, эта фаза) | Event Bus publishing (`ContextPacketBuilt`) — отсутствует | Wave 5 (с Event Bus) |

Каждый из D-C* — честная заглушка, не блокирует Wave 4. Подробно — в README-CONTRACT-PHASE-3 (после верификации).
