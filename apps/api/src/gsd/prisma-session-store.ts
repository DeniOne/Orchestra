import { Injectable, Logger } from '@nestjs/common';
import type { Session, SessionId, Round } from '@orchestra/domain';
import type { GSDPhase } from '@orchestra/domain';
import type { SessionStorePort } from '@orchestra/gsd-engine';
import { PrismaService } from '../prisma.service.js';
import type { Prisma } from '@prisma/client';

/**
 * Prisma-backed impl of SessionStorePort.
 *
 * Заменяет InMemorySessionStore в GsdEngineService. Сессии persist'ятся в PostgreSQL, переживают
 * рестарт API. Соответствует Architecture §3 Decision Repository = PostgreSQL.
 *
 * Полный switch (не dual-write): SessionStore — critical-path GSD. Dual-write = inconsistency
 * risk. При БД-down API валидно падает на session operation (понятная ошибка, не silent loss).
 *
 * rounds хранятся как embedded Json (aggregate root pattern), не separate table. Соответствует
 * DomainEventRecord.payload pattern (Phase 8d-1).
 */
@Injectable()
export class PrismaSessionStore implements SessionStorePort {
  private readonly logger = new Logger(PrismaSessionStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(session: Session): Promise<void> {
    await this.prisma.sessionRecord.create({
      data: {
        id: session.id,
        name: session.name,
        projectId: session.projectId,
        currentPhase: session.currentPhase,
        rounds: session.rounds as unknown as Prisma.InputJsonValue,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      },
    });
  }

  async get(sessionId: SessionId): Promise<Session | null> {
    const record = await this.prisma.sessionRecord.findUnique({
      where: { id: sessionId },
    });
    if (!record) return null;
    return this.toSession(record);
  }

  async update(session: Session): Promise<void> {
    await this.prisma.sessionRecord.update({
      where: { id: session.id },
      data: {
        name: session.name,
        projectId: session.projectId,
        currentPhase: session.currentPhase,
        rounds: session.rounds as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(session.updatedAt),
      },
    });
  }

  async listRounds(sessionId: SessionId): Promise<Round[]> {
    const record = await this.prisma.sessionRecord.findUnique({
      where: { id: sessionId },
      select: { rounds: true },
    });
    return record ? (record.rounds as unknown as Round[]) : [];
  }

  /**
   * Список всех сессий (для listSessions в GsdEngineService).
   * Заменяет knownSessionIds Set workaround из Phase 8b-02.
   */
  async list(): Promise<Session[]> {
    const records = await this.prisma.sessionRecord.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((r) => this.toSession(r));
  }

  private toSession(record: {
    id: string;
    name: string;
    projectId: string;
    currentPhase: string;
    rounds: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): Session {
    return {
      id: record.id,
      name: record.name,
      projectId: record.projectId,
      currentPhase: record.currentPhase as GSDPhase,
      rounds: record.rounds as unknown as Round[],
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
