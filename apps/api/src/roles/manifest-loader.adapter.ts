import { Injectable } from '@nestjs/common';
import type { RoleManifest } from '@orchestra/domain';
import type { RoleRegistryPort } from '@orchestra/role-router';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * ManifestLoader adapter: reads role-manifests/*.yaml from root.
 * Parses YAML inline (simple format, no external yaml parser needed
 * for seed manifests — key: value only).
 */
@Injectable()
export class ManifestLoaderAdapter implements RoleRegistryPort {
  private manifests = new Map<string, RoleManifest>();
  private loaded = false;

  async get(roleId: string): Promise<RoleManifest | null> {
    await this.ensureLoaded();
    return this.manifests.get(roleId) ?? null;
  }

  async list(): Promise<string[]> {
    await this.ensureLoaded();
    return Array.from(this.manifests.keys());
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const dir = resolve(process.cwd(), '../../role-manifests');
    const files = ['architect.yaml', 'tech_lead.yaml', 'researcher.yaml', 'critic.yaml', 'engineer.yaml'];
    for (const file of files) {
      try {
        const content = await readFile(resolve(dir, file), 'utf8');
        const manifest = parseYamlManifest(content);
        if (manifest) this.manifests.set(manifest.id, manifest);
      } catch {
        // file not found — skip
      }
    }
    this.loaded = true;
  }
}

/** Simple YAML parser for flat manifest format. */
function parseYamlManifest(content: string): RoleManifest | null {
  const lines = content.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  const record: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) record[match[1]] = match[2].trim();
  }
  if (!record.id) return null;

  return {
    id: record.id,
    displayName: record.displayName ?? record.id,
    provider: record.provider ?? 'openai',
    model: record.model ?? 'gpt-4o',
    responsibilities: parseList(record.responsibilities),
    allowedOutputs: parseList(record.allowedOutputs) as RoleManifest['allowedOutputs'],
    contextPolicy: {
      profile: record.contextPolicy_profile ?? record.id,
      max_tokens: parseInt(record.contextPolicy_maxTokens ?? '32000', 10),
    },
    generation: {
      temperature: parseFloat(record.generation_temperature ?? '0.2'),
      systemPromptRef: record.generation_systemPromptRef ?? `prompts/${record.id}.md`,
    },
    activePhases: record.activePhases ? parseList(record.activePhases) as RoleManifest['activePhases'] : undefined,
  };
}

function parseList(val: string | undefined): string[] {
  if (!val) return [];
  return val.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}
