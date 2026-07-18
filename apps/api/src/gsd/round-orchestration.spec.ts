import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySessionStore } from '@orchestra/gsd-engine';
import { RoundOrchestratorGatingAdapter } from './round-orchestrator-gating.adapter.js';
import type { GSDPhase, RoleManifest, Response, ConsensusReport, Session, ContextPacket } from '@orchestra/domain';
import type { ConsensusInput } from '@orchestra/consensus-engine';
import type { BuildPacketRequest } from '@orchestra/context-service';
import type { RouteResult } from '@orchestra/role-router';

const ARCHITECT_MANIFEST: RoleManifest = {
  id: 'architect',
  displayName: 'Architect',
  provider: 'openai',
  model: 'gpt-4o',
  responsibilities: ['design system architecture'],
  allowedOutputs: ['Architecture'],
  contextPolicy: { profile: 'architect', max_tokens: 32000 },
  generation: { temperature: 0.2, systemPromptRef: 'prompts/architect.md' },
  activePhases: ['Architecture', 'Implementation', 'Review'],
};

const TECH_LEAD_MANIFEST: RoleManifest = {
  id: 'tech_lead',
  displayName: 'Tech Lead',
  provider: 'openai',
  model: 'gpt-4o',
  responsibilities: ['technical decisions'],
  allowedOutputs: ['Decision'],
  contextPolicy: { profile: 'tech_lead', max_tokens: 32000 },
  generation: { temperature: 0.2, systemPromptRef: 'prompts/tech_lead.md' },
  activePhases: ['Architecture', 'Implementation', 'Review'],
};

const RESEARCHER_MANIFEST: RoleManifest = {
  id: 'researcher',
  displayName: 'Researcher',
  provider: 'openai',
  model: 'gpt-4o',
  responsibilities: ['research'],
  allowedOutputs: ['Research'],
  contextPolicy: { profile: 'researcher', max_tokens: 32000 },
  generation: { temperature: 0.2, systemPromptRef: 'prompts/researcher.md' },
  activePhases: ['Discover', 'Goal', 'Specification'],
};

const CRITIC_MANIFEST: RoleManifest = {
  id: 'critic',
  displayName: 'Critic',
  provider: 'openai',
  model: 'gpt-4o',
  responsibilities: ['critique'],
  allowedOutputs: ['Review'],
  contextPolicy: { profile: 'critic', max_tokens: 32000 },
  generation: { temperature: 0.2, systemPromptRef: 'prompts/critic.md' },
  // no activePhases → fallback: active everywhere
};

const ALL_MANIFESTS = [ARCHITECT_MANIFEST, TECH_LEAD_MANIFEST, RESEARCHER_MANIFEST, CRITIC_MANIFEST];

function makeManifestStub(manifests: RoleManifest[]) {
  return {
    async get(roleId: string) { return manifests.find(m => m.id === roleId) ?? null; },
    async list() { return manifests.map(m => m.id); },
  };
}

function makeContextStub() {
  let callCount = 0;
  return {
    callCount: () => callCount,
    async buildPacket(req: BuildPacketRequest): Promise<ContextPacket> {
      callCount++;
      const now = new Date().toISOString();
      return {
        sessionId: req.sessionId,
        projectId: req.projectId,
        roundId: req.roundId,
        phase: req.phase,
        role: { id: req.roleId, displayName: req.roleId, responsibilities: [] },
        objective: req.objective,
        relevantDecisions: [],
        openQuestions: [],
        knownRisks: [],
        constraints: [],
        artifacts: [],
        conversationSummary: '',
        systemPrompt: `prompt for ${req.roleId}`,
        expectedOutput: { type: 'Architecture' },
        outputFormat: 'markdown',
        builtAt: now,
        modelTarget: 'gpt-4o',
        contextPolicyId: req.roleId,
        contentHash: `hash-${req.roleId}-${Date.now()}`,
      };
    },
  };
}

