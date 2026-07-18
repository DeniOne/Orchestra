import type { GSDPhase } from './gsd.js';
import type { OutputType } from './context.js';

export interface RoleManifest {
  id: string;
  displayName: string;
  provider: string;
  model: string;

  responsibilities: string[];
  allowedOutputs: OutputType[];

  contextPolicy: {
    profile: string;
    max_tokens: number;
  };

  generation: {
    temperature: number;
    systemPromptRef: string;
  };

  activePhases?: GSDPhase[];
}

export interface ProviderHealth {
  status: 'up' | 'degraded' | 'down';
  latencyMs: number;
  rateLimitRemaining?: number;
}

export interface Response {
  requestId: string;
  content: string;
  finishReason: string;
}

export interface Token {
  requestId: string;
  delta: string;
}

export interface AIProvider {
  send(packet: import('./context.js').ContextPacket): Promise<Response>;
  stream(packet: import('./context.js').ContextPacket): AsyncIterable<Token>;
  cancel(requestId: string): Promise<void>;
  estimateTokens(packet: import('./context.js').ContextPacket): Promise<number>;
  estimateCost(packet: import('./context.js').ContextPacket): Promise<number>;
  health(): Promise<ProviderHealth>;
}

export type PluginType =
  | 'AI Provider'
  | 'Context Provider'
  | 'Consensus Strategy'
  | 'Knowledge Extractor'
  | 'Exporter'
  | 'Reviewer'
  | 'Notification Provider'
  | 'GSD Phase Extension';

export interface Plugin {
  id: string;
  name: string;
  version: string;
  type: PluginType;

  initialize(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AIProviderPlugin extends Plugin {
  type: 'AI Provider';
  provider: AIProvider;
}
