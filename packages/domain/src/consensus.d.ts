import type { Decision, RoleRef } from './decision.js';
export interface Question {
    id: string;
    text: string;
    askedBy?: RoleRef;
}
export interface Risk {
    id: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    mitigation?: string;
}
export interface Conflict {
    id: string;
    topic: string;
    positions: {
        role: RoleRef;
        claim: string;
    }[];
}
export type GSDAction = string;
export type GatingVerdict = 'pass' | 'fail';
/** См. docs/Consensus Protocol.md §5. */
export interface DecisionConfidence {
    architecture: number;
    implementation: number;
    researchCoverage: number;
    riskCoverage: number;
    testCoverage: number;
    overall: number;
}
/** См. docs/Consensus Protocol.md §1. */
export interface ConsensusReport {
    id: string;
    roundId: string;
    summary: string;
    agreedDecisions: Decision[];
    disagreements: Conflict[];
    openQuestions: Question[];
    risks: Risk[];
    nextAction: GSDAction;
    confidence: DecisionConfidence;
    gatingVerdict: GatingVerdict;
}
//# sourceMappingURL=consensus.d.ts.map