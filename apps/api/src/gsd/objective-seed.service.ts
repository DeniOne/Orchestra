import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { KgService } from '../kg/kg.service.js';

@Injectable()
export class ObjectiveSeedService implements OnModuleInit {
  private readonly logger = new Logger(ObjectiveSeedService.name);

  constructor(private readonly kg: KgService) {}

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.kg.getNode('stub-objective');
      if (existing) return;
      await this.kg.createNode({
        type: 'Goal',
        title: 'stub-objective',
        description: 'MVP seed objective (D-G1). Wave 8: real objective via UI.',
      });
      this.logger.log('Seeded stub-objective KgNode');
    } catch (e) {
      this.logger.warn(`Could not seed stub-objective: ${(e as Error).message}`);
    }
  }
}
