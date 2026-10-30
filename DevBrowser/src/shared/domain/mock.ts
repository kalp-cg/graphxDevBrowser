import { z } from 'zod';
import { STATUS_TEXT } from './status-text';
import type { NetworkTransaction } from './network';
import type { Recording } from './recording';

/**
 * API mocking and fault injection: rules that answer a page's requests with a made-up response, delay them, or break the
 * connection, so a page can be tried against a slow, failing or empty backend without touching the backend. Pure data and
 * pure functions here; the interception itself lives in the main process (`main/network/mock-engine.ts`).
 */
export const MOCK_HEADER = 'x-devbrowser-mock';
export const MAX_RULES = 100;
export const MAX_BODY = 2_000_000;

export const MockRuleSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().max(200),
  enabled: z.boolean(),
  /** '*' or an HTTP method. */
  method: z.string().max(12),
  /** A URL with `*` wildcards: `https://api.test/users/*`, `localhost:3100/api/*`, or just a path `/api/*`. */
  url: z.string().min(1).max(2000),
  /** respond: answer with `status`/`headers`/`body`. passthrough: let the real server answer (use with a delay). drop: fail the connection. */
  kind: z.enum(['respond', 'passthrough', 'drop']),
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string().max(2000)),
  body: z.string().max(MAX_BODY),
  delayMs: z.number().int().min(0).max(120_000)
});
export type MockRule = z.infer<typeof MockRuleSchema>;

export const MockStateSchema = z.object({ enabled: z.boolean(), rules: z.array(MockRuleSchema).max(MAX_RULES) });
export type MockState = z.infer<typeof MockStateSchema>;

/** What the main process tells the panel when a rule acted on a request. */
export interface MockHit {
  ruleId: string;
  ruleName: string;
  method: string;
  url: string;
  action: 'respond' | 'delay' | 'drop';
  status?: number;
  delayMs?: number;
  at: number;
}

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
/** `*` matches anything (also `/` and `?`), everything else is literal. */
export const globToRegExp = (glob: string): RegExp => new RegExp(`^${glob.split('*').map(escapeRe).join('.*')}$`, 'i');

/**
 * A pattern is tried against the full address, the address without its scheme, and the path. A pattern with no `?` in it ignores the
 * query string, so a rule for `/api/products` also answers `/api/products?limit=2` (but not `/api/products/1`).
 */
export function matchUrl(pattern: string, url: string): boolean {
  const re = globToRegExp(pattern.trim());
  const candidates = [url];
  try {
    const u = new URL(url);
    const noScheme = url.slice(u.protocol.length + 2);
    candidates.push(noScheme, u.pathname + u.search, u.pathname);
    if (!pattern.includes('?') && u.search) candidates.push(url.replace(u.search, ''), noScheme.replace(u.search, ''));
  } catch { /* not an absolute address: only the whole string is tried */ }
  return candidates.some(c => re.test(c));
}

export const matchesRequest = (rule: Pick<MockRule, 'method' | 'url'>, method: string, url: string): boolean =>
  (rule.method === '*' || rule.method.toUpperCase() === method.toUpperCase()) && matchUrl(rule.url, url);

/** The rule that acts on a request: the first enabled one in list order (the newest is first). */
export function firstMatch(rules: MockRule[], method: string, url: string): MockRule | undefined {
  return rules.find(r => r.enabled && matchesRequest(r, method, url));
}

/** The pattern handed to the browser to pause only the requests a rule could match (everything else is never paused). */
export function interceptPattern(rule: Pick<MockRule, 'url'>): string {
  let u = rule.url.trim();
  if (!u.includes('://') && !u.startsWith('*')) u = `*${u}`;
  return u.includes('?') || u.endsWith('*') ? u : `${u}*`; // it may pause a few more requests than match; the rule is checked again on each
}

export const statusText = (status: number): string => STATUS_TEXT[status] ?? '';

const BLOCKED_HEADER = /^(content-length|transfer-encoding|connection|content-encoding|host)$/i;

