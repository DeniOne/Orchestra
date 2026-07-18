import type {
  ConsensusReport,
  Decision,
  Conflict,
  Question,
  Risk,
  DecisionConfidence,
  GatingVerdict,
  GSDPhase,
} from '@orchestra/domain';
import type { ClaimCluster, Claim } from './types.js';

/**
 * Assembles the final ConsensusReport from all stages.
 * Deterministic: all ids derived from roundId/cluster ids.
 */
export function buildReport(params: {
  roundId: string;
  phase: GSDPhase;
  agreedDecisions: Decision[];
  conflicts: Conflict[];
  clusters: ClaimCluster[];
  confidence: DecisionConfidence;
  gatingVerdict: GatingVerdict;
  nextAction: string;
}): ConsensusReport {
  const { roundId, agreedDecisions, conflicts, clusters, confidence, gatingVerdict, nextAction } = params;

  const openQuestions: Question[] = conflicts.map((c) => ({
    id: `q-${c.id}`,
    text: `Unresolved conflict on: ${c.topic}`,
  }));

  const riskClaims = clusters
    .filter((c) => c.category === 'risk')
    .flatMap((c) => c.claims);

  const risks: Risk[] = riskClaims.map((claim) => ({
    id: `risk-${claim.id}`,
    description: claim.text,
    severity: assessSeverity(claim.text),
    mitigation: extractMitigation(claim.text),
  }));

  const summary = buildSummary(agreedDecisions, conflicts, risks, confidence);

  return {
    id: `consensus-${roundId}`,
    roundId,
    summary,
    agreedDecisions,
    disagreements: conflicts,
    openQuestions,
    risks,
    nextAction,
    confidence,
    gatingVerdict,
  };
}

function assessSeverity(text: string): Risk['severity'] {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('severe')) return 'critical';
  if (lower.includes('high') || lower.includes('major')) return 'high';
  if (lower.includes('medium') || lower.includes('moderate')) return 'medium';
  return 'low';
}

function extractMitigation(text: string): string | undefined {
  const match = text.match(/(?:mitigat|resolve|prevent)\w*\s*[:：]\s*(.+)/i);
  return match?.[1]?.trim();
}

function buildSummary(
  decisions: Decision[],
  conflicts: Conflict[],
  risks: Risk[],
  confidence: DecisionConfidence,
): string {
  const parts: string[] = [];
  parts.push(`${decisions.length} agreed decision(s)`);
  parts.push(`${conflicts.length} conflict(s)`);
  parts.push(`${risks.length} risk(s)`);
  parts.push(`overall confidence: ${confidence.overall}%`);
  return parts.join(', ');
}
