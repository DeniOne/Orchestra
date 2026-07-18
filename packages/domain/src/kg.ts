/** Типы узлов Knowledge Graph. См. docs/Architecture.md §6. */
export type KgNodeType =
  | 'Goal'
  | 'Requirement'
  | 'Architecture'
  | 'API'
  | 'Module'
  | 'Entity'
  | 'Repository'
  | 'Service'
  | 'Risk'
  | 'Test'
  | 'ADR'
  | 'Task'
  | 'Research'
  | 'Code'
  | 'Documentation'
  | 'Decision';

/** Типы отношений Knowledge Graph. См. docs/Architecture.md §6. */
export type KgRelationshipType =
  | 'depends_on'
  | 'replaces'
  | 'implements'
  | 'validates'
  | 'blocks'
  | 'supersedes'
  | 'conflicts_with'
  | 'references';

export interface KgNodeData {
  id: string;
  type: KgNodeType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KgRelationshipData {
  id: string;
  type: KgRelationshipType;
  sourceId: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