function makeRouterStub() {
  let callCount = 0;
  return {
    callCount: () => callCount,
    async route(): Promise<RouteResult> {
      callCount++;
      const response: Response = {
        requestId: `req-${callCount}`,
        content: `response ${callCount}`,
        finishReason: 'stop',
      };
      return { response, providerId: 'openai', latencyMs: 100 };
    },
  };
}

function makeConsensusStub(verdict: 'pass' | 'fail' = 'pass') {
  let callCount = 0;
  let lastInput: ConsensusInput | undefined;
  return {
    callCount: () => callCount,
    lastInput: () => lastInput,
    async run(input: ConsensusInput): Promise<ConsensusReport> {
      callCount++;
      lastInput = input;
      return {
        id: `report-${input.roundId}`,
        roundId: input.roundId,
        summary: `Consensus for ${input.phase}`,
        agreedDecisions: [],
        disagreements: verdict === 'fail' ? [{ id: 'c1', topic: 'conflict', positions: [] }] : [],
        openQuestions: [],
        risks: [],
        nextAction: verdict === 'pass' ? `transition from ${input.phase}` : `iterate: gaps in ${input.phase}`,
        confidence: {
          architecture: 0.8,
          implementation: 0.7,
          researchCoverage: 0.9,
          riskCoverage: 0.6,
          testCoverage: 0.5,
          overall: verdict === 'pass' ? 0.8 : 0.3,
        },
        gatingVerdict: verdict,
      };
    },
  };
}

async function seedSession(store: InMemorySessionStore, opts: {
  sessionId: string;
  phase: GSDPhase;
  roundPhase?: GSDPhase;
}) {
  const now = new Date().toISOString();
  const session: Session = {
    id: opts.sessionId,
    name: 'test-feature',
    projectId: 'proj-1',
    currentPhase: opts.phase,
    rounds: opts.roundPhase ? [{
      id: `round-${opts.sessionId}-1`,
      sessionId: opts.sessionId,
      number: 1,
      phase: opts.roundPhase,
      status: 'in_progress',
      startedAt: now,
    }] : [],
    createdAt: now,
    updatedAt: now,
  };
  await store.create(session);
}

