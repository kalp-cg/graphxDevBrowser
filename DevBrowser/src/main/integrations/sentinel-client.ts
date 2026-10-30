import type {
  BrowserTrafficRecord,
  InvestigationEvidence,
  ChaosKind,
  ChaosResult,
  CodebaseScanResult,
  ImpactResult,
  SandboxAction,
  SandboxState,
  SentinelAction,
  SentinelBlastRadius,
  SentinelResolution,
  SentinelRun,
  SentinelSnapshot,
  SentinelStatus
} from '../../shared/domain/sentinel';

/** Where the connection is kept between launches. */
export interface ConnectionStore {
  load(): SavedConnection | null;
  save(conn: SavedConnection): void;
}

export interface SavedConnection {
  baseUrl: string;
}

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER = 500;
const RESOLVE_TTL_MS = 30_000;

/**
 * Talks to a SentinelGraph API from the main process.
 * Captured traffic is buffered and sent in batches, so browsing never waits on the graph.
 */
export class SentinelGraphClient {
  private baseUrl = '';
  private buffer: BrowserTrafficRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private resolved = new Map<string, { at: number; value: Promise<SentinelResolution> }>();

  constructor(
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly store: ConnectionStore | null = null
  ) {}

  public configure(baseUrl: string): void {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    this.store?.save({ baseUrl: this.baseUrl });
    this.start();
  }

  /** Use an address for this session without saving it (the hosted backend an installer ships with). A saved choice of the user's wins on the next launch. */
  public attach(baseUrl: string): void {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    this.start();
  }

  /** Reconnect with the connection saved on the last launch. Returns false if there is none. */
  public restore(): boolean {
    const saved = this.store?.load();
    if (!saved?.baseUrl) return false;
    this.baseUrl = saved.baseUrl;
    this.start();
    return true;
  }

  public get url(): string {
    return this.baseUrl;
  }

