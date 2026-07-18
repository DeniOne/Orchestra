import { Injectable } from '@nestjs/common';
import type { AIProvider } from '@orchestra/domain';
import {
  ProviderRegistry,
  MockHttpPort,
  OpenAIAdapter,
  GLMAdapter,
  GeminiAdapter,
  MiMoAdapter,
} from '@orchestra/providers';

@Injectable()
export class ProviderRegistryService {
  readonly registry: ProviderRegistry;

  constructor() {
    this.registry = new ProviderRegistry();
    const http = new MockHttpPort();

    const openaiKey = process.env.OPENAI_API_KEY ?? '';
    const glmKey = process.env.GLM_API_KEY ?? '';
    const geminiKey = process.env.GEMINI_API_KEY ?? '';
    const mimoKey = process.env.MIMO_API_KEY ?? '';

    this.registry.registerWithId('openai', new OpenAIAdapter(http, openaiKey));
    this.registry.registerWithId('glm', new GLMAdapter(http, glmKey));
    this.registry.registerWithId('gemini', new GeminiAdapter(http, geminiKey));
    this.registry.registerWithId('mimo', new MiMoAdapter(http, mimoKey));
  }

  getProvider(id: string): AIProvider {
    return this.registry.get(id);
  }

  listProviders(): string[] {
    return this.registry.list();
  }
}
