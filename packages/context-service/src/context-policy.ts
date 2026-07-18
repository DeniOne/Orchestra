import type { KgNodeData, KgNodeType } from '@orchestra/domain';
import type { ContextPolicy } from './types.js';

/** Дефолтные политики ролей. См. Context Protocol.md §5. */
export const DEFAULT_POLICIES: Record<string, ContextPolicy> = {
  architect: {
    roleId: 'architect',
    include: ['Goal', 'Requirement', 'Architecture', 'ADR', 'Decision', 'Risk'],
    exclude: ['Code', 'Repository'],
    maxTokens: 32000,
    subgraphDepth: 3,
  },
  tech_lead: {
    roleId: 'tech_lead',
    include: ['Requirement', 'Architecture', 'API', 'Module', 'Entity', 'Service', 'Risk'],
    exclude: ['Research', 'Documentation'],
    maxTokens: 32000,
    subgraphDepth: 2,
  },
  researcher: {
    roleId: 'researcher',
    include: ['Research', 'Requirement', 'Risk', 'Decision'],
    exclude: ['Code', 'Repository', 'Test'],
    maxTokens: 24000,
    subgraphDepth: 3,
  },
  critic: {
    roleId: 'critic',
    include: ['Goal', 'Requirement', 'Architecture', 'ADR', 'Decision', 'Risk'],
    exclude: [],
    maxTokens: 24000,
    subgraphDepth: 2,
  },
  engineer: {
    roleId: 'engineer',
    include: ['Architecture', 'API', 'Module', 'Entity', 'Task', 'Code', 'Test'],
    exclude: ['Research'],
    maxTokens: 32000,
    subgraphDepth: 2,
  },
};

/** Применяет политику к узлам: exclude имеет приоритет над include. */
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