  private start(): void {
    this.buffer = [];
    this.resolved.clear();
    if (!this.timer && this.baseUrl) {
      this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  public isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  public async status(): Promise<SentinelStatus> {
    if (!this.isConfigured()) return { ok: false, message: 'SentinelGraph API URL is not set' };
    try {
      const h = await this.request<{ tigergraph: { ok: boolean; services?: number; error?: string }; graph: string;
        backend?: string }>('GET', '/api/health');
      const engine = h.backend === 'local' ? 'local graph' : 'TigerGraph graph';
      return h.tigergraph.ok
        ? { ok: true, message: `Connected to SentinelGraph (${engine} ${h.graph}, ${h.tigergraph.services ?? 0} services)`,
            graph: h.graph, services: h.tigergraph.services }
        : { ok: false, message: `SentinelGraph is up but its ${engine} is not: ${h.tigergraph.error ?? 'unknown'}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  public getGraph(): Promise<SentinelSnapshot> {
    return this.request('GET', '/api/graph');
  }

  public blastRadius(service: string): Promise<SentinelBlastRadius> {
    return this.request('GET', `/api/services/${encodeURIComponent(service)}/blast-radius`);
  }

  public startInvestigation(question?: string, evidence: InvestigationEvidence[] = []): Promise<{ run_id: string }> {
    return this.request('POST', '/api/runs', {
      question: question ?? 'Alerts are firing. Investigate, find the root cause and fix it.',
      evidence
    });
  }

  /** The service behind a URL, with owner, health and blast radius. Cached per host for a short while. */
  public resolve(url: string): Promise<SentinelResolution> {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return Promise.reject(new Error(`not a URL: ${url}`));
    }
    const hit = this.resolved.get(host);
    if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.value;
    const value = this.request<SentinelResolution>('GET', `/api/resolve?url=${encodeURIComponent(url)}`);
    this.resolved.set(host, { at: Date.now(), value });
    value.catch(() => this.resolved.delete(host)); // never cache a failure
    return value;
  }

  /** Map a repository on the API's machine into the graph: services, dependencies, owners, addresses. */
  public scanCodebase(path: string): Promise<CodebaseScanResult> {
    this.resolved.clear(); // new addresses change what a URL resolves to
    return this.request('POST', '/api/workspace/scan', { path });
  }

  /** Simulate a failure in the graph (nothing real is touched): the service goes down or degraded and its callers alert. */
  public breakService(service: string, kind: ChaosKind, additive = false): Promise<ChaosResult> {
    const mode = kind === 'degrade' ? 'degraded' : 'down';
    return this.request('POST', `/api/chaos/${encodeURIComponent(service)}?mode=${mode}&deploy=${kind === 'deploy'}${additive ? '&additive=true' : ''}`);
  }

  /** The addresses each service answers on, from the last codebase scan. */
  public async aliases(): Promise<Record<string, string>> {
    return (await this.request<{ aliases?: Record<string, string> }>('GET', '/api/workspace')).aliases ?? {};
  }

  /** Which services the connected project's uncommitted changes (or the branch since `base`) touch, and what depends on them. */
  public impact(base?: string): Promise<ImpactResult> {
    return this.request('POST', '/api/impact', base ? { base } : {});
  }

  /** A dev server stopped (or started answering again): an alert on the service that owns that address, as Alertmanager would send it. */
  public reportDevServer(service: string, firing: boolean, address: string): Promise<unknown> {
    return this.request('POST', '/api/alerts/alertmanager', {
      alerts: [{
        status: firing ? 'firing' : 'resolved',
        labels: { alertname: 'DevServerDown', service, severity: 'critical' },
        annotations: { summary: `${address} stopped answering (seen by DevBrowser)` }
      }]
    });
  }

  /** The sandbox company and its exam: read the state, load the company, start or cancel a test. */
  public sandbox(a: SandboxAction): Promise<SandboxState | unknown> {
    switch (a.action) {
      case 'load': return this.request('POST', '/api/sandbox/load');
      case 'test': return this.request('POST', '/api/sandbox/test', { provider: a.provider, cases: a.cases ?? 12 });
      case 'cancel': return this.request('DELETE', '/api/sandbox/test');
      default: return this.request('GET', '/api/sandbox');
    }
  }

  /** Back to a healthy system; what the agent has learned is kept. */
  public restoreHealthy(): Promise<unknown> {
    return this.request('POST', '/api/reset?keep_memory=true');
  }

  public currentRun(): Promise<SentinelRun> {
    return this.request('GET', '/api/runs/current');
  }

  public approveAction(uid: string): Promise<{ outcome: string; action: SentinelAction }> {
    return this.request('POST', `/api/actions/${encodeURIComponent(uid)}/approve`);
  }

  public rejectAction(uid: string): Promise<SentinelAction> {
    return this.request('POST', `/api/actions/${encodeURIComponent(uid)}/reject`);
  }

  /** Queue a captured API call; it is sent with the next batch. Oldest records drop if the API is away. */
  public record(rec: BrowserTrafficRecord): void {
    if (!this.isConfigured()) return;
    this.buffer.push(rec);
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
  }

  /** Send everything queued. On failure the batch is kept for the next attempt. */
  public async flush(): Promise<boolean> {
    if (!this.isConfigured() || this.buffer.length === 0) return true;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.request('POST', '/api/browser-traffic', batch);
      return true;
    } catch (err) {
      console.warn('[SentinelGraph] could not send traffic, will retry:', err instanceof Error ? err.message : err);
      this.buffer = [...batch, ...this.buffer].slice(-MAX_BUFFER);
      return false;
    }
  }

  public dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (!this.isConfigured()) throw new Error('SentinelGraph API URL is not set');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let readable = detail;
      try {
        const parsed = JSON.parse(detail) as { detail?: unknown };
        if (typeof parsed.detail === 'string') readable = parsed.detail; // the server's own sentence, not a JSON blob
      } catch {
        // not JSON: show it as it is
      }
      throw new Error(`SentinelGraph ${method} ${path}: HTTP ${res.status}${readable ? ` ${readable.slice(0, 300)}` : ''}`);
    }
    return await res.json() as T;
  }
}
