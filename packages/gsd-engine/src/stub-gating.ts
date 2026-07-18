import type { SessionId, GSDPhase } from '@orchestra/domain';
import type { GatingPort, GatingResult } from './types.js';

export class StubGating implements GatingPort {
  async evaluate(_sessionId: SessionId, phase: GSDPhase): Promise<GatingResult> {
    return { verdict: 'pass', gaps: [], phase };
  }
}
