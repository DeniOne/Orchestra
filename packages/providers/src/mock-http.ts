import type { HttpPort, HttpResponse } from './types.js';

/**
 * Deterministic mock for testing/CI without API keys.
 * Returns a fixed response for any request.
 */
export class MockHttpPort implements HttpPort {
  async post(_url: string, _headers: Record<string, string>, _body: unknown): Promise<HttpResponse> {
    return {
      status: 200,
      json: {
        choices: [
          {
            message: {
              content: '[Mock response] This is a deterministic stub from MockHttpPort.',
            },
          },
        ],
      },
      text: JSON.stringify({
        choices: [
          {
            message: {
              content: '[Mock response] This is a deterministic stub from MockHttpPort.',
            },
          },
        ],
      }),
    };
  }
}
