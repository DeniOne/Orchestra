import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Минимальный реестр системных промптов: читает .md из каталога.
 * Версия = sha256 содержимого.
 *
 * НЕ реализовано (заглушка):
 *  - hot-reload (FS-watcher) → будущая фаза
 *  - кэширование → read-per-call
 */
export class PromptRegistry {
  constructor(private readonly promptsDir: string) {}

  async getPrompt(roleId: string): Promise<{ content: string; version: string }> {
    const filePath = join(this.promptsDir, `${roleId}.md`);
    const content = await readFile(filePath, 'utf8');
    const version = await sha256(content);
    return { content, version };
  }
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
