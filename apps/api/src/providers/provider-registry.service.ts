import { Injectable } from '@nestjs/common';
import type { AIProvider } from '@orchestra/domain';
import {
  ProviderRegistry,
  OpenAIAdapter,
  GLMAdapter,
  GeminiAdapter,
  MiMoAdapter,
} from '@orchestra/providers';
import { FetchHttpPort } from './fetch-http.js';

@Injectable()
export class ProviderRegistryService {
  readonly registry: ProviderRegistry;

  constructor() {
    this.registry = new ProviderRegistry();
    const http = new FetchHttpPort();

    const openaiKey = process.env.OPENAI_API_KEY ?? '';
    const glmKey = process.env.GLM_API_KEY ?? '';
    const geminiKey = process.env.GEMINI_API_KEY ?? '';
    const mimoKey = process.env.MIMO_API_KEY ?? '';

    this.registry.registerWithId('openai', new OpenAIAdapter(http, openaiKey, process.env.OPENAI_BASE_URL));
    this.registry.registerWithId('glm', new GLMAdapter(http, glmKey, process.env.GLM_BASE_URL));
    this.registry.registerWithId('gemini', new GeminiAdapter(http, geminiKey, process.env.GEMINI_BASE_URL));
    this.registry.registerWithId('mimo', new MiMoAdapter(http, mimoKey, process.env.MIMO_BASE_URL));
  }

  getProvider(id: string): AIProvider {
    return this.registry.get(id);
  }

  listProviders(): string[] {
    return this.registry.list();
  }
}
