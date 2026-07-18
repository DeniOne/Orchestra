import type { RoleResponse, Claim } from './types.js';
import { ClaimSyntaxStrategy } from './strategies/claim-syntax.js';

export class ClaimExtractor {
  constructor(private readonly strategy = new ClaimSyntaxStrategy()) {}

  extract(responses: RoleResponse[]): Claim[] {
    return responses.flatMap((r) => this.strategy.extract(r));
  }
}
