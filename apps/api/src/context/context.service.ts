import { Injectable } from '@nestjs/common';
import { KgService } from '../kg/kg.service.js';
import { PromptService } from '../prompts/prompts.service.js';
import {
  buildPacket,
  type KgGraphPort,
  type PromptPort,
  type BuildPacketRequest,
} from '@orchestra/context-service';
import type { ContextPacket, KgNodeType } from '@orchestra/domain';

@Injectable()
class KgGraphAdapter implements KgGraphPort {
  constructor(private readonly kg: KgService) {}
  async getNode(id: string) {
    return this.kg.getNode(id);
  }
  async getNeighbors(nodeId: string, direction?: 'in' | 'out' | 'both') {
    return this.kg.getNeighbors(nodeId, direction);
  }
  async listNodes(type?: KgNodeType) {
    return this.kg.listNodes(type);
  }
}

@Injectable()
class PromptAdapter implements PromptPort {
  constructor(private readonly prompts: PromptService) {}
  async getPrompt(roleId: string) {
    return this.prompts.getPrompt(roleId);
  }
}

@Injectable()
export class ContextService {
  private readonly graph: KgGraphAdapter;
  private readonly prompts: PromptAdapter;

  constructor(
    private readonly kg: KgService,
    private readonly promptService: PromptService,
  ) {
    this.graph = new KgGraphAdapter(this.kg);
    this.prompts = new PromptAdapter(this.promptService);
  }

  async buildPacket(req: BuildPacketRequest): Promise<ContextPacket> {
    return buildPacket(req, this.graph, this.prompts);
  }
}
