import type {
  BrowserTrafficRecord,
  SentinelBlastRadius,
  SentinelSnapshot,
  SentinelStatus
} from '../../shared/domain/sentinel';

/** The parts of CredentialVault this client needs (so tests can pass a stand-in). */
export interface SecretStore {
  encryptSecret(plaintext: string): string;
  decryptSecret(ciphertext: string): string;
}

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER = 500;

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

  constructor(
    private readonly vault: SecretStore,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {}

  public configure(baseUrl: string, adminToken: string): void {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    if (adminToken) {
      this.encryptedToken = this.vault.encryptSecret(adminToken);
    }
    this.buffer = [];
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
      const h = await this.request<{ tigergraph: { ok: boolean; services?: number; error?: string }; graph: string }>(
        'GET', '/api/health');
      return h.tigergraph.ok
        ? { ok: true, message: `Connected to SentinelGraph (TigerGraph graph ${h.graph})`, graph: h.graph,
            services: h.tigergraph.services }
        : { ok: false, message: `SentinelGraph is up but TigerGraph is not: ${h.tigergraph.error ?? 'unknown'}` };
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

  public startInvestigation(question?: string): Promise<{ run_id: string }> {
    return this.request('POST', '/api/runs', {
      question: question ?? 'Alerts are firing. Investigate, find the root cause and fix it.'
    });
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
