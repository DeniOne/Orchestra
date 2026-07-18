import type { AIProvider } from '@orchestra/domain';

export class UnknownProviderError extends Error {
  constructor(id: string) {
    super(`Unknown provider: ${id}`);
    this.name = 'UnknownProviderError';
  }
}

export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    this.providers.set(provider.constructor.name.toLowerCase().replace('adapter', ''), provider);
  }

  registerWithId(id: string, provider: AIProvider): void {
    this.providers.set(id, provider);
  }

  get(id: string): AIProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new UnknownProviderError(id);
    return provider;
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}
