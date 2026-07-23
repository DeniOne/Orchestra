import type { ContextPacket, Response } from '@orchestra/domain';
import { AIProviderBase } from '../provider-base.js';
import type { HttpPort, ProviderConfig } from '../types.js';
import crypto from 'node:crypto';

export class GeminiAdapter extends AIProviderBase {
  constructor(http: HttpPort, apiKey: string, baseUrl?: string) {
    super(http, {
      id: 'gemini',
      apiKey,
      baseUrl: baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-1.5-pro',
      prices: { inputPer1K: 0.00125, outputPer1K: 0.005 },
    });
  }

  async send(packet: ContextPacket): Promise<Response> {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    this.pending.set(requestId, controller);

    const body = {
      contents: [
        { role: 'user', parts: [{ text: packet.systemPrompt + '\n\n' + packet.objective }] },
      ],
      generationConfig: { temperature: 0.2 },
    };

    const res = await this.http.post(
      `${this.cfg.baseUrl}/models/${packet.modelTarget ?? this.cfg.defaultModel}:generateContent?key=${this.cfg.apiKey}`,
      { 'Content-Type': 'application/json' },
      body,
    );

    this.pending.delete(requestId);

    const json = res.json as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const content = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    return { requestId, content, finishReason: 'stop' };
  }
}
