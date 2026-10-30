import type {
  BrowserTrafficRecord,
  InvestigationEvidence,
  SentinelAction,
  SentinelBlastRadius,
  SentinelResolution,
  SentinelRun,
  SentinelSnapshot,
  SentinelStatus
} from '../../shared/domain/sentinel';

/** The parts of CredentialVault this client needs (so tests can pass a stand-in). */
export interface SecretStore {
  encryptSecret(plaintext: string): string;
  decryptSecret(ciphertext: string): string;
}

/** Where the connection is kept between launches. The token is stored only in its encrypted form. */
export interface ConnectionStore {
  load(): SavedConnection | null;
  save(conn: SavedConnection): void;
}

export interface SavedConnection {
  baseUrl: string;
  encryptedToken: string;
}

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER = 500;
const RESOLVE_TTL_MS = 30_000;

/**
 * Talks to a SentinelGraph API from the main process. The admin token never reaches the renderer: it is
 * encrypted with the OS keychain (safeStorage) on configure and decrypted only to sign a request.
 * Captured traffic is buffered and sent in batches, so browsing never waits on the graph.
 */
export class SentinelGraphClient {
  private baseUrl = '';
  private encryptedToken = '';
  private buffer: BrowserTrafficRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private resolved = new Map<string, { at: number; value: Promise<SentinelResolution> }>();

  constructor(
    private readonly vault: SecretStore,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly store: ConnectionStore | null = null
  ) {}

  public configure(baseUrl: string, adminToken: string): void {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    if (adminToken) {
      this.encryptedToken = this.vault.encryptSecret(adminToken);
    }
    this.store?.save({ baseUrl: this.baseUrl, encryptedToken: this.encryptedToken });
    this.start();
  }

  /** Reconnect with the connection saved on the last launch. Returns false if there is none. */
  public restore(): boolean {
    const saved = this.store?.load();
    if (!saved?.baseUrl) return false;
    this.baseUrl = saved.baseUrl;
    this.encryptedToken = saved.encryptedToken;
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

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.isConfigured()) throw new Error('SentinelGraph API URL is not set');
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = this.vault.decryptSecret(this.encryptedToken);
    if (token) headers['X-Admin-Token'] = token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`SentinelGraph ${method} ${path}: HTTP ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
    }
    return await res.json() as T;
  }
}
