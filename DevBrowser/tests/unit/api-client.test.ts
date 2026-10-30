import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sendApiRequest } from '../../src/main/network/api-client';
import {
  buildSendRequest, draftFromTransaction, evaluateAssertions, interpolate, jsonPath, looksSecret, parseCurl, shellWords, undefinedVariables,
  type ApiRequestDraft, type ApiSendResult
} from '../../src/shared/domain/api-client';

const draft = (over: Partial<ApiRequestDraft> = {}): ApiRequestDraft => ({
  id: 'd', name: 'x', method: 'GET', url: '{{base}}/items', headers: [], queryParams: [], body: { mode: 'none' }, assertions: [], ...over
});

describe('building a request', () => {
  it('substitutes {{variables}} in the address, headers and body, and adds enabled params', () => {
    const { request, missing } = buildSendRequest(draft({
      method: 'POST', url: '{{base}}/items?a=1#top',
      headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }, { key: 'X-Off', value: 'no', enabled: false }],
      queryParams: [{ key: 'q', value: 'a b&c', enabled: true }, { key: 'skip', value: '1', enabled: false }],
      body: { mode: 'json', raw: '{"id": "{{id}}"}' }
    }), [{ key: 'base', value: 'http://localhost:3000' }, { key: 'token', value: 'abc' }, { key: 'id', value: '7' }]);
    expect(missing).toEqual([]);
    expect(request.url).toBe('http://localhost:3000/items?a=1&q=a%20b%26c#top');
    expect(request.headers).toEqual({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' });
    expect(request.body).toBe('{"id": "7"}');
  });

  it('treats an address with no scheme as http, and knows which names look like credentials', () => {
    expect(buildSendRequest(draft({ url: 'localhost:3000/api' }), []).request.url).toBe('http://localhost:3000/api');
    expect(buildSendRequest(draft({ url: 'https://x.dev/a' }), []).request.url).toBe('https://x.dev/a');
    expect(['Authorization', 'x-api-key', 'authToken', 'Cookie', 'DB_PASSWORD'].every(looksSecret)).toBe(true);
    expect(['baseUrl', 'Content-Type', 'Accept'].some(looksSecret)).toBe(false);
  });

  it('never sends a body with GET or HEAD, and respects an explicit Content-Type', () => {
    const get = buildSendRequest(draft({ body: { mode: 'raw', raw: 'x' } }), [{ key: 'base', value: 'http://h' }]).request;
    expect(get.body).toBeUndefined();
    const post = buildSendRequest(draft({ method: 'POST', body: { mode: 'json', raw: '{}' },
      headers: [{ key: 'content-type', value: 'application/vnd.api+json', enabled: true }] }), [{ key: 'base', value: 'http://h' }]).request;
    expect(post.headers).toEqual({ 'content-type': 'application/vnd.api+json' });
  });

  it('reports variables that are not defined instead of sending a wrong request', () => {
    const { missing } = buildSendRequest(draft({ headers: [{ key: 'X', value: '{{nope}}', enabled: true }] }), []);
    expect(missing.sort()).toEqual(['base', 'nope']);
    expect(interpolate('{{ a }} {{b}}', { a: '1' })).toBe('1 {{b}}');
    expect(undefinedVariables('no variables here')).toEqual([]);
  });

  it('turns a captured request into an editable draft without the headers the browser adds', () => {
    const d = draftFromTransaction({ method: 'POST', url: 'http://localhost:7401/api/cart?x=1', requestBody: '{"a":1}',
      requestHeaders: { Host: 'x', 'Content-Length': '7', 'User-Agent': 'u', 'Content-Type': 'application/json', ':authority': 'x' } });
    expect(d.name).toBe('POST cart');
    expect(d.headers).toEqual([{ key: 'Content-Type', value: 'application/json', enabled: true }]);
    expect(d.body).toEqual({ mode: 'json', raw: '{"a":1}' });
  });
});

