import { Injectable, Logger } from '@nestjs/common';
import type { HttpPort, HttpResponse } from '@orchestra/providers';

/**
 * Реальный HTTP impl of HttpPort через native fetch (Node 18+).
 *
 * Заменяет MockHttpPort в production. Адаптеры (OpenAI/GLM/Gemini/MiMo) используют этот port
 * для сетевых запросов к LLM API.
 *
 * Error handling: при network error (timeout, DNS, connection refused) — выбрасывает Error
 * с понятным сообщением. Adapter ловит и возвращает Response с finishReason 'error'.
 *
 * Timeout: 30 секунд (override через LLM_TIMEOUT_MS env). LLM responses могут быть медленными,
 * 30 сек — разумный default. Production tuning — Wave 9+.
 */
@Injectable()
export class FetchHttpPort implements HttpPort {
  private readonly logger = new Logger(FetchHttpPort.name);
  private readonly timeoutMs: number;

  constructor() {
    this.timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30000);
  }

  async post(url: string, headers: Record<string, string>, body: unknown): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'User-Agent': 'Orchestra/1.0' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!res.ok) {
        this.logger.error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
      }

      return { status: res.status, json, text };
    } catch (e) {
      const msg = (e as Error).name === 'AbortError'
        ? `Request timeout after ${this.timeoutMs}ms: ${url}`
        : `Network error: ${(e as Error).message}`;
      this.logger.error(msg);
      throw new Error(msg);
    } finally {
      clearTimeout(timeout);
    }
  }
}
