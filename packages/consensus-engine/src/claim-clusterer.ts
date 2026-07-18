import type { Claim, ClaimCluster, ClusterStrategy } from './types.js';

/**
 * MVP clustering: group by category + normalized topic term.
 * Future (D-E1): embedding similarity.
 */
export class StructuralClusterStrategy implements ClusterStrategy {
  cluster(claims: Claim[]): ClaimCluster[] {
    const groups = new Map<string, Claim[]>();

    for (const claim of claims) {
      const topic = extractTopic(claim);
      const key = `${claim.category}::${topic}`;
      const group = groups.get(key) ?? [];
      group.push(claim);
      groups.set(key, group);
    }

    const clusters: ClaimCluster[] = [];
    let clusterIndex = 0;
    for (const [key, groupClaims] of groups) {
      const [category, topic] = key.split('::');
      clusters.push({
        id: `cluster-${clusterIndex}`,
        category: category as Claim['category'],
        topic,
        claims: groupClaims,
      });
      clusterIndex++;
    }

    return clusters;
  }
}

function extractTopic(claim: Claim): string {
  const lower = claim.text.toLowerCase();
  const keywords: Record<string, string[]> = {
    architecture: ['architecture', 'component', 'module', 'adr', 'pattern', 'layer'],
    implementation: ['implement', 'code', 'migration', 'schema', 'library'],
    research: ['research', 'benchmark', 'study', 'evidence', 'hypothesis'],
    risk: ['risk', 'threat', 'vulnerability', 'debt', 'concern'],
    test: ['test', 'spec', 'coverage', 'validate'],
  };

  const categoryKeywords = keywords[claim.category] ?? [];
  for (const kw of categoryKeywords) {
    if (lower.includes(kw)) return kw;
  }

  return claim.text.split(/\s+/).slice(0, 5).join(' ').toLowerCase();
}