describe('assertions', () => {
  const result = (over: Partial<ApiSendResult> = {}): ApiSendResult => ({ ok: true, status: 201, statusText: 'Created', headers: {},
    body: '{"data":{"items":[{"id":5,"name":"mug"}]},"ok":true}', bodyTruncated: false, size: 50, durationMs: 120, finalUrl: 'http://h', ...over });
  const run = (kind: 'status' | 'time' | 'contains' | 'json', value: string, path?: string, r = result()) =>
    evaluateAssertions([{ id: 'a', kind, value, path }], r)[0]!;

  it('checks status exactly, by class and by comparison', () => {
    expect(run('status', '201').passed).toBe(true);
    expect(run('status', '200').passed).toBe(false);
    expect(run('status', '2xx').passed).toBe(true);
    expect(run('status', '<400').passed).toBe(true);
    expect(run('status', '>=500').passed).toBe(false);
  });

  it('checks time, body text and JSON values', () => {
    expect(run('time', '500').passed).toBe(true);
    expect(run('time', '100').message).toContain('took 120 ms');
    expect(run('contains', '"mug"').passed).toBe(true);
    expect(run('json', '5', 'data.items.0.id').passed).toBe(true);
    expect(run('json', 'mug', 'data.items.0.name').passed).toBe(true);
    expect(run('json', 'true', 'ok').passed).toBe(true);
    expect(run('json', 'x', 'data.missing').message).toContain('not found');
    expect(run('json', 'x', 'a', result({ body: 'not json' })).message).toContain('not JSON');
    expect(jsonPath({ a: { b: [1, 2] } }, 'a.b.1')).toBe(2);
  });

  it('fails every check when there was no response', () => {
    const none = result({ ok: false, status: 0, body: '' });
    expect(run('status', '2xx', undefined, none).passed).toBe(false);
    expect(run('time', '1000', undefined, none).passed).toBe(false);
  });
});

describe('sending', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        if (req.url === '/echo') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null,
            body: Buffer.concat(chunks).toString() }));
        } else if (req.url === '/redirect') {
          res.statusCode = 302; res.setHeader('location', '/echo'); res.end();
        } else if (req.url === '/slow') {
          setTimeout(() => res.end('late'), 3000);
        } else if (req.url === '/big') {
          res.setHeader('content-type', 'text/plain'); res.end('x'.repeat(3 * 1024 * 1024));
        } else if (req.url === '/bin') {
          res.setHeader('content-type', 'image/png'); res.end(Buffer.from([0, 1, 2, 3]));
        } else {
          res.statusCode = 404; res.setHeader('content-type', 'application/json'); res.end('{"error":"nope"}');
        }
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  it('sends the method, headers and body and reports the real response', async () => {
    const r = await sendApiRequest({ method: 'POST', url: `${base}/echo`, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: '{"a":1}' }, fetch);
    expect(r).toMatchObject({ ok: true, status: 200, finalUrl: `${base}/echo` });
    expect(JSON.parse(r.body)).toEqual({ method: 'POST', auth: 'Bearer t', cookie: null, body: '{"a":1}' });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.size).toBe(r.body.length);
    expect(r.headers['content-type']).toBe('application/json');
  });

  it('reports an error status as a result, not a failure, and follows redirects', async () => {
    expect(await sendApiRequest({ method: 'GET', url: `${base}/missing`, headers: {} }, fetch)).toMatchObject({ ok: true, status: 404 });
    const r = await sendApiRequest({ method: 'GET', url: `${base}/redirect`, headers: {} }, fetch);
    expect(r.finalUrl).toBe(`${base}/echo`);
  });

  it('says what went wrong when there is no response', async () => {
    const refused = await sendApiRequest({ method: 'GET', url: 'http://127.0.0.1:1/', headers: {} }, fetch);
    expect(refused).toMatchObject({ ok: false, status: 0 });
    expect(refused.error).toMatch(/refused|fetch failed|ECONN/i);
    expect((await sendApiRequest({ method: 'GET', url: 'http://', headers: {} }, fetch)).error).toContain('valid address');
    expect((await sendApiRequest({ method: 'GET', url: 'file:///etc/passwd', headers: {} }, fetch)).error).toContain('Only http');
    expect((await sendApiRequest({ method: 'TRACE', url: base, headers: {} }, fetch)).error).toContain('Unsupported method');
    const slow = await sendApiRequest({ method: 'GET', url: `${base}/slow`, headers: {}, timeoutMs: 1000 }, fetch);
    expect(slow).toMatchObject({ ok: false });
    expect(slow.error).toContain('No response within 1 s');
  });

  it('keeps a bounded body, counts all of it, and does not dump binary', async () => {
    const big = await sendApiRequest({ method: 'GET', url: `${base}/big`, headers: {} }, fetch);
    expect(big.size).toBe(3 * 1024 * 1024);
    expect(big.bodyTruncated).toBe(true);
    expect(big.body.length).toBe(2 * 1024 * 1024);
    const bin = await sendApiRequest({ method: 'GET', url: `${base}/bin`, headers: {} }, fetch);
    expect(bin.body).toBe('[binary data, 4 bytes, image/png]');
  });
});

