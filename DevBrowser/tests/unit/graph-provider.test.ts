import { describe, it, expect } from 'vitest';
import type { 
  IGraphProvider, 
  IGraphNode, 
  IGraphEdge, 
  BlastRadiusResult,
  GraphHealthResult
} from '../../src/shared/domain/graph';

// Reference In-Memory Provider Implementation verifying interface conformance
class MockInMemoryGraphProvider implements IGraphProvider {
  public readonly providerId = 'in-memory-test-provider';
  public readonly providerName = 'In-Memory Test Graph';

  private nodes: Map<string, IGraphNode> = new Map();
  private edges: IGraphEdge[] = [];

  async initialize(_config: Record<string, unknown>): Promise<void> {
    this.nodes.clear();
    this.edges = [];
  }

  async healthCheck(): Promise<GraphHealthResult> {
    return { ok: true, providerId: this.providerId, message: 'Ready' };
  }

  async upsertNode(node: IGraphNode): Promise<void> {
    this.nodes.set(node.id, node);
  }

  async upsertEdge(edge: IGraphEdge): Promise<void> {
    this.edges.push(edge);
  }

  async batchUpsert(nodes: IGraphNode[], edges: IGraphEdge[]): Promise<void> {
    for (const n of nodes) this.nodes.set(n.id, n);
    this.edges.push(...edges);
  }

  async queryDependencies(nodeId: string, _depth = 1): Promise<{ nodes: IGraphNode[]; edges: IGraphEdge[] }> {
    const directEdges = this.edges.filter(e => e.sourceId === nodeId);
    const targetIds = new Set(directEdges.map(e => e.targetId));
    const dependentNodes = Array.from(this.nodes.values()).filter(n => targetIds.has(n.id));

    return { nodes: dependentNodes, edges: directEdges };
  }

  async calculateBlastRadius(nodeId: string): Promise<BlastRadiusResult> {
    const { nodes } = await this.queryDependencies(nodeId);
    return {
      rootNodeId: nodeId,
      affectedNodes: nodes,
      impactScore: nodes.length > 0 ? 0.5 : 0.0,
      dependencyChain: [[nodeId, ...nodes.map(n => n.id)]]
    };
  }

  async clearGraph(): Promise<void> {
    this.nodes.clear();
    this.edges = [];
  }
}

describe('IGraphProvider Integration Interface', () => {
  it('conforms to provider contract and executes dependency queries', async () => {
    const provider: IGraphProvider = new MockInMemoryGraphProvider();
    await provider.initialize({});

    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);

    const gatewayNode: IGraphNode = {
      id: 'gateway',
      type: 'Service',
      name: 'API Gateway',
      metadata: {}
    };

    const authNode: IGraphNode = {
      id: 'auth-service',
      type: 'Service',
      name: 'Auth Service',
      metadata: {}
    };

    const edge: IGraphEdge = {
      sourceId: 'gateway',
      targetId: 'auth-service',
      type: 'CALLS',
      metadata: { protocol: 'HTTP' }
    };

    await provider.batchUpsert([gatewayNode, authNode], [edge]);

    const result = await provider.queryDependencies('gateway');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.name).toBe('Auth Service');

    const blastRadius = await provider.calculateBlastRadius('gateway');
    expect(blastRadius.affectedNodes).toHaveLength(1);
    expect(blastRadius.impactScore).toBe(0.5);
  });
});
