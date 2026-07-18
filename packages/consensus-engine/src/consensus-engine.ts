import type { ConsensusReport } from '@orchestra/domain';
import type { ConsensusInput, ConsensusEngineOptions } from './types.js';
import { ClaimExtractor } from './claim-extractor.js';
import { StructuralClusterStrategy } from './claim-clusterer.js';
import { detectConflicts } from './conflict-detector.js';
import { calculateConfidence } from './confidence-calculator.js';
import { assessAgreement } from './agreement-assessor.js';
import { buildReport } from './report-builder.js';
import { evaluateGating, buildNextAction } from './gating-policy.js';
import { ClaimSyntaxStrategy } from './strategies/claim-syntax.js';
import { DefaultGatingPolicy } from './strategies/gating-thresholds.js';

/**
 * Consensus Engine — deterministic aggregator (Consensus Protocol.md §1, §3).
 * NOT an LLM. Pure function: same input → same output.
 *
 * 9 stages of the protocol:
 * 1-2: Claim extraction
 * 3:   Clustering
 * 4:   Conflict detection
 * 5:   Confidence calculation
 * 6:   Agreement assessment
 * 7:   Report assembly
 * 8:   ADR generation — OUT OF SCOPE (D-E3, Wave 6)
 * 9:   Gating verdict + next action
 */
export class ConsensusEngine {
  private readonly extractor: ClaimExtractor;
  private readonly clusterStrategy: StructuralClusterStrategy;
  private readonly gatingPolicy: DefaultGatingPolicy;

  constructor(options: ConsensusEngineOptions = {}) {
    this.extractor = new ClaimExtractor(
      options.claimExtraction ?? new ClaimSyntaxStrategy(),
    );
    this.clusterStrategy = options.clustering ?? new StructuralClusterStrategy();
    this.gatingPolicy = options.gating ?? new DefaultGatingPolicy();
  }

  async run(input: ConsensusInput): Promise<ConsensusReport> {
    const { roundId, phase, responses } = input;

    // Stage 1-2: claim extraction
    const claims = this.extractor.extract(responses);

    // Stage 3: clustering
    const clusters = this.clusterStrategy.cluster(claims);

    // Stage 4: conflict detection
    const conflicts = detectConflicts(clusters);

    // Stage 5: confidence calculation
    const confidence = calculateConfidence(clusters, phase, responses);

    // Stage 6: agreement assessment
    const agreedDecisions = assessAgreement(clusters, roundId);

    // Stage 7: report assembly (risks, questions built inside buildReport)
    // Stage 8: ADR generation — skipped (D-E3, Wave 6)

    // Stage 9: gating
    const { verdict, gaps } = evaluateGating(confidence, phase, this.gatingPolicy);
    const nextAction = buildNextAction(verdict, phase, gaps);

    return buildReport({
      roundId,
      phase,
      agreedDecisions,
      conflicts,
      clusters,
      confidence,
      gatingVerdict: verdict,
      nextAction,
    });
  }
}