describe('network timing', () => {
  it('turns what the browser reported into phases, and says nothing when it reported nothing', async () => {
    const { timingPhases } = await import('../../src/shared/domain/network');
    const t = timingPhases({ startTime: 1000, endTime: 1100, timing: { requestTime: 5, dnsStart: 0, dnsEnd: 4, connectStart: 4, connectEnd: 20,
      sslStart: 10, sslEnd: 20, sendStart: 20, sendEnd: 21, receiveHeadersEnd: 60 } })!;
    expect(t.phases.map(p => [p.label, p.duration])).toEqual([['DNS lookup', 4], ['Connecting', 6], ['TLS handshake', 10], ['Sending', 1],
      ['Waiting for the server', 39], ['Downloading', 40]]);
    expect(t.total).toBe(100);
    // A reused connection has no DNS or connect (-1): those phases are simply absent.
    const reused = timingPhases({ startTime: 0, endTime: 30, timing: { requestTime: 1, dnsStart: -1, dnsEnd: -1, connectStart: -1, connectEnd: -1,
      sslStart: -1, sslEnd: -1, sendStart: 0, sendEnd: 1, receiveHeadersEnd: 25 } })!;
    expect(reused.phases.map(p => p.label)).toEqual(['Sending', 'Waiting for the server', 'Downloading']);
    expect(timingPhases({ startTime: 0, endTime: 5 })).toBeNull();
  });
});


describe('importing a cURL command', () => {
  it('reads what DevTools\' "Copy as cURL" produces, with quotes and line continuations', () => {
    const d = parseCurl(`curl 'https://api.example.com/v1/orders?expand=items' \\
      -H 'accept: application/json' \\
      -H 'authorization: Bearer abc.def' \\
      -H $'content-type: application/json' \\
      --data-raw '{"sku":"mug","qty":2}' \\
      --compressed`)!;
    expect(d.method).toBe('POST');  // a body with no -X means POST
    expect(d.url).toBe('https://api.example.com/v1/orders?expand=items');
    expect(d.headers.map(h => [h.key, h.value])).toContainEqual(['authorization', 'Bearer abc.def']);
    expect(d.headers.map(h => [h.key, h.value])).toContainEqual(['content-type', 'application/json']);  // from $'...'
    expect(d.body).toEqual({ mode: 'json', raw: '{"sku":"mug","qty":2}' });
  });

  it('handles explicit methods, basic auth, cookies, --json and a URL anywhere', () => {
    expect(parseCurl('curl -X DELETE https://h.dev/items/7')).toMatchObject({ method: 'DELETE', url: 'https://h.dev/items/7', body: { mode: 'none' } });
    const auth = parseCurl('curl -u me:secret https://h.dev/')!;
    expect(auth.headers).toEqual([{ key: 'Authorization', value: `Basic ${btoa('me:secret')}`, enabled: true }]);
    expect(parseCurl('curl https://h.dev/ -b "a=1; b=2"')!.headers).toEqual([{ key: 'Cookie', value: 'a=1; b=2', enabled: true }]);
    const j = parseCurl(`curl --json '{"a":1}' https://h.dev/x`)!;
    expect(j.method).toBe('POST');
    expect(j.headers).toContainEqual({ key: 'Content-Type', value: 'application/json', enabled: true });
    expect(parseCurl('curl --url=https://h.dev/y -X PUT -d x=1')).toMatchObject({ url: 'https://h.dev/y', method: 'PUT', body: { mode: 'raw', raw: 'x=1' } });
  });

  it('treats -G data as the query string and -I as HEAD, and joins several -d', () => {
    expect(parseCurl('curl -G https://h.dev/s -d q=a -d page=2')).toMatchObject({ method: 'GET', url: 'https://h.dev/s?q=a&page=2', body: { mode: 'none' } });
    expect(parseCurl('curl -I https://h.dev/')!.method).toBe('HEAD');
    expect(parseCurl('curl -d a=1 -d b=2 https://h.dev/')!.body).toEqual({ mode: 'raw', raw: 'a=1&b=2' });
  });

  it('is not fooled by things that are not a request', () => {
    expect(parseCurl('')).toBeNull();
    expect(parseCurl('wget https://h.dev')).toBeNull();
    expect(parseCurl('curl -s -o out.txt')).toBeNull();           // no URL
    expect(parseCurl('/usr/bin/curl https://h.dev/')!.url).toBe('https://h.dev/');
  });

  it('splits shell words', () => {
    expect(shellWords(`a 'b c' "d \\"e\\"" f\\ g`)).toEqual(['a', 'b c', 'd "e"', 'f g']);
  });
});

