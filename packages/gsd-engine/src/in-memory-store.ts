import type { Session, SessionId, Round } from '@orchestra/domain';
import type { SessionStorePort } from './types.js';

export class InMemorySessionStore implements SessionStorePort {
  private readonly sessions = new Map<SessionId, Session>();

  async create(session: Session): Promise<void> {
    this.sessions.set(session.id, { ...session, rounds: [...session.rounds] });
  }

  async get(sessionId: SessionId): Promise<Session | null> {
    const s = this.sessions.get(sessionId);
    return s ? { ...s, rounds: [...s.rounds] } : null;
  }

  async update(session: Session): Promise<void> {
    this.sessions.set(session.id, { ...session, rounds: [...session.rounds] });
  }

  async listRounds(sessionId: SessionId): Promise<Round[]> {
    const s = this.sessions.get(sessionId);
    return s ? [...s.rounds] : [];
  }
}
