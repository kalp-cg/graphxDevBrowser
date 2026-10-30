import { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export const NetworkTimingSchema = z.object({
  requestTime: z.number(),
  dnsStart: z.number().optional(),
  dnsEnd: z.number().optional(),
  connectStart: z.number().optional(),
  connectEnd: z.number().optional(),
  sslStart: z.number().optional(),
  sslEnd: z.number().optional(),
  sendStart: z.number().optional(),
  sendEnd: z.number().optional(),
  receiveHeadersEnd: z.number().optional()
});
export type NetworkTiming = z.infer<typeof NetworkTimingSchema>;

export const WebSocketFrameSchema = z.object({
  id: z.string(),
  direction: z.enum(['send', 'receive']),
  opcode: z.number(),
  payloadData: z.string(),
  timestamp: z.number()
});
export type WebSocketFrame = z.infer<typeof WebSocketFrameSchema>;

export const NetworkTransactionSchema = z.object({
  id: z.string(),
  tabId: z.string().uuid(),
  url: z.string().url(),
  method: z.string(),
  statusCode: z.number().optional(),
  statusText: z.string().optional(),
  protocol: z.string().optional(), // 'http/1.1', 'h2', 'h3'
  mimeType: z.string().optional(),
  requestHeaders: z.record(z.string()),
  responseHeaders: z.record(z.string()).optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  isTruncated: z.boolean().default(false),
  encodedBodyLength: z.number().optional(),
  timing: NetworkTimingSchema.optional(),
  websocketFrames: z.array(WebSocketFrameSchema).optional(),
  /** The page (top-level URL) that was open when the request was made. */
  pageUrl: z.string().optional(),
  startTime: z.number(),
  endTime: z.number().optional(),
  error: z.string().optional()
});
export type NetworkTransaction = z.infer<typeof NetworkTransactionSchema>;

export const HarExportFilterSchema = z.object({
  redactAuthHeaders: z.boolean().default(true),
  tabId: z.string().uuid().optional(),
  searchQuery: z.string().optional(),
  statusCodes: z.array(z.number()).optional()
});
export type HarExportFilter = z.infer<typeof HarExportFilterSchema>;

export interface TimingPhase {
  label: string;
  /** Milliseconds from the start of the request. */
  start: number;
  duration: number;
}

/**
 * The phases of a request from what the browser reported (Chrome's `response.timing`: milliseconds from the request
 * start, -1 where a phase did not happen, e.g. no DNS for a reused connection). Null when there is no timing at all
 * (cached, or a data/blob address).
 */
export function timingPhases(tx: Pick<NetworkTransaction, 'timing' | 'startTime' | 'endTime'>): { phases: TimingPhase[]; total: number } | null {
  const t = tx.timing;
  const total = tx.endTime !== undefined && tx.startTime !== undefined ? Math.max(tx.endTime - tx.startTime, 0) : 0;
  if (!t || t.receiveHeadersEnd === undefined || t.receiveHeadersEnd < 0) return null;
  const phases: TimingPhase[] = [];
  const span = (label: string, a: number | undefined, b: number | undefined) => {
    if (a !== undefined && b !== undefined && a >= 0 && b >= a) phases.push({ label, start: a, duration: b - a });
  };
  span('DNS lookup', t.dnsStart, t.dnsEnd);
  const tls = t.sslStart !== undefined && t.sslEnd !== undefined && t.sslStart >= 0 ? { a: t.sslStart, b: t.sslEnd } : null;
  span('Connecting', t.connectStart, tls ? tls.a : t.connectEnd);
  if (tls) span('TLS handshake', tls.a, tls.b);
  span('Sending', t.sendStart, t.sendEnd);
  span('Waiting for the server', t.sendEnd, t.receiveHeadersEnd);
  const bodyStart = t.receiveHeadersEnd;
  if (total > bodyStart) phases.push({ label: 'Downloading', start: bodyStart, duration: total - bodyStart });
  return { phases, total: Math.max(total, bodyStart) };
}

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token)$/i;
const SECRET_PARAM = /token|secret|password|passwd|api[-_]?key|apikey|auth|session|signature|credential/i;
const REDACTED = '[redacted]';

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, REDACTED);
    return u.toString().replace(/%5Bredacted%5D/gi, REDACTED);
  } catch {
    return url;
  }
}

/**
 * The captured requests as a HAR 1.2 archive (the format DevTools, Charles, WebPageTest and bug reports use). Credentials are
 * removed unless `redact` is false: authorization, cookie and similar headers, and token-like query values. Response and
 * request bodies are left out unless `bodies` is set; a body can hold a secret that no header rule can find.
 */
export function toHar(transactions: NetworkTransaction[], options: { redact?: boolean; bodies?: boolean; version?: string } = {}): Record<string, unknown> {
  const redact = options.redact !== false;
  const headers = (h: Record<string, string> | undefined) =>
    Object.entries(h ?? {}).map(([name, value]) => ({ name, value: redact && SECRET_HEADER.test(name) ? REDACTED : value }));
  const entries = [...transactions].sort((a, b) => a.startTime - b.startTime).map(tx => {
    const phases = timingPhases(tx);
    const ms = (label: string) => phases?.phases.find(p => p.label === label)?.duration ?? -1;
    const total = tx.endTime !== undefined ? Math.max(tx.endTime - tx.startTime, 0) : 0;
    const url = redact ? redactUrl(tx.url) : tx.url;
    const query = (() => {
      try {
        return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }));
      } catch {
        return [];
      }
    })();
    const version = (tx.protocol ?? 'http/1.1').toUpperCase().replace('H2', 'HTTP/2').replace('H3', 'HTTP/3');
    const type = tx.mimeType ?? '';
    return {
      startedDateTime: new Date(tx.startTime).toISOString(),
      time: total,
      request: {
        method: tx.method, url, httpVersion: version, cookies: [], headers: headers(tx.requestHeaders), queryString: query,
        ...(options.bodies && tx.requestBody ? { postData: { mimeType: tx.requestHeaders['content-type'] ?? tx.requestHeaders['Content-Type'] ?? '', text: tx.requestBody } } : {}),
        headersSize: -1, bodySize: tx.requestBody ? tx.requestBody.length : 0
      },
      response: {
        status: tx.statusCode ?? 0, statusText: tx.statusText ?? '', httpVersion: version, cookies: [], headers: headers(tx.responseHeaders),
        content: { size: tx.encodedBodyLength ?? 0, mimeType: type, ...(options.bodies && tx.responseBody ? { text: tx.responseBody } : {}) },
        redirectURL: tx.responseHeaders?.location ?? tx.responseHeaders?.Location ?? '', headersSize: -1, bodySize: tx.encodedBodyLength ?? -1
      },
      cache: {},
      timings: { blocked: -1, dns: ms('DNS lookup'), connect: ms('Connecting') + Math.max(ms('TLS handshake'), 0) >= 0 ? Math.max(ms('Connecting'), 0) + Math.max(ms('TLS handshake'), 0) : -1,
        ssl: ms('TLS handshake'), send: ms('Sending'), wait: ms('Waiting for the server'), receive: ms('Downloading') >= 0 ? ms('Downloading') : 0 }
    };
  });
  return { log: { version: '1.2', creator: { name: 'DevBrowser', version: options.version ?? '1.0.0' }, pages: [], entries } };
}
