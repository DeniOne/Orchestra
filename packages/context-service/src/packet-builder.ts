import type {
  ContextPacket,
  KgNodeData,
  ISO8601,
} from '@orchestra/domain';
import type {
  BuildPacketRequest,
  KgGraphPort,
  PromptPort,
} from './types.js';
import { extractSubgraph } from './subgraph-extractor.js';
import { applyPolicy, getPolicy } from './context-policy.js';

/**
 * Собирает ContextPacket для роли.
 * Pipeline: extractSubgraph → applyPolicy → budget cutoff → assemble.
 * См. Context Protocol.md §1, §4.
 */
export async function buildPacket(
  req: BuildPacketRequest,
  graph: KgGraphPort,
  prompts: PromptPort,
): Promise<ContextPacket> {
  const policy = getPolicy(req.roleId);
  const startNode = req.objectiveNodeId;
  if (!startNode) {
    throw new Error(
      'packet-builder: objectiveNodeId is required (objective-string lookup not implemented in this phase)',
    );
  }

  const subgraph = await extractSubgraph(graph, startNode, policy);
  const filtered = applyPolicy(subgraph, policy);
  const budgeted = applyTokenBudget(filtered, policy.maxTokens);
  const fields = collectPacketFields(budgeted);
  const prompt = await prompts.getPrompt(req.roleId);

  const builtAt: ISO8601 = new Date().toISOString();
  const modelTarget = req.model ?? resolveModelTarget(req.roleId);

  const packet: ContextPacket = {
    sessionId: req.sessionId,
    projectId: req.projectId,
    roundId: req.roundId,
    phase: req.phase,
    role: { id: req.roleId, displayName: req.roleId, responsibilities: [] },
    objective: req.objective,
    relevantDecisions: fields.decisions,
    openQuestions: fields.questions,
    knownRisks: fields.risks,
    constraints: fields.constraints,
    artifacts: fields.artifacts,
    conversationSummary: '',
    systemPrompt: prompt.content,
    expectedOutput: { type: 'Review' },
    outputFormat: 'markdown',
    builtAt,
    modelTarget,
    contextPolicyId: `${policy.roleId}@v1`,
    contentHash: '',
  };

  packet.contentHash = await computeContentHash(packet);
  return packet;
}

function applyTokenBudget(nodes: KgNodeData[], maxTokens: number): KgNodeData[] {
  const maxChars = maxTokens * 4;
  let used = 0;
  const out: KgNodeData[] = [];
  for (const node of nodes) {
    const nodeChars = estimateNodeChars(node);
    if (used + nodeChars > maxChars) break;
    out.push(node);
    used += nodeChars;
  }
  return out;
}

function estimateNodeChars(node: KgNodeData): number {
  return node.title.length + (node.description?.length ?? 0);
}

function collectPacketFields(nodes: KgNodeData[]): {
  decisions: { id: string; version: string }[];
  questions: { id: string }[];
  risks: { id: string }[];
  constraints: { id: string; description: string; source?: string }[];
  artifacts: { id: string; type: string; version: string }[];
} {
  const decisions: { id: string; version: string }[] = [];
  const questions: { id: string }[] = [];
  const risks: { id: string }[] = [];
  const constraints: { id: string; description: string; source?: string }[] = [];
  const artifacts: { id: string; type: string; version: string }[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'Decision':
      case 'ADR':
        decisions.push({ id: node.id, version: node.updatedAt });
        break;
      case 'Risk':
        risks.push({ id: node.id });
        break;
      case 'Requirement':
        constraints.push({
          id: node.id,
          description: node.title,
          source: node.description ?? undefined,
        });
        break;
      case 'API':
      case 'Module':
      case 'Entity':
      case 'Architecture':
      case 'Code':
      case 'Research':
        artifacts.push({
          id: node.id,
          type: node.type,
          version: node.updatedAt,
        });
        break;
    }
  }
  return { decisions, questions, risks, constraints, artifacts };
}

async function computeContentHash(packet: ContextPacket): Promise<string> {
  const { contentHash: _omit, ...rest } = packet;
  const serialized = JSON.stringify(rest);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function resolveModelTarget(roleId: string): string {
  const map: Record<string, string> = {
    architect: 'gpt-5.5',
    tech_lead: 'glm',
    researcher: 'gemini',
    critic: 'gpt-5.5',
    engineer: 'mimo',
  };
  return map[roleId] ?? 'unknown';
}
