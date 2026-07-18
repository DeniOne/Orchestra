import type { Decision, RoleRef } from '@orchestra/domain';
import type { ClaimCluster } from './types.js';

/**
 * Assesses agreement: clusters with ≥2 roles agreeing → accepted Decision.
 */
export function assessAgreement(clusters: ClaimCluster[], roundId: string): Decision[] {
  const decisions: Decision[] = [];
  let decisionIndex = 0;

  for (const cluster of clusters) {
    const roleMap = new Map<string, RoleRef>();
    for (const claim of cluster.claims) {
      roleMap.set(claim.role.id, claim.role);
    }

    if (roleMap.size >= 2) {
      decisions.push({
        id: `decision-${decisionIndex}`,
        roundId,
        title: cluster.topic,
        description: cluster.claims.map((c) => c.text).join('; '),
        status: 'accepted',
        acceptedBy: Array.from(roleMap.values()),
        rejectedBy: [],
      });
      decisionIndex++;
    }
  }

  return decisions;
}
