import { Injectable } from '@nestjs/common';
import { PromptRegistry } from '@orchestra/prompt-registry';
import { resolve } from 'node:path';

@Injectable()
export class PromptService {
  private readonly registry: PromptRegistry;

  constructor() {
    const promptsDir = resolve(process.cwd(), '../../prompts');
    this.registry = new PromptRegistry(promptsDir);
  }

  async getPrompt(roleId: string): Promise<{ content: string; version: string }> {
    return this.registry.getPrompt(roleId);
  }
}
