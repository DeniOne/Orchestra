import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type {
  KgNodeType,
  KgRelationshipType,
  KgNodeData,
  KgRelationshipData,
} from '@orchestra/domain';
import type { Prisma } from '@prisma/client';

@Injectable()
export class KgService {
  constructor(private readonly prisma: PrismaService) {}

  async createNode(data: {
    type: KgNodeType;
    title: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): Promise<KgNodeData> {
    const node = await this.prisma.kgNode.create({
      data: {
        type: data.type,
        title: data.title,
        description: data.description,
        metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return {
      id: node.id,
      type: node.type as KgNodeType,
      title: node.title,
      description: node.description ?? undefined,
      metadata: node.metadata as Record<string, unknown> | undefined,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    };
  }

  async getNode(id: string): Promise<KgNodeData | null> {
    const node = await this.prisma.kgNode.findUnique({ where: { id } });
    if (!node) return null;
    return {
      id: node.id,
      type: node.type as KgNodeType,
      title: node.title,
      description: node.description ?? undefined,
      metadata: node.metadata as Record<string, unknown> | undefined,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    };
  }

  async listNodes(type?: KgNodeType): Promise<KgNodeData[]> {
    const nodes = await this.prisma.kgNode.findMany({
      where: type ? { type } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return nodes.map((node) => ({
      id: node.id,
      type: node.type as KgNodeType,
      title: node.title,
      description: node.description ?? undefined,
      metadata: node.metadata as Record<string, unknown> | undefined,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    }));
  }

  async createRelationship(data: {
    type: KgRelationshipType;
    sourceId: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<KgRelationshipData> {
    const rel = await this.prisma.kgRelationship.create({
      data: {
        type: data.type,
        sourceId: data.sourceId,
        targetId: data.targetId,
        metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return {
      id: rel.id,
      type: rel.type as KgRelationshipType,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      metadata: rel.metadata as Record<string, unknown> | undefined,
      createdAt: rel.createdAt.toISOString(),
    };
  }

  async getNeighbors(
    nodeId: string,
    direction: 'in' | 'out' | 'both' = 'both',
  ): Promise<KgNodeData[]> {
    const promises: Promise<KgNodeData[]>[] = [];

    if (direction === 'out' || direction === 'both') {
      promises.push(
        this.prisma.kgRelationship
          .findMany({ where: { sourceId: nodeId }, include: { target: true } })
          .then((rels) =>
            rels.map((r) => ({
              id: r.target.id,
              type: r.target.type as KgNodeType,
              title: r.target.title,
              description: r.target.description ?? undefined,
              metadata: r.target.metadata as Record<string, unknown> | undefined,
              createdAt: r.target.createdAt.toISOString(),
              updatedAt: r.target.updatedAt.toISOString(),
            })),
          ),
      );
    }

    if (direction === 'in' || direction === 'both') {
      promises.push(
        this.prisma.kgRelationship
          .findMany({ where: { targetId: nodeId }, include: { source: true } })
          .then((rels) =>
            rels.map((r) => ({
              id: r.source.id,
              type: r.source.type as KgNodeType,
              title: r.source.title,
              description: r.source.description ?? undefined,
              metadata: r.source.metadata as Record<string, unknown> | undefined,
              createdAt: r.source.createdAt.toISOString(),
              updatedAt: r.source.updatedAt.toISOString(),
            })),
          ),
      );
    }

    const results = await Promise.all(promises);
    return results.flat();
  }
}
