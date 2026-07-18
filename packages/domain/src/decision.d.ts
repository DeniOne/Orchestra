export type ISO8601 = string;
export interface RoleRef {
    id: string;
    displayName: string;
    responsibilities: readonly string[];
}
export interface DecisionRef {
    id: string;
    version: string;
}
export interface QuestionRef {
    id: string;
}
export interface RiskRef {
    id: string;
}
export interface ArtifactRef {
    id: string;
    type: string;
    version: string;
}
/** См. docs/Orchestra_TC.md §5 (сущность Decision). */
export type DecisionStatus = 'proposed' | 'accepted' | 'rejected';
export interface Decision {
    id: string;
    roundId: string;
    title: string;
    description: string;
    status: DecisionStatus;
    acceptedBy: RoleRef[];
    rejectedBy: RoleRef[];
}
//# sourceMappingURL=decision.d.ts.map