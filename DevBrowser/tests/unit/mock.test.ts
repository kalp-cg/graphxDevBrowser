import { describe, expect, it } from 'vitest';
import {
  MOCK_HEADER, MockStateSchema, buildResponse, firstMatch, headerLines, interceptPattern, matchUrl, newRule, parseHeaderLines,
  preflightResponse, ruleFromTransaction, rulesFromHar, rulesFromRecording, statusText, summarizeRule
} from '../../src/shared/domain/mock';
import { buildRecording } from '../../src/shared/domain/recording';

describe('matching', () => {
  it('matches full addresses, addresses without a scheme, and paths', () => {
    const url = 'http://localhost:3100/api/products?limit=2';
    expect(matchUrl('http://localhost:3100/api/*', url)).toBe(true);
    expect(matchUrl('localhost:3100/api/products*', url)).toBe(true);
    expect(matchUrl('/api/products*', url)).toBe(true);
    expect(matchUrl('/api/products', url)).toBe(true);        // the path alone, whatever the query
    expect(matchUrl('/api/cart*', url)).toBe(false);
    expect(matchUrl('http://localhost:3100/api/products', url)).toBe(true);      // no ? in the pattern: the query is ignored
    expect(matchUrl('http://localhost:3100/api/products', 'http://localhost:3100/api/products/1')).toBe(false);
    expect(matchUrl('/api/products?limit=3', url)).toBe(false);                  // a ? in the pattern: it must match
    expect(matchUrl('http://other.test/*', url)).toBe(false);
  });
  it('treats everything but * literally, so a pattern cannot be a regex', () => {
    expect(matchUrl('/api/a.b', 'http://x.test/api/axb')).toBe(false);
    expect(matchUrl('/api/(a|b)', 'http://x.test/api/a')).toBe(false);
    expect(matchUrl('/api/(a|b)', 'http://x.test/api/(a|b)')).toBe(true);
  });
  it('the first enabled rule that matches the method and address wins', () => {
    const a = newRule({ url: '/api/*', method: 'POST', status: 201 });
    const b = newRule({ url: '/api/*', status: 500 });
    const off = newRule({ url: '/api/x', enabled: false, status: 418 });
    expect(firstMatch([off, a, b], 'POST', 'http://x.test/api/x')).toBe(a);
    expect(firstMatch([off, a, b], 'GET', 'http://x.test/api/x')).toBe(b);
    expect(firstMatch([off], 'GET', 'http://x.test/api/x')).toBeUndefined();
  });
  it('pauses only what a rule could match', () => {
    expect(interceptPattern({ url: 'http://localhost:3100/api/*' })).toBe('http://localhost:3100/api/*');
    expect(interceptPattern({ url: '/api/*' })).toBe('*/api/*');
    expect(interceptPattern({ url: '/api/items' })).toBe('*/api/items*');        // a query may follow
    expect(interceptPattern({ url: '/api/items?id=1' })).toBe('*/api/items?id=1');
  });
});

