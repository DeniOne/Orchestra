import type { Conflict, RoleRef } from '@orchestra/domain';
import type { ClaimCluster } from './types.js';

/**
 * Detects conflicts: clusters with ≥2 roles making opposing claims.
 * MVP: same cluster, different roles = potential conflict.
 */
export function detectConflicts(clusters: ClaimCluster[]): Conflict[] {
  const conflicts: Conflict[] = [];
  let conflictIndex = 0;

  for (const cluster of clusters) {
    const roles = new Set(cluster.claims.map((c) => c.role.id));
    if (roles.size < 2) continue;

    const positions = cluster.claims.map((c) => ({
      role: c.role,
      claim: c.text,
    }));

    conflicts.push({
      id: `conflict-${conflictIndex}`,
      topic: cluster.topic,
      positions,
    });
    conflictIndex++;
  }

  return conflicts;
}