describe('RoundOrchestratorGatingAdapter', () => {
  // T1: evaluate with active roles → orchestration calls
  it('T1: evaluate orchestrates Context→Router→Consensus for active roles', async () => {
    const store = new InMemorySessionStore();
    await seedSession(store, { sessionId: 's1', phase: 'Architecture', roundPhase: 'Architecture' });

    const manifestStub = makeManifestStub(ALL_MANIFESTS);
    const contextStub = makeContextStub();
    const routerStub = makeRouterStub();
    const consensusStub = makeConsensusStub('pass');

    const adapter = new RoundOrchestratorGatingAdapter(
      contextStub as any,
      routerStub as any,
      consensusStub as any,
      manifestStub as any,
      store,
    );

    const result = await adapter.evaluate('s1', 'Architecture');

    assert.equal(result.verdict, 'pass');
    assert.equal(result.phase, 'Architecture');

    // architect + tech_lead + critic (fallback) = 3 roles in Architecture
    assert.equal(contextStub.callCount(), 3);
    assert.equal(routerStub.callCount(), 3);
    assert.equal(consensusStub.callCount(), 1);

    const input = consensusStub.lastInput()!;
    assert.equal(input.responses.length, 3);
    assert.equal(input.roundId, 'round-s1-1');
  });

  // T2: filter roles by phase
  it('T2: filters roles by activePhases — researcher excluded from Architecture', async () => {
    const store = new InMemorySessionStore();
    await seedSession(store, { sessionId: 's2', phase: 'Architecture', roundPhase: 'Architecture' });

    const manifestStub = makeManifestStub(ALL_MANIFESTS);
    const contextStub = makeContextStub();
    const routerStub = makeRouterStub();
    const consensusStub = makeConsensusStub('pass');

    const adapter = new RoundOrchestratorGatingAdapter(
      contextStub as any,
      routerStub as any,
      consensusStub as any,
      manifestStub as any,
      store,
    );

    await adapter.evaluate('s2', 'Architecture');

    const input = consensusStub.lastInput()!;
    const roleIds = input.responses.map(r => r.role.id);
    assert.ok(roleIds.includes('architect'));
    assert.ok(roleIds.includes('tech_lead'));
    assert.ok(roleIds.includes('critic'));
    assert.ok(!roleIds.includes('researcher'));
  });

  // T3: fallback critic active in any phase
  it('T3: fallback critic active in Consensus phase (no activePhases)', async () => {
    const store = new InMemorySessionStore();
    await seedSession(store, { sessionId: 's3', phase: 'Consensus', roundPhase: 'Consensus' });

    const manifestStub = makeManifestStub([CRITIC_MANIFEST]);
    const contextStub = makeContextStub();
    const routerStub = makeRouterStub();
    const consensusStub = makeConsensusStub('fail');

    const adapter = new RoundOrchestratorGatingAdapter(
      contextStub as any,
      routerStub as any,
      consensusStub as any,
      manifestStub as any,
      store,
    );

    const result = await adapter.evaluate('s3', 'Consensus');

    assert.equal(result.verdict, 'fail');
    assert.equal(contextStub.callCount(), 1);

    const input = consensusStub.lastInput()!;
    assert.equal(input.responses.length, 1);
    assert.equal(input.responses[0].role.id, 'critic');
  });

  // T4: no active round → fail with gap
  it('T4: no active round → verdict=fail with gap message', async () => {
    const store = new InMemorySessionStore();
    await seedSession(store, { sessionId: 's4', phase: 'Architecture', roundPhase: 'Discover' });

    const manifestStub = makeManifestStub(ALL_MANIFESTS);
    const contextStub = makeContextStub();
    const routerStub = makeRouterStub();
    const consensusStub = makeConsensusStub('pass');

    const adapter = new RoundOrchestratorGatingAdapter(
      contextStub as any,
      routerStub as any,
      consensusStub as any,
      manifestStub as any,
      store,
    );

    const result = await adapter.evaluate('s4', 'Architecture');

    assert.equal(result.verdict, 'fail');
    assert.deepEqual(result.gaps, ['no active round for phase']);
    assert.equal(contextStub.callCount(), 0);
    assert.equal(consensusStub.callCount(), 0);
  });

  // T5: gaps from disagreements/openQuestions
  it('T5: maps ConsensusReport disagreements/openQuestions to gaps', async () => {
    const store = new InMemorySessionStore();
    await seedSession(store, { sessionId: 's5', phase: 'Discover', roundPhase: 'Discover' });

    const manifestStub = makeManifestStub([RESEARCHER_MANIFEST]);
    const contextStub = makeContextStub();
    const routerStub = makeRouterStub();

    let callCount = 0;
    const consensusStub = {
      callCount: () => callCount,
      lastInput: () => undefined as any,
      async run(input: ConsensusInput): Promise<ConsensusReport> {
        callCount++;
        return {
          id: `report-${input.roundId}`,
          roundId: input.roundId,
          summary: 'test',
          agreedDecisions: [],
          disagreements: [
            { id: 'd1', topic: 'topic-a', positions: [] },
            { id: 'd2', topic: 'topic-b', positions: [] },
          ],
          openQuestions: [{ id: 'q1', text: 'what?' }],
          risks: [],
          nextAction: 'iterate: gaps',
          confidence: { architecture: 0.5, implementation: 0.5, researchCoverage: 0.5, riskCoverage: 0.5, testCoverage: 0.5, overall: 0.5 },
          gatingVerdict: 'fail',
        };
      },
    };

    const adapter = new RoundOrchestratorGatingAdapter(
      contextStub as any,
      routerStub as any,
      consensusStub as any,
      manifestStub as any,
      store,
    );

    const result = await adapter.evaluate('s5', 'Discover');

    assert.equal(result.verdict, 'fail');
    assert.ok(result.gaps.some(g => g.includes('2 disagreement')));
    assert.ok(result.gaps.some(g => g.includes('1 open question')));
  });
});