describe('ANSI-C quoting', () => {
  it("understands $'...' with its escapes", () => {
    expect(shellWords(String.raw`x $'it\'s\n\x41B'`)).toEqual(['x', "it's\nAB"]);
  });
});


describe('HAR export', () => {
  const tx = (over: Record<string, unknown> = {}) => ({
    id: 'a', tabId: 't', url: 'http://localhost:7401/api/cart?token=abc123&page=2', method: 'POST', statusCode: 201, statusText: 'Created',
    protocol: 'http/1.1', mimeType: 'application/json', requestHeaders: { Authorization: 'Bearer secret', 'Content-Type': 'application/json', Accept: '*/*' },
    responseHeaders: { 'set-cookie': 'sid=1', 'content-type': 'application/json' }, requestBody: '{"p":"x"}', responseBody: '{"ok":true}',
    startTime: 2000, endTime: 2100, encodedBodyLength: 11, isTruncated: false,
    timing: { requestTime: 1, dnsStart: -1, dnsEnd: -1, connectStart: -1, connectEnd: -1, sslStart: -1, sslEnd: -1, sendStart: 0, sendEnd: 1, receiveHeadersEnd: 60 },
    ...over }) as never;

  it('is a HAR 1.2 archive with the request, response and the browser\'s real timings', async () => {
    const { toHar } = await import('../../src/shared/domain/network');
    const har = toHar([tx(), tx({ id: 'b', startTime: 1000, endTime: 1010, timing: undefined, url: 'http://localhost:7401/x' })]) as any;
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator.name).toBe('DevBrowser');
    expect(har.log.entries.map((e: any) => e.startedDateTime)).toEqual([new Date(1000).toISOString(), new Date(2000).toISOString()]); // oldest first
    const e = har.log.entries[1];
    expect(e).toMatchObject({ time: 100, request: { method: 'POST' }, response: { status: 201, statusText: 'Created', content: { size: 11, mimeType: 'application/json' } } });
    expect(e.timings).toMatchObject({ dns: -1, send: 1, wait: 59, receive: 40 });
    expect(har.log.entries[0].timings).toMatchObject({ send: -1, wait: -1, receive: 0 }); // no phases reported: not invented
  });

  it('removes credentials by default and says so, but not when asked to keep them', async () => {
    const { toHar } = await import('../../src/shared/domain/network');
    const safe = JSON.stringify(toHar([tx()]));
    expect(safe).not.toMatch(/Bearer secret|abc123|sid=1/);
    expect(safe).toContain('[redacted]');
    expect(safe).toContain('page=2');                      // ordinary values stay
    expect(JSON.stringify(toHar([tx()], { redact: false }))).toMatch(/Bearer secret.*abc123|abc123.*Bearer secret/);
  });

  it('leaves bodies out unless they are asked for', async () => {
    const { toHar } = await import('../../src/shared/domain/network');
    expect(JSON.stringify(toHar([tx()]))).not.toMatch(/"p":"x"|"ok":true/);
    const withBodies = toHar([tx()], { bodies: true }) as any;
    expect(withBodies.log.entries[0].request.postData.text).toBe('{"p":"x"}');
    expect(withBodies.log.entries[0].response.content.text).toBe('{"ok":true}');
    expect((toHar([]) as any).log.entries).toEqual([]);
  });
});


describe('network throttling', () => {
  it('maps the presets to what the browser needs, in bytes per second', async () => {
    const { throttleConditions } = await import('../../src/shared/domain/browser');
    expect(throttleConditions('none')).toEqual({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    expect(throttleConditions('slow-3g')).toEqual({ offline: false, latency: 2000, downloadThroughput: 50_000, uploadThroughput: 50_000 });
    expect(throttleConditions('fast-3g')).toMatchObject({ latency: 562.5, downloadThroughput: 200_000, uploadThroughput: 93_750 });
    expect(throttleConditions('offline').offline).toBe(true);
    expect(throttleConditions('nonsense')).toEqual(throttleConditions('none'));  // unknown means off, never a surprise slowdown
  });
});
