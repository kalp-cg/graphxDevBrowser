import { z } from 'zod';

export const ApiParamSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true)
});
export type ApiParam = z.infer<typeof ApiParamSchema>;

export const ApiHeaderSchema = ApiParamSchema;
export type ApiHeader = ApiParam;

export const ApiRequestBodySchema = z.object({
  mode: z.enum(['none', 'json', 'raw']),
  raw: z.string().optional()
});
export type ApiRequestBody = z.infer<typeof ApiRequestBodySchema>;

export type AssertionKind = 'status' | 'time' | 'contains' | 'json';

/** What a response must satisfy. `status`: `200`, `2xx`, `<400`. `time`: milliseconds, an upper bound. `contains`: text in
 * the body. `json`: the value at a dotted path (`data.items.0.id`) equals `value`. */
export const ApiAssertionSchema = z.object({
  id: z.string(),
  kind: z.enum(['status', 'time', 'contains', 'json']),
  path: z.string().optional(),
  value: z.string()
});
export type ApiAssertion = z.infer<typeof ApiAssertionSchema>;

export const ApiRequestDraftSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
  url: z.string(),
  headers: z.array(ApiHeaderSchema),
  queryParams: z.array(ApiParamSchema),
  body: ApiRequestBodySchema,
  assertions: z.array(ApiAssertionSchema).default([])
});
export type ApiRequestDraft = z.infer<typeof ApiRequestDraftSchema>;

/** `{{name}}` in a URL, header or body is replaced by the variable of that name. */
export interface ApiVariable {
  key: string;
  value: string;
}

export interface ApiSendRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface ApiSendResult {
  /** The request reached a server and got a response. False for a refused connection, a timeout, a bad address. */
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  /** Bytes received, before truncation for display. */
  size: number;
  durationMs: number;
  finalUrl: string;
  error?: string;
}

export interface AssertionResult {
  id: string;
  passed: boolean;
  message: string;
}

const VAR = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(VAR, (whole, name: string) => (name in vars ? vars[name]! : whole));
}

export function variablesOf(list: ApiVariable[]): Record<string, string> {
  return Object.fromEntries(list.filter(v => v.key.trim()).map(v => [v.key.trim(), v.value]));
}

/** `{{names}}` still present after substitution: the request would be wrong, so it is not sent. */
export function undefinedVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR)].map(m => m[1]!))];
}

