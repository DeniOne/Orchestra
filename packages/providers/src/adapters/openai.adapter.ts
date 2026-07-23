import type { ContextPacket, Response } from '@orchestra/domain';
import { AIProviderBase } from '../provider-base.js';
import type { HttpPort, ProviderConfig } from '../types.js';
import crypto from 'node:crypto';

export class OpenAIAdapter extends AIProviderBase {
  constructor(http: HttpPort, apiKey: string, baseUrl?: string) {
    super(http, {
      id: 'openai',
      apiKey,
      baseUrl: baseUrl ?? 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
      prices: { inputPer1K: 0.0025, outputPer1K: 0.01 },
    });
  }

  async send(packet: ContextPacket): Promise<Response> {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    this.pending.set(requestId, controller);

    const body = {
      model: this.cfg.defaultModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: packet.systemPrompt },
        { role: 'user', content: packet.objective },
      ],
    };

    const res = await this.http.post(
      `${this.cfg.baseUrl}/chat/completions`,
      {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    );

    this.pending.delete(requestId);

    const json = res.json as { choices?: { message?: { content?: string } }[] };
    const content = json?.choices?.[0]?.message?.content ?? '';

    return { requestId, content, finishReason: 'stop' };
  }
}
