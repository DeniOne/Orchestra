import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConsensusEngine } from '../src/consensus-engine.js';
import type { ConsensusInput, RoleResponse } from '../src/types.js';
import type { RoleRef, GSDPhase } from '@orchestra/domain';

const architect: RoleRef = { id: 'architect', displayName: 'Chief Architect', responsibilities: ['architecture'] };
const techLead: RoleRef = { id: 'tech_lead', displayName: 'Tech Lead', responsibilities: ['implementation'] };
const researcher: RoleRef = { id: 'researcher', displayName: 'Researcher', responsibilities: ['research'] };

function makeResponse(role: RoleRef, content: string): RoleResponse {
  return { role, response: { requestId: `req-${role.id}`, content, finishReason: 'stop' } };
}

describe('ConsensusEngine', () => {
  const engine = new ConsensusEngine();

  // T1: Empty input
  it('T1: empty input → empty report, correct gating', async () => {
    const input: ConsensusInput = { roundId: 'r1', phase: 'Goal', responses: [] };
    const report = await engine.run(input);
    assert.equal(report.id, 'consensus-r1');
    assert.equal(report.agreedDecisions.length, 0);
    assert.equal(report.disagreements.length, 0);
    assert.equal(report.risks.length, 0);
    assert.ok(report.confidence);
    // Goal phase has threshold architecture:70, empty → fail
    assert.equal(report.gatingVerdict, 'fail');
  });

  // T2: Single role, single architecture claim
  it('T2: single role → no agreed decisions, low architecture confidence', async () => {
    const input: ConsensusInput = {
      roundId: 'r2',
      phase: 'Architecture',
      responses: [makeResponse(architect, '# Architecture\nUse hexagonal pattern for modules')],
    };
    const report = await engine.run(input);
    assert.equal(report.agreedDecisions.length, 0); // need ≥2 roles
    assert.ok(report.confidence.architecture < 85); // threshold for Architecture
    assert.equal(report.gatingVerdict, 'fail');
  });

  // T3: Two roles with matching architecture claim
  it('T3: two roles agreeing → accepted decision, high confidence', async () => {
    const input: ConsensusInput = {
      roundId: 'r3',
      phase: 'Architecture',
      responses: [
        makeResponse(architect, '# Architecture\nUse hexagonal pattern for modules'),
        makeResponse(techLead, '# Architecture\nUse hexagonal pattern for all modules'),
      ],
    };
    const report = await engine.run(input);
    assert.ok(report.agreedDecisions.length >= 1);
    assert.equal(report.agreedDecisions[0].status, 'accepted');
    assert.equal(report.agreedDecisions[0].acceptedBy.length, 2);
    assert.ok(report.confidence.architecture >= 85); // should pass threshold
  });

  // T4: Two roles with conflicting claims
  it('T4: conflicting claims → Conflict in disagreements', async () => {
    const input: ConsensusInput = {
      roundId: 'r4',
      phase: 'Specification',
      responses: [
        makeResponse(architect, '# Architecture\nUse PostgreSQL for the database'),
        makeResponse(techLead, '# Architecture\nUse MongoDB for the database'),
      ],
    };
    const report = await engine.run(input);
    assert.ok(report.disagreements.length >= 1);
    assert.equal(report.disagreements[0].positions.length, 2);
  });

  // T5: Gating edge cases
  it('T5: Discover/Iteration → pass; Architecture low confidence → fail', async () => {
    // Discover: no thresholds → pass
    const discoverInput: ConsensusInput = { roundId: 'r5a', phase: 'Discover', responses: [] };
    const discoverReport = await engine.run(discoverInput);
    assert.equal(discoverReport.gatingVerdict, 'pass');

    // Iteration: no thresholds → pass
    const iterInput: ConsensusInput = { roundId: 'r5b', phase: 'Iteration', responses: [] };
    const iterReport = await engine.run(iterInput);
    assert.equal(iterReport.gatingVerdict, 'pass');

    // Architecture with low confidence → fail
    const archInput: ConsensusInput = {
      roundId: 'r5c',
      phase: 'Architecture',
      responses: [makeResponse(researcher, '# Research\nBenchmark study on databases')],
    };
    const archReport = await engine.run(archInput);
    assert.equal(archReport.gatingVerdict, 'fail');
    assert.ok(archReport.nextAction.includes('iterate'));
  });

  // T6: Determinism
  it('T6: deterministic — same input → identical output (including ids)', async () => {
    const input: ConsensusInput = {
      roundId: 'r6',
      phase: 'Architecture',
      responses: [
        makeResponse(architect, '# Architecture\nUse hexagonal pattern for modules'),
        makeResponse(techLead, '# Architecture\nUse hexagonal pattern for modules\n## Risk\nDatabase risk: potential data loss'),
        makeResponse(researcher, '# Research\nBenchmark study shows PostgreSQL is optimal'),
      ],
    };
    const report1 = await engine.run(input);
    const report2 = await engine.run(input);
    assert.deepStrictEqual(report1, report2);
    assert.equal(JSON.stringify(report1), JSON.stringify(report2));
  });
});
