import type { ContextPacket } from '@orchestra/domain';

export interface HttpPort {
  post(url: string, headers: Record<string, string>, body: unknown): Promise<HttpResponse>;
}

export interface HttpResponse {
  status: number;
  json: unknown;
  text: string;
}

export interface ProviderConfig {
  id: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  prices: { inputPer1K: number; outputPer1K: number };
}

export interface PendingRequest {
  requestId: string;
  controller: AbortController;
}
