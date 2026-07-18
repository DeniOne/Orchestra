import type { ISO8601, RoleRef, DecisionRef, QuestionRef, RiskRef, ArtifactRef } from './decision.js';
import type { GSDPhase } from './gsd.js';
export type OutputType = 'ADR' | 'Architecture' | 'Review' | 'Code' | 'Specification' | 'Research' | 'Decision' | 'Consensus' | 'Task';
export interface OutputSpec {
    type: OutputType;
    description?: string;
}
export type Summary = string;
export interface Constraint {
    id: string;
    description: string;
    source?: string;
}
export declare const MemoryLayer: {
    readonly System: 1;
    readonly Project: 2;
    readonly Working: 3;
    readonly Conversation: 4;
    readonly Scratch: 5;
};
export type MemoryLayerValue = (typeof MemoryLayer)[keyof typeof MemoryLayer];
/** См. docs/Context Protocol.md §2. */
export interface ContextPacket {
    sessionId: string;
    projectId: string;
    roundId: string;
    phase: GSDPhase;
    role: RoleRef;
    objective: string;
    relevantDecisions: DecisionRef[];
    openQuestions: QuestionRef[];
    knownRisks: RiskRef[];
    constraints: Constraint[];
    artifacts: ArtifactRef[];
    conversationSummary: Summary;
    systemPrompt: string;
    expectedOutput: OutputSpec;
    outputFormat: 'json' | 'markdown' | 'code' | 'adr';
    builtAt: ISO8601;
    modelTarget: string;
    contextPolicyId: string;
    contentHash: string;
}
/** См. docs/Context Protocol.md §7. */
export interface ContextPacketRecord {
    packet: ContextPacket;
    kgSnapshotRef: string;
    promptVersion: string;
    replayable: true;
}
//# sourceMappingURL=context.d.ts.map