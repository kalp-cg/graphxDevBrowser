import { describe, it, expect } from 'vitest';
import {
  layeredLayout,
  toBlastRadius,
  toDevBrowserGraph,
  toTrafficRecord,
  type SentinelSnapshot
} from '../../src/shared/domain/sentinel';
import { SentinelGraphClient, type SecretStore } from '../../src/main/integrations/sentinel-client';
import type { NetworkTransaction } from '../../src/shared/domain/network';

const snapshot: SentinelSnapshot = {
  nodes: [
    { id: 'svc:web:localhost:3000', type: 'Service', name: 'web:localhost:3000', label: 'web:localhost:3000' },
    { id: 'svc:checkout-api', type: 'Service', name: 'checkout-api', label: 'checkout-api', status: 'degraded', layer: 'edge' },
    { id: 'svc:payments', type: 'Service', name: 'payments', label: 'payments', status: 'down' },
    { id: 'db:orders', type: 'Database', name: 'orders', label: 'orders' },
    { id: 'team:checkout', type: 'Team', name: 'Checkout', label: 'Checkout' }
  ],
  links: [
    { id: 'e:web:localhost:3000->checkout-api', source: 'svc:web:localhost:3000', target: 'svc:checkout-api', type: 'DEPENDS_ON' },
    { id: 'e:checkout-api->payments', source: 'svc:checkout-api', target: 'svc:payments', type: 'DEPENDS_ON' },
    { id: 'e:payments-writes_to->orders', source: 'svc:payments', target: 'db:orders', type: 'WRITES_TO' },
    { id: 'OWNS:team:checkout->svc:checkout-api', source: 'team:checkout', target: 'svc:checkout-api', type: 'OWNS' }
  ]
};

describe('SentinelGraph graph mapping', () => {
  it('keeps services, web apps and databases with their dependencies', () => {
    const { nodes, edges } = toDevBrowserGraph(snapshot);
    expect(nodes.map(n => [n.id, n.type])).toEqual([
      ['svc:web:localhost:3000', 'FrontendRoute'],
      ['svc:checkout-api', 'Service'],
      ['svc:payments', 'Service'],
      ['db:orders', 'Database']
    ]);
    expect(edges.map(e => [e.sourceId, e.targetId, e.type])).toEqual([
      ['svc:web:localhost:3000', 'svc:checkout-api', 'DEPENDS_ON'],
      ['svc:checkout-api', 'svc:payments', 'DEPENDS_ON'],
      ['svc:payments', 'db:orders', 'PRODUCES']
    ]);
    expect(nodes[2]?.metadata.status).toBe('down');
  });

  it('turns the GSQL blast radius into DevBrowser\'s result', () => {
    const { nodes } = toDevBrowserGraph(snapshot);
    const res = toBlastRadius('svc:payments', {
      result: {
        service: 'payments', count: 2,
        impacted: [
          { name: 'checkout-api', uid: 'svc:checkout-api', status: 'degraded', tier: 'critical', hops: 1 },
          { name: 'web:localhost:3000', uid: 'svc:web:localhost:3000', status: 'healthy', tier: '', hops: 2 }
        ]
      },
      gsql: 'INTERPRET QUERY ...',
      edge_uids: ['e:checkout-api->payments', 'e:web:localhost:3000->checkout-api']
    }, nodes);
    expect(res.affectedNodes.map(n => n.id)).toEqual(['svc:web:localhost:3000', 'svc:checkout-api']);
    expect(res.impactScore).toBe(1); // both other services are affected
    expect(res.dependencyChain[0]).toEqual(['svc:checkout-api', 'svc:payments']);
  });

  it('lays dependencies out top to bottom', () => {
    const { nodes, edges } = toDevBrowserGraph(snapshot);
    const { positions, width, height } = layeredLayout(nodes, edges);
    const y = (id: string) => positions[id]!.y;
    expect(y('svc:web:localhost:3000')).toBeLessThan(y('svc:checkout-api'));
    expect(y('svc:checkout-api')).toBeLessThan(y('svc:payments'));
    expect(y('svc:payments')).toBeLessThan(y('db:orders'));
    expect(positions['svc:web:localhost:3000']!.tier).toBe('client');
    expect(positions['svc:checkout-api']!.tier).toBe('gateway');
    expect(positions['db:orders']!.tier).toBe('storage');
    expect(width).toBeGreaterThanOrEqual(800);
    expect(height).toBeGreaterThanOrEqual(660);
  });

  it('survives a dependency cycle', () => {
    const nodes = [
      { id: 'a', type: 'Service' as const, name: 'a', metadata: {} },
      { id: 'b', type: 'Service' as const, name: 'b', metadata: {} }
    ];
    const edges = [
      { sourceId: 'a', targetId: 'b', type: 'DEPENDS_ON' as const, metadata: {} },
      { sourceId: 'b', targetId: 'a', type: 'DEPENDS_ON' as const, metadata: {} }
    ];
    expect(Object.keys(layeredLayout(nodes, edges).positions).sort()).toEqual(['a', 'b']);
  });

  it('makes traffic records only for pages that are web pages', () => {
    const tx = {
      id: '1', tabId: 't', url: 'http://api.local/cart', method: 'GET', statusCode: 503,
      mimeType: 'application/json', requestHeaders: {}, startTime: 10, endTime: 50
    } as NetworkTransaction;
    expect(toTrafficRecord(tx, 'http://localhost:3000/cart')).toEqual({
      pageUrl: 'http://localhost:3000/cart', url: 'http://api.local/cart', method: 'GET', statusCode: 503,
      mimeType: 'application/json', startTime: 10, endTime: 50
    });
    expect(toTrafficRecord(tx, 'devtools://devtools')).toBeNull();
  });
});

