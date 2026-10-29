import { z } from 'zod';

export type NodeType = 'Service' | 'Endpoint' | 'Database' | 'ThirdParty' | 'FrontendRoute';
export type EdgeType = 'CALLS' | 'DEPENDS_ON' | 'PRODUCES' | 'CONSUMES';

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['Service', 'Endpoint', 'Database', 'ThirdParty', 'FrontendRoute']),
  name: z.string().min(1),
  metadata: z.record(z.unknown()).default({})
});
export type IGraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  type: z.enum(['CALLS', 'DEPENDS_ON', 'PRODUCES', 'CONSUMES']),
  metadata: z.object({
    protocol: z.enum(['HTTP', 'gRPC', 'GraphQL']).optional(),
    averageLatencyMs: z.number().optional(),
    errorRate: z.number().optional(),
    callCount: z.number().optional(),
    lastObserved: z.string().optional()
  }).default({})
});
export type IGraphEdge = z.infer<typeof GraphEdgeSchema>;

export interface BlastRadiusResult {
  rootNodeId: string;
  affectedNodes: IGraphNode[];
  impactScore: number; // 0.0 to 1.0
  dependencyChain: string[][];
}

export interface GraphHealthResult {
  ok: boolean;
  providerId: string;
  message?: string;
  latencyMs?: number;
}

export interface IGraphProvider {
  readonly providerId: string;
  readonly providerName: string;

  initialize(config: Record<string, unknown>): Promise<void>;
  healthCheck(): Promise<GraphHealthResult>;
  upsertNode(node: IGraphNode): Promise<void>;
  upsertEdge(edge: IGraphEdge): Promise<void>;
  batchUpsert(nodes: IGraphNode[], edges: IGraphEdge[]): Promise<void>;
  queryDependencies(nodeId: string, depth?: number): Promise<{ nodes: IGraphNode[]; edges: IGraphEdge[] }>;
  calculateBlastRadius(nodeId: string): Promise<BlastRadiusResult>;
  clearGraph(): Promise<void>;
}
