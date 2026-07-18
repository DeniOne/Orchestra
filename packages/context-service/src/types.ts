import type {
  KgNodeType,
  KgNodeData,
  KgRelationshipData,
  ContextPacket,
  Constraint,
  OutputSpec,
  GSDPhase,
} from '@orchestra/domain';

/** Роль-специфичная контекстная политика. См. Context Protocol.md §5. */
export interface ContextPolicy {
  roleId: string;
  include: KgNodeType[];
  exclude: KgNodeType[];
  maxTokens: number;
  subgraphDepth: number;
}

/** Запрос на сборку ContextPacket. */
export interface BuildPacketRequest {
  sessionId: string;
  projectId: string;
  roundId: string;
  roleId: string;
  objective: string;
  objectiveNodeId?: string;
  phase: GSDPhase;
}

/** Источник данных графа — абстракция (hexagonal port). */
export interface KgGraphPort {
  getNode(id: string): Promise<KgNodeData | null>;
  getNeighbors(nodeId: string, direction?: 'in' | 'out' | 'both'): Promise<KgNodeData[]>;
  listNodes(type?: KgNodeType): Promise<KgNodeData[]>;
}

/** Источник системного промпта — абстракция (hexagonal port). */
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
