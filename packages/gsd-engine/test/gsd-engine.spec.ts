import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GsdEngine, InMemoryAuditLog } from '../src/index.js';
import type { GatingPort, GatingResult } from '../src/index.js';
import type { GSDPhase, SessionId } from '@orchestra/domain';

function makeFailGating(phase: GSDPhase): GatingPort {
  return {
    async evaluate(_sessionId: SessionId, p: GSDPhase): Promise<GatingResult> {
      return p === phase
        ? { verdict: 'fail', gaps: ['metric below threshold'], phase: p }
        : { verdict: 'pass', gaps: [], phase: p };
    },
  };
}

describe('GsdEngine', () => {
  // T1: startSession + startRound
  it('T1: startSession → Session with currentPhase=Discover; startRound → Round{number:1}', async () => {
    const engine = new GsdEngine();
    const session = await engine.startSession({ name: 'feat-x', projectId: 'p1', id: 's1' });

    assert.equal(session.currentPhase, 'Discover');
    assert.equal(session.rounds.length, 0);
    assert.equal(session.id, 's1');

    const round = await engine.startRound('s1');
    assert.equal(round.number, 1);
    assert.equal(round.phase, 'Discover');
    assert.equal(round.status, 'in_progress');
    assert.equal(round.id, 'round-s1-1');
  });

  // T2: FSM Discover → Goal → Specification (non-hard, stub pass)
  it('T2: advancePhase Discover→Goal→Specification (3 transitioned)', async () => {
    const engine = new GsdEngine();
    await engine.startSession({ name: 'feat-x', projectId: 'p1', id: 's2' });

    const r1 = await engine.advancePhase('s2');
    assert.equal(r1.status, 'transitioned');
    if (r1.status === 'transitioned') {
      assert.equal(r1.from, 'Discover');
      assert.equal(r1.to, 'Goal');
    }

    const r2 = await engine.advancePhase('s2');
    assert.equal(r2.status, 'transitioned');
    if (r2.status === 'transitioned') {
      assert.equal(r2.from, 'Goal');
      assert.equal(r2.to, 'Specification');
    }

    const session = await engine.getSession('s2');
    assert.equal(session?.currentPhase, 'Specification');
  });

  // T3: Architecture hard gate → awaiting_approval → approve → transitioned
  it('T3: Architecture hard gate blocks, approve unblocks', async () => {
    const engine = new GsdEngine();
    await engine.startSession({ name: 'feat-x', projectId: 'p1', id: 's3' });

    // Discover → Goal → Specification → Architecture
    await engine.advancePhase('s3');
    await engine.advancePhase('s3');
    const r3 = await engine.advancePhase('s3');
    assert.equal(r3.status, 'transitioned');
    if (r3.status === 'transitioned') assert.equal(r3.to, 'Architecture');

    // Architecture is hard gate — should block
    const r4 = await engine.advancePhase('s3');
    assert.equal(r4.status, 'awaiting_approval');
    if (r4.status === 'awaiting_approval') assert.equal(r4.phase, 'Architecture');

    // Approve
    const session = await engine.approveTransition('s3');
    assert.equal(session.currentPhase, 'Architecture');

    // Now advance works
    const r5 = await engine.advancePhase('s3');
    assert.equal(r5.status, 'transitioned');
    if (r5.status === 'transitioned') assert.equal(r5.to, 'Implementation');
  });

  // T4: Consensus gating fail → iteration → Specification
  it('T4: Consensus gating fail → iteration path', async () => {
    const failConsensus = makeFailGating('Consensus');
    const engine = new GsdEngine({ gating: failConsensus });
    await engine.startSession({ name: 'feat-x', projectId: 'p1', id: 's4' });

    // Walk to Consensus: Discover→Goal→Specification→Architecture(approve)→Implementation→Review→Consensus
    await engine.advancePhase('s4'); // → Goal
    await engine.advancePhase('s4'); // → Specification
    await engine.advancePhase('s4'); // → Architecture (hard gate)

    await engine.approveTransition('s4');
    await engine.advancePhase('s4'); // → Implementation

    await engine.advancePhase('s4'); // → Review
    const rConsensus = await engine.advancePhase('s4'); // → Consensus
    assert.equal(rConsensus.status, 'transitioned');
    if (rConsensus.status === 'transitioned') assert.equal(rConsensus.to, 'Consensus');

    // Consensus with fail gating → Iteration
    const rFail = await engine.advancePhase('s4');
    assert.equal(rFail.status, 'iteration');
    if (rFail.status === 'iteration') {
      assert.equal(rFail.from, 'Consensus');
      assert.equal(rFail.to, 'Iteration');
      assert.deepEqual(rFail.gaps, ['metric below threshold']);
    }

    // Iteration → Specification
    const session = await engine.getSession('s4');
    assert.equal(session?.currentPhase, 'Iteration');

    const rIter = await engine.advancePhase('s4');
    assert.equal(rIter.status, 'transitioned');
    if (rIter.status === 'transitioned') assert.equal(rIter.to, 'Specification');
  });

  // T5: overrideGate → audit record
  it('T5: overrideGate logs audit record and performs transition', async () => {
    const audit = new InMemoryAuditLog();
    const engine = new GsdEngine({ audit });
    await engine.startSession({ name: 'feat-x', projectId: 'p1', id: 's5' });

    // Walk to Architecture (hard gate)
    await engine.advancePhase('s5'); // → Goal
    await engine.advancePhase('s5'); // → Specification
    await engine.advancePhase('s5'); // → Architecture

    // Override the gate
    const session = await engine.overrideGate('s5', 'test override');
    assert.equal(session.currentPhase, 'Implementation');

    // Check audit
    const records = await audit.list('s5');
    assert.equal(records.length, 1);
    assert.equal(records[0].reason, 'test override');
    assert.equal(records[0].phase, 'Architecture');
  });

  // T6: Determinism — same input → same ids
  it('T6: deterministic ids for same input', async () => {
    const engine = new GsdEngine();
    await engine.startSession({ name: 'feat-x', projectId: 'p1', id: 'det-1' });
    await engine.startRound('det-1');

    const rounds1 = await engine.listRounds('det-1');
    assert.equal(rounds1[0].id, 'round-det-1-1');

    // Run again with same session id — verify round id pattern
    const engine2 = new GsdEngine();
    await engine2.startSession({ name: 'feat-x', projectId: 'p1', id: 'det-1' });
    await engine2.startRound('det-1');

    const rounds2 = await engine2.listRounds('det-1');
    assert.equal(rounds2[0].id, 'round-det-1-1');
    assert.deepEqual(rounds1[0].id, rounds2[0].id);
  });

  // T7: terminal — full pass through to Consensus exit
  it('T7: terminal at Consensus (pass → terminal), repeated advance stays terminal', async () => {
    const engine = new GsdEngine();
    await engine.startSession({ name: 'feat-x', projectId: 'p1', id: 's7' });

    // Walk the full path
    await engine.advancePhase('s7'); // Discover → Goal
    await engine.advancePhase('s7'); // Goal → Specification
    await engine.advancePhase('s7'); // Specification → Architecture

    await engine.approveTransition('s7');
    await engine.advancePhase('s7'); // Architecture → Implementation

    await engine.advancePhase('s7'); // Implementation → Review
    const rConsensus = await engine.advancePhase('s7'); // Review → Consensus

    assert.equal(rConsensus.status, 'transitioned');
    if (rConsensus.status === 'transitioned') {
      assert.equal(rConsensus.to, 'Consensus');
    }

    // Consensus is terminal (stub gating returns pass)
    const rTerminal = await engine.advancePhase('s7');
    assert.equal(rTerminal.status, 'terminal');

    // Repeated call stays terminal
    const rTerminal2 = await engine.advancePhase('s7');
    assert.equal(rTerminal2.status, 'terminal');
  });
});
