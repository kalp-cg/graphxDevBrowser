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
  // Context nodes (deploys, commits, alerts, incidents, actions) carry a few more fields for tooltips.
  at?: number;
  change_summary?: string;
  message?: string;
  metric?: string;
  value?: number;
  threshold?: number;
  title?: string;
  reason?: string;
  version?: string;
  ref?: string;
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

/** What a codebase scan found (`POST /api/workspace/scan`). */
export interface CodebaseScanResult {
  repo: string;
  source: string;
  services: number;
  databases: number;
  dependencies: number;
  teams: number;
  changes: number;
  aliases: number;
  service_names: string[];
  /** True when this repository replaced a different system's map. */
  replaced?: boolean;
}

/** `POST /api/impact`: which services a change touches, and what depends on them. The risk level is a heuristic. */
export interface ImpactResult {
  files: number;
  changed: { name: string; tier: string; kind: string; team: string | null; files: string[]; dependents: number; dependent_names: string[] }[];
  affected: { name: string; tier: string; hops: number; via: string[] }[];
  unmapped_files: string[];
  services_total: number;
  risk: 'none' | 'low' | 'medium' | 'high';
  risk_reason: string;
  risk_is_a_heuristic: boolean;
}

/** `GET /api/sandbox`: the 30-40 service test company and the exam that asks an agent to find what we broke in it. */
export interface SandboxCompany {
  services: number; databases: number; teams: number; engineers: number; deployments: number; commits: number;
  past_incidents: number; dependencies: number;
}

export interface SandboxCaseResult {
  id: string; title: string; difficulty: 'easy' | 'medium' | 'hard'; expected: string[]; found: string[];
  outcome: 'correct' | 'false-alarm' | 'missed' | 'extra' | 'partial' | 'wrong' | 'timeout';
  correct: boolean; why: string; seconds: number; steps: number; confidence: string | null; provider: string | null; fallback: boolean;
}

export interface SandboxState {
  loaded: boolean;
  company: SandboxCompany | null;
  providers: string[];
  running: boolean;
  exam: {
    status: 'idle' | 'starting' | 'running' | 'done' | 'cancelled' | 'error';
    provider: string | null; total: number; done: number; current: { id: string; title: string } | null;
    results: SandboxCaseResult[]; error?: string | null;
    summary: { cases: number; correct: number; accuracy: number | null; false_alarms: number; seconds: number;
      fell_back_to_builtin: number; answered_by_chosen: number; accuracy_of_chosen: number | null } | null;
  };
}

export type SandboxAction =
  | { action: 'state' } | { action: 'load' } | { action: 'cancel' }
  | { action: 'test'; provider?: string; cases?: number };

/** How a service is broken for a demo: crashed or slowed, with or without a bad deploy as the cause. */
export type ChaosKind = 'deploy' | 'crash' | 'degrade';

export interface ChaosResult {
  title: string;
  target: string;
  alerting_services: string[];
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

/** An address without its query string or fragment: topology needs the host and path, and a query can carry tokens. */
export function withoutQuery(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? '';
  }
}

