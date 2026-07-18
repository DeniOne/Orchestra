import type { KgNodeData } from '@orchestra/domain';
import type { KgGraphPort, ContextPolicy } from './types.js';

/**
 * Извлекает релевантный подграф из Knowledge Graph.
 * Алгоритм: Context Protocol.md §4 (BFS от objective-узла).
 *
 * Допущение: KgGraphPort.getNeighbors не фильтрует по RelationshipType.
 * Фильтрация по NodeType делает applyPolicy позже. Улучшение — Wave 4.
 */
export async function extractSubgraph(
  graph: KgGraphPort,
  startNodeId: string,
  policy: ContextPolicy,
): Promise<KgNodeData[]> {
  const visited = new Set<string>();
  const result: KgNodeData[] = [];
  let frontier: string[] = [startNodeId];
  const maxDepth = policy.subgraphDepth;

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = await graph.getNode(nodeId);
      if (node) result.push(node);

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
