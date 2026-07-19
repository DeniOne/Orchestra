import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient wrapper с LAZY-connect.
 *
 * НЕ реализует OnModuleInit с $connect() — это позволяет apps/api стартовать
 * без живой PostgreSQL. Connect происходит автоматически при первом запросе
 * к БД (PrismaClient internals). OnModuleDestroy остаётся — чистый $disconnect
 * при graceful shutdown.
 *
 * Архитектурное обоснование: SessionsController Phase 8 работает на
 * InMemorySessionStore (GsdEngineService), БД нужна только для KgService
 * (knowledge graph), который НЕ вызывается из HTTP-API Phase 8. Делать
 * bootstrap зависимым от БД — ломает dev-цикл и success-criterion Phase 8 §9 п.5.
 *
 * Phase 8d (Prisma persistence, D-F1) пересмотрит этот подход — когда
 * SessionStore станет Prisma-backed, connect-on-init может вернуться.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
