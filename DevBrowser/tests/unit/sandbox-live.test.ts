import { describe, it, expect } from 'vitest';
import { SentinelGraphClient } from '../../src/main/integrations/sentinel-client';
import { summarizeRun, toEvidence } from '../../src/shared/domain/sentinel';
import type { NetworkTransaction } from '../../src/shared/domain/network';

// The whole DevBrowser -> SentinelGraph loop against the running sandbox (python sandbox/run.py up):
//   SENTINEL_SANDBOX=1 npm test
// It breaks the sandbox shop's inventory service, then does what a developer does in DevBrowser.
const API = process.env.SENTINEL_SANDBOX_API ?? 'http://localhost:8200';
const CONTROL = 'http://localhost:7499/__control';
const plain = { encryptSecret: (s: string) => s, decryptSecret: (s: string) => s };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const control = async (body: unknown) =>
  (await fetch(CONTROL, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })).json();

describe.skipIf(!process.env.SENTINEL_SANDBOX)('DevBrowser on the live sandbox', () => {
  it('a failing checkout -> context -> investigation -> approved rollback -> recovery', async () => {
    const client = new SentinelGraphClient(plain);
    client.configure(API, 'sandbox-token');
    expect((await client.status()).ok).toBe(true);

    await control({ action: 'reset' });
    await control({ action: 'fault', service: 'inventory', rate: 0.7,
      deploy: { version: 'v2.4.1', message: 'Reduce orders-db pool size to 2', author: 'Priya Shah' } });

    // The developer clicks Checkout in the storefront; the browser sees the gateway fail.
    let status = 0;
    for (let i = 0; i < 20 && status < 500; i++) {
      status = (await fetch('http://localhost:7401/api/checkout', { method: 'POST', body: '{}' })).status;
    }
    expect(status).toBe(502);
    const tx = { id: 't', url: 'http://localhost:7401/api/checkout', method: 'POST', statusCode: status,
      requestHeaders: {}, startTime: Date.now() } as unknown as NetworkTransaction;

    // DevBrowser shows what the failing host is in the graph...
    const ctx = await client.resolve(tx.url);
    expect(ctx).toMatchObject({ service: 'gateway', known: true, team: 'platform', tier: 'critical' });

    // ...and investigates with the request as evidence, once traces have reported the failure (2 s windows).
    await sleep(5000);
    const { run_id } = await client.startInvestigation(undefined, [toEvidence(tx, 'http://localhost:7400/')!]);
    let run = summarizeRun(await client.currentRun());
    for (let i = 0; i < 120 && run.phase === 'running'; i++) {
      await sleep(500);
      const cur = await client.currentRun();
      expect(cur.run_id).toBe(run_id);
      run = summarizeRun(cur);
    }
    expect(run).toMatchObject({ phase: 'done', rootCause: 'inventory' });

    const rollback = run.proposed.find(a => a.kind === 'rollback');
    expect(rollback).toBeDefined();
    const out = await client.approveAction(rollback!.uid);
    expect(out.outcome).toContain('sandbox: rollback inventory');

    const shop = await (await fetch(CONTROL)).json();
    expect(shop.faults).toEqual({});
    expect((await fetch('http://localhost:7401/api/checkout', { method: 'POST', body: '{}' })).status).toBe(200);
    client.dispose();
  }, 120_000);
});