describe('SentinelGraphClient', () => {
  const vault: SecretStore = {
    encryptSecret: s => Buffer.from(s).toString('base64'),
    decryptSecret: s => Buffer.from(s, 'base64').toString()
  };

  function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('keeps the token encrypted and signs requests with it', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { tigergraph: { ok: true, services: 38 }, graph: 'Sentinel' } }]);
    const client = new SentinelGraphClient(vault, impl);
    client.configure('http://localhost:8100/', 'admin-123');
    const status = await client.status();
    client.dispose();
    expect(status).toMatchObject({ ok: true, graph: 'Sentinel', services: 38 });
    expect(calls[0]!.url).toBe('http://localhost:8100/api/health');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Admin-Token']).toBe('admin-123');
    expect(JSON.stringify(client)).not.toContain('admin-123');
  });

  it('batches traffic and keeps a failed batch for the next try', async () => {
    const { impl, calls } = fakeFetch([{ status: 503, body: {} }, { status: 200, body: {} }]);
    const client = new SentinelGraphClient(vault, impl);
    client.configure('http://localhost:8100', 't');
    const rec = { pageUrl: 'http://localhost:3000/', url: 'http://api.local/x', method: 'GET', startTime: 1 };
    client.record(rec);
    client.record(rec);
    expect(await client.flush()).toBe(false);
    expect(await client.flush()).toBe(true);
    client.dispose();
    expect(calls.map(c => c.url)).toEqual([
      'http://localhost:8100/api/browser-traffic', 'http://localhost:8100/api/browser-traffic'
    ]);
    expect(JSON.parse(calls[1]!.init.body as string)).toHaveLength(2);
  });

  it('reports a clear status when not configured or unreachable', async () => {
    const unconfigured = new SentinelGraphClient(vault, fakeFetch([]).impl);
    expect((await unconfigured.status()).ok).toBe(false);
    const { impl } = fakeFetch([{ status: 401, body: { detail: 'missing or invalid X-Admin-Token' } }]);
    const client = new SentinelGraphClient(vault, impl);
    client.configure('http://localhost:8100', 'wrong');
    const status = await client.status();
    client.dispose();
    expect(status.ok).toBe(false);
    expect(status.message).toContain('HTTP 401');
  });

  it('starts an investigation and preserves token on auto-connect configure', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { run_id: 'run-test-42' } }]);
    const client = new SentinelGraphClient(vault, impl);
    client.configure('http://localhost:8100', 'admin-token');
    // Reconfigure without token (auto-connect simulation)
    client.configure('http://localhost:8100', '');
    const res = await client.startInvestigation('Investigate checkout failure');
    client.dispose();
    expect(res.run_id).toBe('run-test-42');
    expect(calls[0]!.url).toBe('http://localhost:8100/api/runs');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Admin-Token']).toBe('admin-token');
  });
});