export interface MockResponse { status: number; statusText: string; headers: { name: string; value: string }[]; body: string }

/**
 * The response a rule gives. The page may be on another origin than the API, so the CORS headers it needs are added unless the
 * rule sets its own; every mocked response says it is one (`x-devbrowser-mock`).
 */
export function buildResponse(rule: MockRule, requestOrigin?: string): MockResponse {
  const headers = new Map<string, string>();
  for (const [k, v] of Object.entries(rule.headers)) if (!BLOCKED_HEADER.test(k)) headers.set(k.toLowerCase(), v);
  if (!headers.has('content-type')) headers.set('content-type', /^\s*[[{]/.test(rule.body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
  if (!headers.has('access-control-allow-origin')) {
    headers.set('access-control-allow-origin', requestOrigin || '*');
    if (requestOrigin) { headers.set('access-control-allow-credentials', 'true'); headers.set('vary', 'Origin'); }
  }
  headers.set(MOCK_HEADER, rule.id);
  return { status: rule.status, statusText: statusText(rule.status), headers: [...headers].map(([name, value]) => ({ name, value })), body: rule.body };
}

/** The answer to a browser's permission check (CORS preflight) before a mocked cross-origin call. */
export function preflightResponse(rule: Pick<MockRule, 'id'>, requestOrigin?: string, requestedHeaders?: string): MockResponse {
  const headers: [string, string][] = [
    ['access-control-allow-origin', requestOrigin || '*'], ['access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD'],
    ['access-control-allow-headers', requestedHeaders || '*'], ['access-control-max-age', '600'], [MOCK_HEADER, rule.id]
  ];
  if (requestOrigin) headers.push(['access-control-allow-credentials', 'true'], ['vary', 'Origin']);
  return { status: 204, statusText: 'No Content', headers: headers.map(([name, value]) => ({ name, value })), body: '' };
}

let counter = 0;
export const newRuleId = (): string => `mock-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function newRule(partial: Partial<MockRule> = {}): MockRule {
  return { id: newRuleId(), name: 'New rule', enabled: true, method: '*', url: '', kind: 'respond', status: 200, headers: {}, body: '', delayMs: 0, ...partial };
}

/** `Content-Type: application/json` lines to headers and back, for the editor. */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0 && line.slice(0, i).trim()) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
export const headerLines = (h: Record<string, string>): string => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');

const pathOf = (url: string) => { try { const u = new URL(url); return u.pathname + (u.search ? '?…' : ''); } catch { return url; } };
/** The address a rule built from a captured request matches: the request's own address, with any query string. */
function patternOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

export type QuickAction = 'mock' | '500' | '404' | 'delay' | 'drop';
export const QUICK_LABEL: Record<QuickAction, string> = { mock: 'Mock this response…', '500': 'Return 500', '404': 'Return 404', delay: 'Delay 5 seconds', drop: 'Drop the connection' };

/** The rule behind a right-click on a captured request. */
export function ruleFromTransaction(tx: Pick<NetworkTransaction, 'url' | 'method' | 'statusCode' | 'responseHeaders' | 'responseBody' | 'mimeType'>, action: QuickAction): MockRule {
  const where = `${tx.method} ${pathOf(tx.url)}`;
  // A browser's permission check (CORS preflight) is not what anyone means to mock: the rule applies to whatever call follows it.
  const base = { method: tx.method === 'OPTIONS' ? '*' : tx.method, url: patternOf(tx.url) };
  switch (action) {
    case 'mock': {
      const ct = Object.entries(tx.responseHeaders ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? tx.mimeType;
      return newRule({ ...base, name: `Mock ${where}`, kind: 'respond', status: tx.statusCode && tx.statusCode >= 100 ? tx.statusCode : 200,
        headers: ct ? { 'content-type': ct } : {}, body: tx.responseBody ?? '' });
    }
    case '500': return newRule({ ...base, name: `500 on ${where}`, kind: 'respond', status: 500, headers: { 'content-type': 'application/json' }, body: '{"error":"Internal Server Error (mocked by DevBrowser)"}' });
    case '404': return newRule({ ...base, name: `404 on ${where}`, kind: 'respond', status: 404, headers: { 'content-type': 'application/json' }, body: '{"error":"Not Found (mocked by DevBrowser)"}' });
    case 'delay': return newRule({ ...base, name: `Delay ${where}`, kind: 'passthrough', delayMs: 5000 });
    case 'drop': return newRule({ ...base, name: `Drop ${where}`, kind: 'drop' });
  }
}

/** Data requests, not the page's own scripts, styles, images and fonts. */
const isDataCall = (method: string, mime = '', url = ''): boolean =>
  (method !== 'GET' && method !== 'HEAD') || /json|xml|text\/plain|graphql|event-stream/i.test(mime) || /\/api\/|graphql/i.test(url);

function dedupe(rules: MockRule[]): MockRule[] {
  const seen = new Set<string>();
  return rules.filter(r => { const k = `${r.method} ${r.url}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** A rule for every distinct data call in a bug recording: replaying it then needs no backend. The latest response per call wins. */
export function rulesFromRecording(rec: Recording): MockRule[] {
  const rules: MockRule[] = [];
  for (const s of [...rec.steps].reverse()) {
    if (s.kind !== 'request' || s.error || !s.status || !isDataCall(s.method, s.mimeType, s.url)) continue;
    rules.push(newRule({ name: `Recorded ${s.method} ${pathOf(s.url)}`, method: s.method, url: patternOf(s.url), kind: 'respond', status: s.status,
      headers: s.mimeType ? { 'content-type': s.mimeType } : {}, body: (s.responseBody ?? '').replace(/\n… \[truncated \d+ characters\]$|… \[truncated \d+ characters\]$/, '') }));
  }
  return dedupe(rules);
}

interface HarEntry {
  request?: { method?: string; url?: string };
  response?: { status?: number; headers?: { name: string; value: string }[]; content?: { mimeType?: string; text?: string; encoding?: string } };
}
export type HarResult = { ok: true; rules: MockRule[]; skipped: number } | { ok: false; error: string };

/** A rule for every data call in a HAR file that has response bodies (export "HAR + bodies" from the Network panel). */
export function rulesFromHar(text: string): HarResult {
  let json: { log?: { entries?: HarEntry[] } };
  try { json = JSON.parse(text); } catch { return { ok: false, error: 'This is not a HAR file: it is not valid JSON.' }; }
  const entries = json?.log?.entries;
  if (!Array.isArray(entries)) return { ok: false, error: 'This is not a HAR file: it has no log.entries.' };
  const rules: MockRule[] = [];
  let skipped = 0;
  for (const e of [...entries].reverse()) {
    const method = e.request?.method ?? 'GET', url = e.request?.url ?? '', status = e.response?.status ?? 0, c = e.response?.content;
    if (!url || status < 100 || !isDataCall(method, c?.mimeType, url)) continue;
    if (c?.text === undefined || c.encoding === 'base64') { skipped++; continue; }
    rules.push(newRule({ name: `HAR ${method} ${pathOf(url)}`, method, url: patternOf(url), kind: 'respond', status, headers: c.mimeType ? { 'content-type': c.mimeType } : {}, body: c.text.slice(0, MAX_BODY) }));
  }
  return { ok: true, rules: dedupe(rules).slice(0, MAX_RULES), skipped };
}

/** One line for a rule in a list. */
export function summarizeRule(r: MockRule): string {
  const what = r.kind === 'drop' ? 'connection dropped' : r.kind === 'passthrough' ? `real response, delayed ${r.delayMs} ms` : `${r.status} ${statusText(r.status)}${r.delayMs ? `, after ${r.delayMs} ms` : ''}`;
  return `${r.method === '*' ? 'ANY' : r.method.toUpperCase()} ${r.url} → ${what}`;
}
