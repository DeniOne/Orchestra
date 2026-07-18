import type {
  Response,
  RoleRef,
  GSDPhase,
  ConsensusReport,
  DecisionConfidence,
} from '@orchestra/domain';

export interface RoleResponse {
  role: RoleRef;
  response: Response;
}

export interface ConsensusInput {
  roundId: string;
  phase: GSDPhase;
  responses: RoleResponse[];
}

export type { ConsensusReport } from '@orchestra/domain';

export interface ClaimExtractionStrategy {
  extract(roleResponse: RoleResponse): Claim[];
}

export interface Claim {
  id: string;
  text: string;
  role: RoleRef;
  category: ClaimCategory;
}

export type ClaimCategory =
  | 'architecture'
  | 'implementation'
  | 'research'
  | 'risk'
  | 'test';

export interface ClusterStrategy {
  cluster(claims: Claim[]): ClaimCluster[];
}

export interface ClaimCluster {
  id: string;
  category: ClaimCategory;
  topic: string;
  claims: Claim[];
}

export interface GatingPolicy {
  thresholdsForTransitionFrom(phase: GSDPhase): Partial<DecisionConfidence> | undefined;
}

export interface ConsensusEngineOptions {
  claimExtraction?: ClaimExtractionStrategy;
  clustering?: ClusterStrategy;
  gating?: GatingPolicy;
}