describe('responses', () => {
  const rule = newRule({ id: 'r1', status: 503, body: '{"error":"down"}', headers: { 'X-Custom': '1', 'Content-Length': '999' } });
  it('adds the content type, CORS for the requesting origin, and the mock marker; drops headers it must compute', () => {
    const r = buildResponse(rule, 'http://localhost:3000');
    const h = Object.fromEntries(r.headers.map(x => [x.name, x.value]));
    expect(r.status).toBe(503);
    expect(r.statusText).toBe('Service Unavailable');
    expect(h['content-type']).toContain('application/json');
    expect(h['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(h['access-control-allow-credentials']).toBe('true');
    expect(h[MOCK_HEADER]).toBe('r1');
    expect(h['x-custom']).toBe('1');
    expect(h['content-length']).toBeUndefined();
  });
  it('keeps the rule\'s own CORS and content type, and uses * when there is no origin', () => {
    const own = buildResponse(newRule({ headers: { 'access-control-allow-origin': 'https://a.test', 'content-type': 'text/csv' }, body: 'a,b' }), 'http://x');
    expect(Object.fromEntries(own.headers.map(x => [x.name, x.value]))).toMatchObject({ 'access-control-allow-origin': 'https://a.test', 'content-type': 'text/csv' });
    expect(buildResponse(newRule({ body: 'hi' })).headers.find(x => x.name === 'access-control-allow-origin')?.value).toBe('*');
  });
  it('answers a CORS preflight', () => {
    const r = preflightResponse({ id: 'r1' }, 'http://localhost:3000', 'content-type,x-a');
    expect(r.status).toBe(204);
    expect(r.headers.find(h => h.name === 'access-control-allow-headers')?.value).toBe('content-type,x-a');
  });
  it('edits headers as lines', () => {
    expect(parseHeaderLines('A: 1\n bad line\nB:two: three\n: x')).toEqual({ A: '1', B: 'two: three' });
    expect(headerLines({ A: '1', B: '2' })).toBe('A: 1\nB: 2');
  });
});

describe('rules from a request', () => {
  const tx = { url: 'http://localhost:3100/api/pay?x=1', method: 'POST', statusCode: 200, responseHeaders: { 'Content-Type': 'application/json' }, responseBody: '{"ok":true}', mimeType: 'application/json' };
  it('mock: the captured response, ready to edit', () => {
    const r = ruleFromTransaction(tx, 'mock');
    expect(r).toMatchObject({ method: 'POST', url: 'http://localhost:3100/api/pay', kind: 'respond', status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } });
  });
  it('500, 404, delay and drop', () => {
    expect(ruleFromTransaction(tx, '500')).toMatchObject({ kind: 'respond', status: 500 });
    expect(ruleFromTransaction(tx, '404')).toMatchObject({ kind: 'respond', status: 404 });
    expect(ruleFromTransaction(tx, 'delay')).toMatchObject({ kind: 'passthrough', delayMs: 5000 });
    expect(ruleFromTransaction(tx, 'drop')).toMatchObject({ kind: 'drop' });
  });
  it('a rule made from a CORS preflight applies to any method', () => {
    expect(ruleFromTransaction({ ...tx, method: 'OPTIONS', statusCode: 204 }, '500').method).toBe('*');
  });
  it('an exact address when there was no query', () => {
    expect(ruleFromTransaction({ ...tx, url: 'http://localhost:3100/api/pay' }, '500').url).toBe('http://localhost:3100/api/pay');
  });
});

describe('rules from a HAR file and from a recording', () => {
  const har = (entries: unknown[]) => JSON.stringify({ log: { entries } });
  const entry = (method: string, url: string, status: number, mimeType: string, text?: string) => ({ request: { method, url }, response: { status, content: { mimeType, text } } });
  it('keeps data calls with bodies, newest answer per call, and skips pages, scripts and body-less calls', () => {
    const r = rulesFromHar(har([
      entry('GET', 'http://x.test/', 200, 'text/html', '<html>'),
      entry('GET', 'http://x.test/app.js', 200, 'application/javascript', 'x'),
      entry('GET', 'http://x.test/api/items', 200, 'application/json', '[1]'),
      entry('GET', 'http://x.test/api/items', 200, 'application/json', '[1,2]'),
      entry('POST', 'http://x.test/api/pay', 500, 'application/json'),
    ]));
    expect(r.ok && r.rules.map(x => `${x.method} ${x.url} ${x.body}`)).toEqual(['GET http://x.test/api/items [1,2]']);
    expect(r.ok && r.skipped).toBe(1);
  });
  it('refuses what is not a HAR', () => {
    expect(rulesFromHar('nope')).toMatchObject({ ok: false });
    expect(rulesFromHar('{"a":1}')).toMatchObject({ ok: false });
  });
  it('a recording becomes a backend-free run: its data calls, with the recorded status and body', () => {
    const rec = buildRecording({ id: 'r', title: 't', startedAt: 0, endedAt: 1, startUrl: 'http://localhost:3000/', viewport: { width: 1, height: 1 }, redactions: 0, appVersion: 't', steps: [
      { t: 1, kind: 'request', id: 'a', method: 'GET', url: 'http://localhost:3100/api/products', status: 200, mimeType: 'application/json', responseBody: '[{"id":1}]' },
      { t: 2, kind: 'request', id: 'b', method: 'POST', url: 'http://localhost:3100/api/checkout', status: 502, mimeType: 'application/json', responseBody: '{"error":"x"}' },
      { t: 3, kind: 'request', id: 'c', method: 'GET', url: 'http://localhost:3000/logo.png', status: 200, mimeType: 'image/png' },
      { t: 4, kind: 'request', id: 'd', method: 'GET', url: 'http://localhost:3100/api/down', error: 'net::ERR_FAILED' }
    ] });
    const rules = rulesFromRecording(rec);
    expect(rules.map(r => `${r.method} ${r.url} ${r.status}`).sort()).toEqual(['GET http://localhost:3100/api/products 200', 'POST http://localhost:3100/api/checkout 502']);
  });
});

describe('the state sent to the main process', () => {
  it('accepts valid rules and refuses garbage', () => {
    expect(MockStateSchema.safeParse({ enabled: true, rules: [newRule({ url: '/a' })] }).success).toBe(true);
    expect(MockStateSchema.safeParse({ enabled: true, rules: [{ ...newRule({ url: '/a' }), status: 99 }] }).success).toBe(false);
    expect(MockStateSchema.safeParse({ enabled: true, rules: [{ ...newRule({ url: '/a' }), kind: 'explode' }] }).success).toBe(false);
    expect(MockStateSchema.safeParse({ enabled: 'yes', rules: [] }).success).toBe(false);
  });
  it('describes a rule in one line', () => {
    expect(summarizeRule(newRule({ method: 'GET', url: '/api/x', status: 500 }))).toBe('GET /api/x → 500 Internal Server Error');
    expect(summarizeRule(newRule({ kind: 'drop', url: '/api/x' }))).toBe('ANY /api/x → connection dropped');
    expect(summarizeRule(newRule({ kind: 'passthrough', delayMs: 5000, url: '/a' }))).toContain('delayed 5000 ms');
    expect(statusText(418)).toBe("I'm a Teapot");
  });
});
