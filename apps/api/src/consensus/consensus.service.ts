import { Injectable } from '@nestjs/common';
import { ConsensusEngine } from '@orchestra/consensus-engine';
import type { ConsensusInput } from '@orchestra/consensus-engine';
import type { ConsensusReport } from '@orchestra/domain';

@Injectable()
export class ConsensusService {
  private readonly engine = new ConsensusEngine();

  async run(input: ConsensusInput): Promise<ConsensusReport> {
    return this.engine.run(input);
  }
}
