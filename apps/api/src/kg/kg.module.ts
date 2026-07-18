import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { KgService } from './kg.service.js';

@Module({
  providers: [PrismaService, KgService],
  exports: [KgService],
})
export class KgModule {}
