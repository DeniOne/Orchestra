import type { SessionId } from '@orchestra/domain';
import type { AuditPort, AuditRecord } from './types.js';

export class InMemoryAuditLog implements AuditPort {
  private readonly records: AuditRecord[] = [];
  private counter = 0;

  async record(entry: Omit<AuditRecord, 'id' | 'occurredAt'> & { id?: string }): Promise<AuditRecord> {
    const id = entry.id ?? `audit-${entry.sessionId}-${this.counter++}`;
    const record: AuditRecord = {
      id,
      sessionId: entry.sessionId,
      phase: entry.phase,
      reason: entry.reason,
      occurredAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async list(sessionId: SessionId): Promise<AuditRecord[]> {
    return this.records.filter(r => r.sessionId === sessionId);
  }
}
