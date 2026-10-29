import type { BlastRadiusResult, IGraphEdge, IGraphNode } from './graph';
import type { NetworkTransaction } from './network';

/**
 * SentinelGraph integration: the TigerGraph-backed dependency graph and incident agent
 * (github: sentinelgraph-tigergraph). DevBrowser reads the live graph from its API and sends it the
 * API calls it captures, so the graph shows the services a page really talks to.
 */

/** A node of SentinelGraph's `GET /api/graph` snapshot (only the fields used here). */
export interface SentinelNode {
  id: string;
  type: string;
  name?: string;
  label: string;
  status?: string;
  tier?: string;
  layer?: string;
  team?: string | null;
  pagerank?: number;
  betweenness?: number;
}

export interface SentinelLink {
  id: string;
  source: string;
  target: string;
  type: string;
  breaker?: string;
}

export interface SentinelSnapshot {
  nodes: SentinelNode[];
  links: SentinelLink[];
}

/** `GET /api/services/{name}/blast-radius`: every upstream caller that breaks if `service` fails. */
export interface SentinelBlastRadius {
  result: {
    service: string;
    impacted: { name: string; uid: string; status: string; tier: string; hops: number }[];
    count: number;
  };
  gsql: string;
  edge_uids: string[];
}

/** Whether the SentinelGraph API (and the TigerGraph behind it) is reachable. */
export interface SentinelStatus {
  ok: boolean;
  message: string;
  graph?: string;
  services?: number;
}

/** One captured API call, as `POST /api/browser-traffic` takes it. */
export interface BrowserTrafficRecord {
  pageUrl: string;
  url: string;
  method: string;
  statusCode?: number;
  mimeType?: string;
  startTime: number;
  endTime?: number;
}

/** Pages that call services are named `web:<host>` by SentinelGraph's browser-traffic ingest. */
const isWebApp = (n: SentinelNode) => n.type === 'Service' && (n.name ?? n.label).startsWith('web:');

/** Services, web apps and databases with their dependencies; people, deploys and incidents are left out. */
export function toDevBrowserGraph(snapshot: SentinelSnapshot): { nodes: IGraphNode[]; edges: IGraphEdge[] } {
  const nodes: IGraphNode[] = snapshot.nodes
    .filter(n => n.type === 'Service' || n.type === 'Database')
    .map(n => ({
      id: n.id,
      type: n.type === 'Database' ? 'Database' : isWebApp(n) ? 'FrontendRoute' : 'Service',
      name: n.name ?? n.label,
      metadata: {
        status: n.status,
        tier: n.tier,
        layer: n.layer,
        team: n.team ?? undefined,
        pagerank: n.pagerank,
        betweenness: n.betweenness
      }
    }));
  const ids = new Set(nodes.map(n => n.id));
  const edges: IGraphEdge[] = snapshot.links
    .filter(l => ['DEPENDS_ON', 'READS_FROM', 'WRITES_TO'].includes(l.type) && ids.has(l.source) && ids.has(l.target))
    .map(l => ({
      sourceId: l.source,
      targetId: l.target,
      type: l.type === 'WRITES_TO' ? 'PRODUCES' : l.type === 'READS_FROM' ? 'CONSUMES' : 'DEPENDS_ON',
      metadata: {}
    }));
  return { nodes, edges };
}

/** SentinelGraph's GSQL blast radius as DevBrowser's result: impact = share of all services affected. */
export function toBlastRadius(rootNodeId: string, res: SentinelBlastRadius, nodes: IGraphNode[]): BlastRadiusResult {
  const impacted = new Set(res.result.impacted.map(i => i.uid));
  const services = nodes.filter(n => n.type !== 'Database').length;
  return {
    rootNodeId,
    affectedNodes: nodes.filter(n => impacted.has(n.id)),
    impactScore: services > 1 ? Math.min(1, impacted.size / (services - 1)) : 0,
    // Each edge uid is `e:<caller>-><callee>`: one hop of a failure path, caller first.
    dependencyChain: res.edge_uids.map(e => e.replace(/^e:/, '').split('->').map(name => `svc:${name}`))
  };
}

/** A captured transaction as a traffic record, or null if it can't be one (no page or no response yet). */
export function toTrafficRecord(tx: NetworkTransaction, pageUrl: string): BrowserTrafficRecord | null {
  if (!pageUrl.startsWith('http') || !tx.url.startsWith('http')) return null;
  return {
    pageUrl,
    url: tx.url,
    method: tx.method,
    statusCode: tx.statusCode ?? 0,
    mimeType: tx.mimeType,
    startTime: tx.startTime,
    endTime: tx.endTime
  };
}

export type GraphTier = 'client' | 'gateway' | 'service' | 'storage';

export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
  tier: GraphTier;
}

const COLUMN_WIDTH = 190;
const ROW_HEIGHT = 120;

/**
 * Layered layout: each node sits one row below the deepest caller that depends on it, so dependencies
 * always point down. Rows are as wide as they need to be; returns the canvas size too.
 */
export function layeredLayout(nodes: IGraphNode[], edges: IGraphEdge[]):
  { positions: Record<string, LayoutPosition>; width: number; height: number } {
  const callers = new Map<string, string[]>();
  for (const e of edges) callers.set(e.targetId, [...(callers.get(e.targetId) ?? []), e.sourceId]);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // a cycle: break it here
    visiting.add(id);
    const d = Math.max(-1, ...(callers.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  const rows: IGraphNode[][] = [];
  for (const n of [...nodes].sort((a, b) => a.name.localeCompare(b.name))) {
    const d = depthOf(n.id);
    (rows[d] ??= []).push(n);
  }
  const width = Math.max(800, ...rows.map(r => (r?.length ?? 0) * COLUMN_WIDTH + 40));
  const positions: Record<string, LayoutPosition> = {};
  rows.forEach((row, d) => {
    const offset = (width - row.length * COLUMN_WIDTH) / 2;
    row.forEach((n, i) => {
      const layer = n.metadata.layer;
      const tier: GraphTier = n.type === 'FrontendRoute' ? 'client'
        : n.type === 'Database' ? 'storage'
          : layer === 'edge' ? 'gateway' : 'service';
      positions[n.id] = { id: n.id, x: offset + i * COLUMN_WIDTH + 15, y: 40 + d * ROW_HEIGHT, tier };
    });
  });
  return { positions, width, height: Math.max(660, rows.length * ROW_HEIGHT + 80) };
}
