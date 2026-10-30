import type { WebContents } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { MOCK_HEADER, buildResponse, firstMatch, interceptPattern, matchUrl, preflightResponse, type MockHit, type MockResponse, type MockRule, type MockState } from '../../shared/domain/mock';
import type { NetworkTransaction } from '../../shared/domain/network';
import { log } from '../logger';

interface Paused {
  requestId: string;
  request: { url: string; method: string; headers: Record<string, string> };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const header = (h: Record<string, string>, name: string): string | undefined => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];

/**
 * Answers a page's requests from rules instead of the network: a made-up response, a delay, or a dropped connection.
 *
 * Interception costs nothing until it is wanted: no rule enabled means Fetch is not enabled on any page, so requests never
 * pause. While rules exist only requests matching one of their URL patterns pause, and every pause is resolved, whatever
 * happens inside (a request that cannot be answered is let through, never left hanging).
 */
export class MockEngine {
  private guests = new Map<number, WebContents>();
  private intercepting = new Set<number>();
  private state: MockState = { enabled: false, rules: [] };
  private seq = 0;

  public attach(guest: WebContents): void {
    if (this.guests.has(guest.id)) return;
    this.guests.set(guest.id, guest);
    guest.on('destroyed', () => { this.guests.delete(guest.id); this.intercepting.delete(guest.id); });
    try {
      if (!guest.debugger.isAttached()) guest.debugger.attach('1.3');
      guest.debugger.on('message', (_event, method, params) => {
        if (method === 'Fetch.requestPaused') void this.onPaused(guest, params as unknown as Paused);
      });
    } catch (err) {
      log('warn', `mock engine could not attach to page ${guest.id}: ${String(err)}`);
    }
    void this.sync(guest);
  }

  /** The rules in force. Returns how many are active. */
  public setState(state: MockState): number {
    this.state = state;
    for (const guest of this.guests.values()) void this.sync(guest);
    return this.active().length;
  }

  private active(): MockRule[] {
    return this.state.enabled ? this.state.rules.filter(r => r.enabled) : [];
  }

  private async sync(guest: WebContents): Promise<void> {
    if (guest.isDestroyed()) return;
    try {
      if (!guest.debugger.isAttached()) guest.debugger.attach('1.3');
      const rules = this.active();
      if (!rules.length) {
        if (this.intercepting.delete(guest.id)) await guest.debugger.sendCommand('Fetch.disable');
        return;
      }
      const patterns = [...new Set(rules.map(interceptPattern))].map(urlPattern => ({ urlPattern, requestStage: 'Request' }));
      await guest.debugger.sendCommand('Fetch.enable', { patterns });
      this.intercepting.add(guest.id);
    } catch (err) {
      log('warn', `mock engine could not update page ${guest.id}: ${String(err)}`);
    }
  }

  private async onPaused(guest: WebContents, p: Paused): Promise<void> {
    const send = (method: string, params: Record<string, unknown>) => guest.debugger.sendCommand(method, params);
    try {
      const { url, method, headers } = p.request;
      const rules = this.active();
      const origin = header(headers, 'origin');
      const rule = firstMatch(rules, method, url);
      // A browser asks permission (CORS preflight) before a cross-origin call. If a rule will answer that call, answer the question too.
      if (!rule && method === 'OPTIONS') {
        const wanted = header(headers, 'access-control-request-method') ?? '';
        const answered = rules.find(r => r.kind === 'respond' && (r.method === '*' || r.method.toUpperCase() === wanted.toUpperCase()) && matchUrl(r.url, url));
        if (answered) return await this.fulfill(guest, p.requestId, preflightResponse(answered, origin, header(headers, 'access-control-request-headers')));
      }
      if (!rule) { await send('Fetch.continueRequest', { requestId: p.requestId }); return; }

      if (rule.delayMs > 0) await sleep(rule.delayMs);
      if (guest.isDestroyed()) return;
      if (rule.kind === 'drop') {
        await send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionRefused' });
        this.report(guest, rule, p, 'drop');
        this.reportDropped(guest, p);
      } else if (rule.kind === 'passthrough') {
        await send('Fetch.continueRequest', { requestId: p.requestId });
        this.report(guest, rule, p, 'delay');
      } else {
        await this.fulfill(guest, p.requestId, buildResponse(rule, origin));
        this.report(guest, rule, p, 'respond');
      }
    } catch {
      // The page went away, navigated, or the request was cancelled while we waited: nothing is left to answer. If it is still
      // paused, let it go on rather than leave the page waiting.
      try { await guest.debugger.sendCommand('Fetch.continueRequest', { requestId: p.requestId }); } catch { /* already resolved */ }
    }
  }

  private async fulfill(guest: WebContents, requestId: string, r: MockResponse): Promise<void> {
    await guest.debugger.sendCommand('Fetch.fulfillRequest', {
      requestId, responseCode: r.status, responsePhrase: r.statusText || undefined, responseHeaders: r.headers,
      body: Buffer.from(r.body, 'utf8').toString('base64')
    });
  }

  private report(guest: WebContents, rule: MockRule, p: Paused, action: MockHit['action']): void {
    const hit: MockHit = { ruleId: rule.id, ruleName: rule.name, method: p.request.method, url: p.request.url, action, at: Date.now(),
      ...(action === 'respond' ? { status: rule.status } : {}), ...(rule.delayMs ? { delayMs: rule.delayMs } : {}) };
    const ui = guest.hostWebContents ?? guest;
    if (!ui.isDestroyed()) ui.send(IPC_CHANNELS.NETWORK_MOCK_HIT, hit);
  }

  /** A dropped request never answers, so the capture would never list it: list it as the failure it is. */
  private reportDropped(guest: WebContents, p: Paused): void {
    const now = Date.now();
    const tx: NetworkTransaction = {
      id: `mock-drop-${guest.id}-${++this.seq}`, tabId: `webview-${guest.id}`, url: p.request.url, method: p.request.method,
      requestHeaders: p.request.headers, isTruncated: false, pageUrl: guest.getURL(), startTime: now, endTime: now,
      error: 'net::ERR_CONNECTION_REFUSED (dropped by a DevBrowser mock rule)', responseHeaders: { [MOCK_HEADER]: 'drop' }
    };
    const ui = guest.hostWebContents ?? guest;
    if (!ui.isDestroyed()) ui.send(IPC_CHANNELS.NETWORK_STREAM_TRANSACTION, tx);
  }
}
