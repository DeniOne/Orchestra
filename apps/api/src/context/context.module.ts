import { Module } from '@nestjs/common';
import { KgModule } from '../kg/kg.module.js';
import { PromptsModule } from '../prompts/prompts.module.js';
import { ContextService } from './context.service.js';

@Module({
  imports: [KgModule, PromptsModule],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
