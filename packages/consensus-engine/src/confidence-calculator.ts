import type { DecisionConfidence, GSDPhase } from '@orchestra/domain';
import type { ClaimCluster, ClaimCategory, RoleResponse } from './types.js';

/**
 * MVP confidence calculation (Consensus Protocol.md §6).
 * Deterministic formulas. Future (D-E1/D-E4): pluggable.
 */
export function calculateConfidence(
  clusters: ClaimCluster[],
  phase: GSDPhase,
  responses: RoleResponse[],
): DecisionConfidence {
  const totalClaims = clusters.reduce((sum, c) => sum + c.claims.length, 0);
  const roleCount = new Set(responses.map((r) => r.role.id)).size;

  const byCategory = (cat: ClaimCategory) =>
    clusters.filter((c) => c.category === cat);

  // architecture: claim coverage (40pts) + agreement coverage (60pts)
  const archClusters = byCategory('architecture');
  const archClaims = archClusters.reduce((s, c) => s + c.claims.length, 0);
  const archAgreed = archClusters.filter((c) => new Set(c.claims.map((cl) => cl.role.id)).size >= 2).length;
  const architecture = Math.min(100, Math.round(
    (Math.min(archClaims, 3) / 3) * 40 + (archClusters.length > 0 ? (archAgreed / archClusters.length) * 60 : 0),
  ));

  // implementation: % with ≥2 agreement
  const implClusters = byCategory('implementation');
  const implTotal = implClusters.reduce((s, c) => s + c.claims.length, 0);
  const implAgreed = implClusters.filter((c) => new Set(c.claims.map((cl) => cl.role.id)).size >= 2).length;
  const implementation = implTotal > 0 ? Math.min(100, Math.round((implAgreed / Math.max(implTotal, 1)) * 100)) : 0;

  // researchCoverage: 100 if any research claim, 0 otherwise
  const researchClaims = byCategory('research').reduce((s, c) => s + c.claims.length, 0);
  const researchCoverage = researchClaims > 0 ? 100 : 0;

  // riskCoverage: % risk-claims with mitigation keyword
  const riskClusters = byCategory('risk');
  const riskTotal = riskClusters.reduce((s, c) => s + c.claims.length, 0);
  const riskMitigated = riskClusters
    .flatMap((c) => c.claims)
    .filter((cl) => /mitigat|resolve|prevent/i.test(cl.text)).length;
  const riskCoverage = riskTotal > 0 ? Math.min(100, Math.round((riskMitigated / riskTotal) * 100)) : 100;

  // testCoverage: % test claims scaled
  const testClaims = byCategory('test').reduce((s, c) => s + c.claims.length, 0);
  const testCoverage = totalClaims > 0 ? Math.min(100, Math.round((testClaims / totalClaims) * 50)) : 0;

  // overall: weighted average
  const overall = Math.round(
    0.3 * architecture +
    0.25 * implementation +
    0.15 * researchCoverage +
    0.15 * riskCoverage +
    0.15 * testCoverage,
  );

  return {
    architecture,
    implementation,
    researchCoverage,
    riskCoverage,
    testCoverage,
    overall,
  };
}
