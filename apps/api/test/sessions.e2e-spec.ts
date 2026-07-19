import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GsdEngine, InMemorySessionStore, StubGating, InMemoryAuditLog } from '@orchestra/gsd-engine';
import type { Session, Round, SessionId } from '@orchestra/domain';
import { SessionsController } from '../src/sessions/sessions.controller.js';

// Build mock service wrapping real engine
const store = new InMemorySessionStore();
const engine = new GsdEngine({ store, gating: new StubGating(), audit: new InMemoryAuditLog() });

const mockGsd = {
  async startSession(name: string, projectId: string): Promise<Session> { return engine.startSession({ name, projectId }); },
  async startRound(sessionId: SessionId): Promise<Round> { return engine.startRound(sessionId); },
  async advancePhase(sessionId: SessionId) { return engine.advancePhase(sessionId); },
  async approveTransition(sessionId: SessionId): Promise<Session> { return engine.approveTransition(sessionId); },
  async overrideGate(sessionId: SessionId, reason: string): Promise<Session> { return engine.overrideGate(sessionId, reason); },
  async getSession(sessionId: SessionId): Promise<Session | null> { return engine.getSession(sessionId); },
  async listRounds(sessionId: SessionId): Promise<Round[]> { return engine.listRounds(sessionId); },
};

// Instantiate controller directly with mock service (bypass NestJS DI)
const controller = new SessionsController(mockGsd as any);

describe('SessionsController', () => {
  // E1: createSession → Session in Discover phase
  it('E1 createSession → Session with currentPhase=Discover', async () => {
    const session = await controller.createSession({ name: 'feature-X', projectId: 'proj-1' });
    assert.equal(session.currentPhase, 'Discover');
    assert.equal(session.name, 'feature-X');
    assert.deepEqual(session.rounds, []);
    assert.ok(session.id);
  });

  // E2: getSession → returns session
  it('E2 getSession returns created session', async () => {
    const created = await controller.createSession({ name: 'feature-Y', projectId: 'proj-1' });
    const session = await controller.getSession(created.id);
    assert.equal(session.id, created.id);
  });

  // E3: getSession nonexistent → throws NotFoundException
  it('E3 getSession nonexistent → NotFoundException', async () => {
    try {
      await controller.getSession('nope');
      assert.fail('should have thrown');
    } catch (e: any) {
      assert.equal(e.status, 404);
    }
  });

  // E4: startRound → Round with status=in_progress
  it('E4 startRound → Round with status=in_progress', async () => {
    const created = await controller.createSession({ name: 'round-test', projectId: 'proj-1' });
    const round = await controller.startRound(created.id);
    assert.equal(round.status, 'in_progress');
    assert.equal(round.phase, 'Discover');
    assert.equal(round.number, 1);
  });

  // E5: advancePhase → valid AdvancePhaseResult
  it('E5 advancePhase returns valid status', async () => {
    const created = await controller.createSession({ name: 'advance-test', projectId: 'proj-1' });
    await controller.startRound(created.id);
    const result = await controller.advancePhase(created.id);
    const validStatuses = ['transitioned', 'gated', 'awaiting_approval', 'terminal', 'iteration'];
    assert.ok(validStatuses.includes(result.status), `unexpected status: ${result.status}`);
  });

  // E6: overrideGate → advances phase
  it('E6 overrideGate advances phase and returns session', async () => {
    const created = await controller.createSession({ name: 'override-test', projectId: 'proj-1' });
    await controller.startRound(created.id);
    const session = await controller.overrideGate(created.id, 'owner skip');
    assert.notEqual(session.currentPhase, 'Discover');
  });

  // E7: listRounds → returns rounds array
  it('E7 listRounds returns rounds', async () => {
    const created = await controller.createSession({ name: 'list-rounds', projectId: 'proj-1' });
    await controller.startRound(created.id);
    const rounds = await controller.listRounds(created.id);
    assert.ok(Array.isArray(rounds));
    assert.ok(rounds.length >= 1);
  });

  // E8: approveTransition → returns session
  it('E8 approveTransition returns session', async () => {
    const created = await controller.createSession({ name: 'approve-test', projectId: 'proj-1' });
    const session = await controller.approveTransition(created.id);
    assert.ok(session.id);
  });
});