export function buildSendRequest(draft: ApiRequestDraft, variables: ApiVariable[]):
  { request: ApiSendRequest; missing: string[] } {
  const vars = variablesOf(variables);
  const sub = (s: string) => interpolate(s, vars);
  let url = sub(draft.url.trim());
  if (url && !/^[a-z][a-z\d+.-]*:\/\//i.test(url)) url = `http://${url}`; // `localhost:3000/api` is http
  const params = draft.queryParams.filter(p => p.enabled && p.key.trim());
  if (params.length) {
    const query = params.map(p => `${encodeURIComponent(sub(p.key))}=${encodeURIComponent(sub(p.value))}`).join('&');
    const [beforeHash, hash] = url.split('#');
    url = `${beforeHash}${beforeHash!.includes('?') ? '&' : '?'}${query}${hash ? `#${hash}` : ''}`;
  }
  const headers: Record<string, string> = {};
  for (const h of draft.headers.filter(h => h.enabled && h.key.trim())) headers[sub(h.key.trim())] = sub(h.value);
  const hasBody = draft.body.mode !== 'none' && !['GET', 'HEAD'].includes(draft.method);
  const body = hasBody ? sub(draft.body.raw ?? '') : undefined;
  if (hasBody && draft.body.mode === 'json' && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const missing = undefinedVariables([url, ...Object.entries(headers).flat(), body ?? ''].join('\n'));
  return { request: { method: draft.method, url, headers, body }, missing };
}

const SECRET_KEY = /authorization|cookie|token|secret|api[-_]?key|password|passwd/i;

/** Whether a header or variable name suggests a credential. Those values are not written to disk. */
export function looksSecret(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** The value at a dotted path (`data.items.0.id`) of parsed JSON, or undefined. */
export function jsonPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function statusMatches(expected: string, status: number): boolean {
  const e = expected.trim();
  const range = /^([1-5])xx$/i.exec(e);
  if (range) return Math.floor(status / 100) === Number(range[1]);
  const cmp = /^(<=|>=|<|>)\s*(\d+)$/.exec(e);
  if (cmp) {
    const n = Number(cmp[2]);
    return cmp[1] === '<' ? status < n : cmp[1] === '<=' ? status <= n : cmp[1] === '>' ? status > n : status >= n;
  }
  return status === Number(e);
}

export function evaluateAssertions(assertions: ApiAssertion[], result: ApiSendResult): AssertionResult[] {
  return assertions.map(a => {
    switch (a.kind) {
      case 'status':
        return { id: a.id, passed: result.ok && statusMatches(a.value, result.status),
          message: `status ${a.value}: got ${result.ok ? result.status : 'no response'}` };
      case 'time': {
        const limit = Number(a.value);
        return { id: a.id, passed: result.ok && result.durationMs < limit, message: `under ${a.value} ms: took ${result.durationMs} ms` };
      }
      case 'contains':
        return { id: a.id, passed: result.body.includes(a.value), message: `body contains "${a.value}"` };
      case 'json': {
        let actual: unknown;
        try {
          actual = jsonPath(JSON.parse(result.body), a.path ?? '');
        } catch {
          return { id: a.id, passed: false, message: `${a.path}: the body is not JSON` };
        }
        if (actual === undefined) return { id: a.id, passed: false, message: `${a.path}: not found` };
        const shown = typeof actual === 'string' ? actual : JSON.stringify(actual);
        return { id: a.id, passed: shown === a.value, message: `${a.path} = ${a.value}: got ${shown}` };
      }
    }
  });
}

/** A request captured by the Network panel, as a draft to edit and replay. */
export function draftFromTransaction(tx: { method: string; url: string; requestHeaders: Record<string, string>; requestBody?: string }):
  ApiRequestDraft {
  const skip = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'user-agent']);
  return {
    id: `draft-${Date.now()}`,
    name: `${tx.method} ${tx.url.split('?')[0]!.split('/').pop() || 'request'}`,
    method: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(tx.method) ? tx.method : 'GET') as ApiRequestDraft['method'],
    url: tx.url,
    headers: Object.entries(tx.requestHeaders).filter(([k]) => !skip.has(k.toLowerCase()) && !k.startsWith(':'))
      .map(([key, value]) => ({ key, value, enabled: true })),
    queryParams: [],
    body: tx.requestBody ? { mode: 'json', raw: tx.requestBody } : { mode: 'none' },
    assertions: []
  };
}

/** Splits a shell command into words the way a shell would: quotes, backslash escapes and line continuations. */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let cur = '';
  let started = false;
  const text = command.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '$' && text[i + 1] === "'") {
      // $'...' (what Chrome's "Copy as cURL" emits): quotes with backslash escapes
      started = true;
      let j = i + 2;
      for (; j < text.length && text[j] !== "'"; j++) {
        if (text[j] === '\\') {
          const e = text[++j] ?? '';
          const hex = e === 'x' ? /^[0-9a-f]{1,2}/i.exec(text.slice(j + 1)) : e === 'u' ? /^[0-9a-f]{1,4}/i.exec(text.slice(j + 1)) : null;
          if (hex) { cur += String.fromCharCode(parseInt(hex[0], 16)); j += hex[0].length; }
          else cur += ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[e] ?? e;
        } else cur += text[j]!;
      }
      i = j;
    } else if (c === "'") {
      started = true;
      const end = text.indexOf("'", i + 1);
      cur += text.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? text.length : end;
    } else if (c === '"') {
      started = true;
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && /["\\$`]/.test(text[j + 1] ?? '')) j++;
        cur += text[j]!;
      }
      i = j;
    } else if (c === '\\' && i + 1 < text.length) {
      started = true;
      cur += text[++i]!;
    } else if (/\s/.test(c)) {
      if (started) words.push(cur);
      cur = '';
      started = false;
    } else {
      started = true;
      cur += c;
    }
  }
  if (started) words.push(cur);
  return words;
}

