import type { ApiSendRequest, ApiSendResult } from '../../shared/domain/api-client';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
/** What is kept of a response body for display. The size reported is of everything received. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function failure(req: ApiSendRequest, started: number, error: string, finalUrl = req.url): ApiSendResult {
  return { ok: false, status: 0, statusText: '', headers: {}, body: '', bodyTruncated: false, size: 0,
    durationMs: Math.round(performance.now() - started), finalUrl, error };
}

/** The sentence a developer needs, instead of the networking stack's code. */
export function describeNetworkError(err: unknown, timeoutMs: number): string {
  const text = err instanceof Error ? `${err.name} ${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err);
  if (/TimeoutError|AbortError|aborted/i.test(text)) return `No response within ${Math.round(timeoutMs / 1000)} s.`;
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/.test(text)) return 'Connection refused. Is the server running on that address and port?';
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED/.test(text)) return 'Could not resolve the host name. Check the address.';
  if (/ERR_CERT|CERT_|certificate|SSL/i.test(text)) return 'The server\'s certificate was rejected (self-signed or expired).';
  if (/ECONNRESET|ERR_CONNECTION_RESET|socket hang up/i.test(text)) return 'The server closed the connection.';
  return err instanceof Error ? err.message : String(err);
}

/**
 * Sends one request from the main process (so a page's CORS rules do not apply) and reports what came back.
 * `fetchImpl` is Electron's `net.fetch` in the app and the global `fetch` in tests. Cookies from browsing are not sent:
 * set a Cookie header if the request needs one.
 */
export async function sendApiRequest(req: ApiSendRequest, fetchImpl: typeof fetch): Promise<ApiSendResult> {
  const started = performance.now();
  const timeoutMs = Math.min(Math.max(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const method = req.method.toUpperCase();
  if (!METHODS.has(method)) return failure(req, started, `Unsupported method ${req.method}.`);
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return failure(req, started, 'That is not a valid address. Include http:// or https://.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return failure(req, started, `Only http and https addresses can be sent, not ${url.protocol}`);
  }
  try {
    const res = await fetchImpl(url.href, {
      method, headers: req.headers, body: method === 'GET' || method === 'HEAD' ? undefined : req.body,
      redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs)
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    let kept = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (kept < MAX_BODY_BYTES) {
          const part = value.subarray(0, MAX_BODY_BYTES - kept);
          chunks.push(part);
          kept += part.byteLength;
        }
      }
    }
    const bytes = Buffer.concat(chunks);
    const type = res.headers.get('content-type') ?? '';
    const textual = /json|text|xml|javascript|html|x-www-form-urlencoded|graphql|csv/i.test(type)
      || (!type && !bytes.subarray(0, 1024).includes(0));
    return {
      ok: true, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()),
      body: textual ? bytes.toString('utf8') : `[binary data, ${size} bytes, ${type || 'unknown type'}]`,
      bodyTruncated: size > MAX_BODY_BYTES, size, durationMs: Math.round(performance.now() - started), finalUrl: res.url || url.href
    };
  } catch (err) {
    return failure(req, started, describeNetworkError(err, timeoutMs), url.href);
  }
}