/** A captured transaction as a traffic record, or null if it can't be one (no page or no response yet). */
export function toTrafficRecord(tx: NetworkTransaction, pageUrl: string): BrowserTrafficRecord | null {
  if (!pageUrl.startsWith('http') || !tx.url.startsWith('http')) return null;
  return {
    pageUrl: withoutQuery(pageUrl),
    url: withoutQuery(tx.url),
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

/** `GET /api/resolve?url=`: what the graph knows about the service behind a captured request. */
export interface SentinelResolution {
  url: string;
  host: string;
  service: string | null;
  known: boolean;
  tier?: string;
  status?: string;
  team?: string | null;
  slack_channel?: string | null;
  on_call?: string[];
  databases?: string[];
  blast_radius?: { count: number; by_tier: Record<string, number>; impacted: string[] };
  recent_changes?: { uid: string; version: string; message: string | null; author: string | null; minutes_ago: number }[];
}

/** A failed request attached to an investigation ("Investigate this failure"). */
export interface InvestigationEvidence {
  url: string;
  method: string;
  status_code: number;
  page_url: string;
}

/** A remediation the agent proposed; it runs only when a human approves it. */
export interface SentinelAction {
  uid: string;
  kind: string;
  status: string;
  target: string | null;
  reason?: string | null;
  risk?: string | null;
  outcome?: string | null;
}

/** One event of an investigation, as `GET /api/runs/current` (and the WebSocket) delivers them. */
export interface SentinelRunEvent {
  type: string;
  run_id?: string;
  name?: string;
  summary?: string;
  error?: string | null;
  report?: string;
  message?: string;
  root_cause?: string | null;
  /** Every failure the agent found: more than one when separate things are broken at once. */
  root_causes?: string[];
  /** `high`, `medium` or `low`, from how many independent pieces of evidence agree; with the reasons. Not a probability. */
  confidence?: 'high' | 'medium' | 'low' | null;
  confidence_reason?: string | null;
  seconds?: number;
  actions?: SentinelAction[];
  action?: SentinelAction;
  node_uids?: string[];
  edge_uids?: string[];
}

export interface SentinelRun {
  run_id: string | null;
  running: boolean;
  events: SentinelRunEvent[];
}

/** What the UI shows for a run: where it is, what it found, what waits for approval. */
export interface RunSummary {
  phase: 'idle' | 'running' | 'done' | 'failed';
  steps: { name: string; summary: string; error: boolean }[];
  rootCause: string | null;
  rootCauses: string[];
  confidence: 'high' | 'medium' | 'low' | null;
  confidenceReason: string | null;
  report: string | null;
  seconds: number | null;
  proposed: SentinelAction[];
  /** What the agent's queries touched (for the graph): everything so far, and the latest step alone. */
  path: { nodes: string[]; edges: string[]; currentNodes: string[]; currentEdges: string[] };
}

/** A failed transaction as evidence, or null if it isn't a server-side failure (a 4xx is the caller's mistake). */
export function toEvidence(tx: NetworkTransaction, pageUrl: string): InvestigationEvidence | null {
  const status = tx.statusCode ?? 0;
  if (!tx.url.startsWith('http') || (status > 0 && status < 500)) return null;
  return { url: withoutQuery(tx.url), method: tx.method, status_code: status, page_url: pageUrl.startsWith('http') ? withoutQuery(pageUrl) : '' };
}

/** Tools that describe the whole system rather than this incident; their nodes are not part of the failure path. */
const CONTEXT_TOOLS = new Set(['critical_services', 'chokepoints']);

export function summarizeRun(run: SentinelRun | null): RunSummary {
  const path = { nodes: [] as string[], edges: [] as string[], currentNodes: [] as string[], currentEdges: [] as string[] };
  const empty: RunSummary = { phase: 'idle', steps: [], rootCause: null, rootCauses: [], confidence: null, confidenceReason: null, report: null, seconds: null, proposed: [], path };
  if (!run || !run.run_id) return empty;
  const results = run.events.filter(e => e.type === 'tool_result');
  const steps = results.map(e => ({ name: e.name ?? '', summary: e.summary ?? '', error: Boolean(e.error) }));
  // The graph lights up what the investigation found about this incident. Rankings (the most critical services of the
  // whole system) are context: lighting them up makes unrelated services look like part of the failure.
  const evidence = results.filter(e => !CONTEXT_TOOLS.has(e.name ?? ''));
  const last = evidence[evidence.length - 1];
  path.nodes = [...new Set(evidence.flatMap(e => e.node_uids ?? []))];
  path.edges = [...new Set(evidence.flatMap(e => e.edge_uids ?? []))];
  path.currentNodes = results[results.length - 1] === last ? last?.node_uids ?? [] : [];
  path.currentEdges = results[results.length - 1] === last ? last?.edge_uids ?? [] : [];
  const proposed = run.events.filter(e => e.type === 'action_proposed' && e.action).map(e => e.action as SentinelAction);
  const end = run.events[run.events.length - 1];
  if (end?.type === 'error') return { ...empty, phase: 'failed', steps, path, report: end.message ?? 'Investigation failed' };
  if (end?.type === 'final') {
    const rootCauses = end.root_causes?.length ? end.root_causes : end.root_cause ? [end.root_cause] : [];
    return { phase: 'done', steps, rootCause: end.root_cause ?? null, rootCauses, confidence: end.confidence ?? null,
      confidenceReason: end.confidence_reason ?? null, report: end.report ?? null,
      seconds: end.seconds ?? null, proposed, path: { ...path, currentNodes: [], currentEdges: [] } };
  }
  return { ...empty, phase: 'running', steps, proposed, path };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/** `http://127.0.0.1:7004/x` is `localhost:7004`: every spelling of the local machine is one host. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    const name = u.hostname.toLowerCase();
    return `${LOOPBACK.has(name) ? 'localhost' : name}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return '';
  }
}

/**
 * The service a URL belongs to, given the workspace's addresses (the same rule as the server's `resolve`): the longest path
 * prefix first (`localhost:3000/api/orders` is the module `api.orders`), then the host.
 */
export function serviceOfUrl(url: string, aliases: Record<string, string>): string | null {
  const host = hostOf(url);
  if (!host) return null;
  let parts: string[] = [];
  try {
    parts = new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    // no path
  }
  for (let n = parts.length; n > 0; n--) {
    const hit = aliases[`${host}/${parts.slice(0, n).join('/')}`];
    if (hit) return hit;
  }
  return aliases[host] ?? null;
}

/** The `localhost:PORT` addresses a service answers on: where to open it. */
export function localAddressesOf(service: string, aliases: Record<string, string>): string[] {
  return Object.entries(aliases)
    .filter(([addr, name]) => name === service && /^localhost:\d+$/.test(addr))
    .map(([addr]) => addr).sort();
}

/**
 * An OpenTelemetry Collector configuration that sends traces to this SentinelGraph server. Traces are what turn the map from
 * "what the code declares" into "what really happens, and what is failing": each service's calls, errors and who it calls.
 */
export function otelCollectorConfig(serverUrl: string): string {
  const base = serverUrl.trim().replace(/\/+$/, '');
  return `# otel-collector.yaml: send traces from your services to SentinelGraph.
# Run:  docker run --rm -p 4317:4317 -p 4318:4318 -v $PWD/otel-collector.yaml:/etc/otelcol-contrib/config.yaml otel/opentelemetry-collector-contrib
# Then point your services' OpenTelemetry SDK at http://localhost:4318 (OTLP/HTTP) or localhost:4317 (gRPC).
# Each service must set service.name to the name shown on the map (OTEL_SERVICE_NAME=checkout).
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
processors:
  batch:
    timeout: 2s
exporters:
  otlphttp/sentinelgraph:
    traces_endpoint: ${base}/v1/traces
    encoding: json
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/sentinelgraph]
`;
}

/** A Prometheus Alertmanager receiver that sends firing and resolved alerts to this SentinelGraph server. */
export function alertmanagerReceiver(serverUrl: string): string {
  const base = serverUrl.trim().replace(/\/+$/, '');
  return `# alertmanager.yml: add this receiver, and route alerts to it. Label each alert with the service it is about
# (service: checkout, or app / job).
receivers:
  - name: sentinelgraph
    webhook_configs:
      - url: ${base}/api/alerts/alertmanager
        send_resolved: true
`;
}
