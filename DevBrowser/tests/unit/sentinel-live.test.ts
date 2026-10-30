import { describe, it, expect } from 'vitest';
import { SentinelGraphClient } from '../../src/main/integrations/sentinel-client';
import { toBlastRadius, toDevBrowserGraph } from '../../src/shared/domain/sentinel';

// Against a running SentinelGraph API (and its TigerGraph). Skipped unless SENTINEL_URL is set, e.g.
//   SENTINEL_URL=http://localhost:8100 SENTINEL_ADMIN_TOKEN=... npm test
// It writes browser traffic into that API's graph, so point it at a test graph, not production.
const url = process.env.SENTINEL_URL;
const plain = { encryptSecret: (s: string) => s, decryptSecret: (s: string) => s };

describe.skipIf(!url)('SentinelGraph live', () => {
  it('sends captured traffic: it shapes the graph but never its health', async () => {
    const client = new SentinelGraphClient(plain);
    client.configure(url!, process.env.SENTINEL_ADMIN_TOKEN ?? '');
    expect((await client.status()).ok).toBe(true);

    const now = Date.now();
    const call = (path: string, status: number) => ({
      pageUrl: 'http://localhost:4000/shop', url: `http://devbrowser-api.local${path}`, method: 'GET',
      statusCode: status, mimeType: 'application/json', startTime: now, endTime: now + 30
    });
    for (let i = 0; i < 6; i++) client.record(call('/cart', 503));
    expect(await client.flush()).toBe(true);

    const { nodes, edges } = toDevBrowserGraph(await client.getGraph());
    client.dispose();
    expect(nodes.find(n => n.id === 'svc:web:localhost:4000')?.type).toBe('FrontendRoute');
    // Passive capture is topology only: a developer's failing clicks must not mark services down or page anyone.
    expect(nodes.find(n => n.id === 'svc:devbrowser-api.local')?.metadata.status).toBe('healthy');
    expect(edges).toContainEqual(expect.objectContaining({
      sourceId: 'svc:web:localhost:4000', targetId: 'svc:devbrowser-api.local', type: 'DEPENDS_ON'
    }));

    const radius = toBlastRadius('svc:devbrowser-api.local', await client.blastRadius('devbrowser-api.local'), nodes);
    expect(radius.affectedNodes.map(n => n.id)).toEqual(['svc:web:localhost:4000']);
  }, 60_000);
});