/**
 * A `curl` command (from API docs, or "Copy as cURL" in any DevTools) as a request draft. Understands the options that
 * shape a request: -X, -H, -d/--data*, --json, -u, -b, -A, -e, -G, -I and the URL. Returns null when there is no URL.
 */
export function parseCurl(command: string): ApiRequestDraft | null {
  const words = shellWords(command.trim());
  if (!words.length || words[0]!.replace(/^.*\//, '') !== 'curl') return null;
  let method: string | null = null;
  let url = '';
  const headers: ApiHeader[] = [];
  const data: string[] = [];
  let json = false;
  let get = false;
  let head = false;
  const takes = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
    '--data-urlencode', '--json', '-u', '--user', '-b', '--cookie', '-A', '--user-agent', '-e', '--referer', '--url', '-o', '--output',
    '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-w', '--write-out']);
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    const eq = w.startsWith('--') && w.includes('=') ? w.indexOf('=') : -1;
    const flag = eq > 0 ? w.slice(0, eq) : w;
    const next = (): string => (eq > 0 ? w.slice(eq + 1) : (takes.has(flag) ? words[++i] ?? '' : ''));
    if (flag === '-G' || flag === '--get') get = true;
    else if (flag === '-I' || flag === '--head') head = true;
    else if (flag === '-X' || flag === '--request') method = next().toUpperCase();
    else if (flag === '-H' || flag === '--header') {
      const h = next();
      const at = h.indexOf(':');
      if (at > 0) headers.push({ key: h.slice(0, at).trim(), value: h.slice(at + 1).trim(), enabled: true });
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'].includes(flag)) data.push(next());
    else if (flag === '--json') { data.push(next()); json = true; }
    else if (flag === '-u' || flag === '--user') headers.push({ key: 'Authorization', value: `Basic ${btoa(next())}`, enabled: true });
    else if (flag === '-b' || flag === '--cookie') headers.push({ key: 'Cookie', value: next(), enabled: true });
    else if (flag === '-A' || flag === '--user-agent') headers.push({ key: 'User-Agent', value: next(), enabled: true });
    else if (flag === '-e' || flag === '--referer') headers.push({ key: 'Referer', value: next(), enabled: true });
    else if (flag === '--url') url = next();
    else if (takes.has(flag)) next();
    else if (!w.startsWith('-') && !url) url = w;
  }
  if (!url) return null;
  if (json && !headers.some(h => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
  const body = data.join('&');
  let queryParams: ApiParam[] = [];
  if (get && body) {  // -G: the data is the query string
    url += (url.includes('?') ? '&' : '?') + body;
    queryParams = [];
  }
  const verb = (head ? 'HEAD' : method ?? (body && !get ? 'POST' : 'GET')) as ApiRequestDraft['method'];
  const looksJson = /^\s*[[{]/.test(body) || headers.some(h => h.key.toLowerCase() === 'content-type' && /json/i.test(h.value));
  return {
    id: `curl-${Date.now()}`, name: `${verb} ${url.replace(/^https?:\/\//, '').split('?')[0]}`.slice(0, 60),
    method: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(verb) ? verb : 'GET') as ApiRequestDraft['method'],
    url, headers, queryParams,
    body: body && !get ? { mode: looksJson ? 'json' : 'raw', raw: body } : { mode: 'none' }, assertions: []
  };
}
