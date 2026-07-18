import type { ContextPacket, Response, Token, ProviderHealth, AIProvider } from '@orchestra/domain';
import type { HttpPort, ProviderConfig } from './types.js';
import { countTokens } from './token-counter.js';

/**
 * Base class for AIProvider adapters.
 * Implements send/stream/cancel/estimateTokens/estimateCost/health
 * using HttpPort for network abstraction.
 */
export abstract class AIProviderBase implements AIProvider {
  protected pending = new Map<string, AbortController>();

  constructor(
    protected readonly http: HttpPort,
    protected readonly cfg: ProviderConfig,
  ) {}

  abstract send(packet: ContextPacket): Promise<Response>;

  /**
   * Wave 4: stream is chunking over send (yield Token chunks).
   * Real SSE from provider — Wave 5 (D-D3).
   */
  async *stream(packet: ContextPacket): AsyncIterable<Token> {
    const response = await this.send(packet);
    const content = response.content;
    const chunkSize = 4;
    for (let i = 0; i < content.length; i += chunkSize) {
      yield { requestId: response.requestId, delta: content.slice(i, i + chunkSize) };
      await new Promise((r) => setImmediate(r));
    }
  }

  async cancel(requestId: string): Promise<void> {
    const entry = this.pending.get(requestId);
    if (entry) {
      entry.abort();
      this.pending.delete(requestId);
    }
  }

  async estimateTokens(packet: ContextPacket): Promise<number> {
    return countTokens(packet.systemPrompt + packet.objective);
  }

  async estimateCost(packet: ContextPacket): Promise<number> {
    const inputTokens = await this.estimateTokens(packet);
    const outputTokens = Math.ceil(inputTokens * 0.5);
    const inputCost = (inputTokens / 1000) * this.cfg.prices.inputPer1K;
    const outputCost = (outputTokens / 1000) * this.cfg.prices.outputPer1K;
    return inputCost + outputCost;
  }

  async health(): Promise<ProviderHealth> {
    if (!this.cfg.apiKey) {
      return { status: 'degraded', latencyMs: 0 };
    }
    return { status: 'up', latencyMs: 0 };
  }
}
