import { Module } from '@nestjs/common';
import { PromptService } from './prompts.service.js';

@Module({
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptsModule {}
