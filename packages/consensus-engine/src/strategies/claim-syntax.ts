import type { RoleRef } from '@orchestra/domain';
import type { ClaimExtractionStrategy, RoleResponse, Claim, ClaimCategory } from '../types.js';

/**
 * Keyword-based claim categorization (case-insensitive substring match).
 * Priority order: architecture > implementation > research > risk > test.
 */
const CATEGORY_KEYWORDS: [ClaimCategory, string[]][] = [
  ['architecture', ['architecture', 'component', 'module', 'adr', 'pattern', 'layer']],
  ['implementation', ['implement', 'code', 'migration', 'schema', 'library']],
  ['research', ['research', 'benchmark', 'study', 'evidence', 'hypothesis']],
  ['risk', ['risk', 'threat', 'vulnerability', 'debt', 'concern']],
  ['test', ['test', 'spec', 'coverage', 'validate']],
];

function categorize(text: string): ClaimCategory | undefined {
  const lower = text.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }
  return undefined;
}

/**
 * MVP claim extraction: split by markdown headings/bullets, categorize by keywords.
 * Deterministic: id = `${role.id}#${index}`.
 *
 * Future (D-E1): embedding-based extraction.
 */
export class ClaimSyntaxStrategy implements ClaimExtractionStrategy {
  extract(roleResponse: RoleResponse): Claim[] {
    const { role, response } = roleResponse;
    const blocks = splitIntoBlocks(response.content);
    const claims: Claim[] = [];
    let index = 0;

    for (const block of blocks) {
      const text = block.trim();
      if (!text) continue;

      const category = categorize(text);
      if (!category) continue;

      claims.push({
        id: `${role.id}#${index}`,
        text,
        role,
        category,
      });
      index++;
    }

    return claims;
  }
}

function splitIntoBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line) || /^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      if (current.trim()) blocks.push(current);
      current = line;
    } else {
      current += '\n' + line;
    }
  }
  if (current.trim()) blocks.push(current);

  return blocks;
}
