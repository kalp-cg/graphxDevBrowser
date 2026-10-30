import { describe, expect, it } from 'vitest';
import {
  RECORDING_FORMAT, buildRecording, compareRun, diagnose, fileName, orderSteps, parseRecording, pauseBefore, rebase, redactText, replayPlan,
  requestStep, serializeRecording, signature, summarize, suggestTitle, type RecordedStep, type Recording
} from '../../src/shared/domain/recording';
import type { NetworkTransaction } from '../../src/shared/domain/network';

const target = (selector: string, text?: string) => ({ selector, tag: 'button', text });
const sample = (steps: RecordedStep[]): Recording =>
  buildRecording({ id: 'r1', title: 'Checkout fails', startedAt: 1_000, endedAt: 9_000, startUrl: 'http://localhost:3000/cart', viewport: { width: 1200, height: 800 },
    steps, redactions: 0, appVersion: 'test' });
const tx = (over: Partial<NetworkTransaction> = {}): NetworkTransaction => ({
  id: 'q1', tabId: 'webview-1' as never, url: 'http://localhost:3100/api/pay?token=abc123', method: 'POST', statusCode: 500, requestHeaders: { authorization: 'Bearer secret', 'content-type': 'application/json' },
  responseHeaders: { 'set-cookie': 'sid=1' }, requestBody: '{"card":"4242","amount":10}', responseBody: '{"error":"boom","api_key":"k-123456789"}', isTruncated: false, startTime: 3_000, endTime: 3_250, ...over
});

describe('redaction', () => {
  it('removes JWTs, bearer values and secret-named JSON fields, and counts them', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-';
    const { text, count } = redactText(`{"password":"hunter2","name":"Ada","t":"${jwt}"} Authorization: Bearer abcdefgh12345678`);
    expect(text).not.toMatch(/hunter2|eyJhbGci|abcdefgh12345678/);
    expect(text).toContain('"name":"Ada"');
    expect(count).toBe(3);
  });
  it('leaves ordinary text alone', () => {
    expect(redactText('Add to cart failed: 500')).toEqual({ text: 'Add to cart failed: 500', count: 0 });
  });
  it('a request step has credentials removed from headers, URL and bodies, and keeps the useful parts', () => {
    const { step, redactions } = requestStep(tx(), 1_000, { bodies: true });
    expect(step.kind).toBe('request');
    if (step.kind !== 'request') return;
    expect(step.t).toBe(2_000);
    expect(step.durationMs).toBe(250);
    expect(step.requestHeaders?.authorization).toBe('[redacted]');
    expect(step.responseHeaders?.['set-cookie']).toBe('[redacted]');
    expect(step.url).not.toContain('abc123');
    expect(step.responseBody).toContain('"error":"boom"');
    expect(step.responseBody).not.toContain('k-123456789');
    expect(redactions).toBeGreaterThanOrEqual(4);
  });
  it('leaves bodies out unless asked', () => {
    const { step } = requestStep(tx(), 0);
    expect(step.kind === 'request' && step.requestBody).toBeFalsy();
  });
});

describe('the file', () => {
  const rec = sample([{ t: 0, kind: 'navigate', url: 'http://localhost:3000/cart' }, { t: 500, kind: 'click', target: target('#pay', 'Pay') }]);
  it('round-trips', () => {
    const back = parseRecording(serializeRecording(rec));
    expect(back.ok).toBe(true);
    expect(back.ok && back.recording).toEqual(rec);
  });
  it('refuses what is not a recording, with a reason', () => {
    expect(parseRecording('nope')).toMatchObject({ ok: false });
    expect(parseRecording('{"log":{}}')).toMatchObject({ ok: false, error: 'This is not a DevBrowser recording.' });
    expect(parseRecording(JSON.stringify({ ...rec, version: 2 }))).toMatchObject({ ok: false });
    expect(parseRecording(JSON.stringify({ ...rec, steps: [{ t: 1, kind: 'teleport' }] }))).toMatchObject({ ok: false });
    expect(parseRecording(JSON.stringify({ format: RECORDING_FORMAT, version: 1 }))).toMatchObject({ ok: false });
  });
  it('refuses a file that is too large before parsing it', () => {
    expect(parseRecording('x'.repeat(26_000_000))).toMatchObject({ ok: false });
  });
  it('names the file from the title and the time', () => {
    expect(fileName({ title: 'Checkout fails!', createdAt: Date.UTC(2026, 9, 30, 12, 5) })).toBe('checkout-fails-202610301205.devrec.json');
  });
});

describe('reading it', () => {
  const steps: RecordedStep[] = [
    { t: 0, kind: 'navigate', url: 'http://localhost:3000/cart' },
    { t: 1_000, kind: 'click', target: target('#add', 'Add') },
    { t: 3_000, kind: 'click', target: target('#pay', 'Pay') },
    { t: 3_200, kind: 'request', id: 'a', method: 'POST', url: 'http://localhost:3100/api/pay', status: 500 },
    { t: 3_300, kind: 'error', message: 'TypeError: Cannot read properties of undefined (reading "id")' }
  ];
  const rec = sample(steps);
  it('summarises', () => expect(summarize(rec)).toMatchObject({ actions: 2, requests: 1, failedRequests: 1, errors: 1 }));
  it('finds the first problem and the action just before it', () => {
    const d = diagnose(rec);
    expect(d.firstProblem?.kind).toBe('request');
    expect(d.trigger).toMatchObject({ kind: 'click', target: { selector: '#pay' } });
  });
  it('has no trigger when the person did nothing recently', () => {
    expect(diagnose(sample([{ t: 0, kind: 'navigate', url: 'http://x.test/' }, { t: 90_000, kind: 'error', message: 'late' }])).trigger).toBeUndefined();
  });
  it('titles a recording from what went wrong', () => {
    expect(suggestTitle(steps, 'http://localhost:3000')).toContain('TypeError');
    expect(suggestTitle(steps.slice(0, 4), 'http://localhost:3000')).toBe('POST /api/pay → 500');
    expect(suggestTitle([], 'http://localhost:3000')).toBe('Session on localhost:3000');
  });
  it('keeps a console error the page also threw once, and puts steps in time order', () => {
    const out = orderSteps([
      { t: 300, kind: 'console', level: 'error', message: 'Uncaught TypeError: x is undefined' },
      { t: 100, kind: 'click', target: target('#a') },
      { t: 310, kind: 'error', message: 'Uncaught TypeError: x is undefined' }
    ]);
    expect(out.map(s => s.kind)).toEqual(['click', 'error']);
  });
});

describe('the replay plan', () => {
  it('re-performs actions, skips the first navigation and navigations a click caused, keeps typed ones', () => {
    const rec = sample([
      { t: 0, kind: 'navigate', url: 'http://localhost:3000/' },
      { t: 1_000, kind: 'click', target: target('#go') },
      { t: 1_400, kind: 'navigate', url: 'http://localhost:3000/next' },
      { t: 9_000, kind: 'navigate', url: 'http://localhost:3000/typed' },
      { t: 9_500, kind: 'scroll', x: 0, y: 300 },
      { t: 9_600, kind: 'request', id: 'r', method: 'GET', url: 'http://localhost:3000/a', status: 200 }
    ]);
    expect(replayPlan(rec).map(s => s.kind)).toEqual(['click', 'navigate', 'scroll']);
  });
  it('paces steps like the person did, within bounds, and faster at higher speed', () => {
    expect(pauseBefore({ t: 5_000 }, { t: 4_950 })).toBe(120);
    expect(pauseBefore({ t: 60_000 }, { t: 1_000 })).toBe(1_400);
    expect(pauseBefore({ t: 2_000 }, { t: 1_000 }, 2)).toBe(500);
    expect(pauseBefore({ t: 2_000 }, undefined)).toBe(400);
  });
  it('moves a recorded address to the teammate\'s server', () => {
    expect(rebase('http://localhost:3000/cart?x=1#top', 'http://localhost:3000', 'http://localhost:5173')).toBe('http://localhost:5173/cart?x=1#top');
    expect(rebase('http://elsewhere.test/a', 'http://localhost:3000', 'http://localhost:5173')).toBe('http://elsewhere.test/a');
  });
});

describe('did the replay reproduce it', () => {
  const rec = sample([
    { t: 100, kind: 'request', id: 'a', method: 'POST', url: 'http://localhost:3100/api/pay?id=77', status: 500 },
    { t: 200, kind: 'error', message: 'TypeError: Cannot read properties of undefined (reading "id") at 0x1f3a9b2c' }
  ]);
  it('ignores numbers and ids when comparing messages', () => {
    expect(signature('Order 123 failed at 0xdeadbeef01 http://a.test/x')).toBe(signature('Order 987 failed at 0xabcdef0123 http://b.test/y'));
  });
  it('reproduced: same error and same failing request on another origin', () => {
    const v = compareRun(rec, { errors: ['TypeError: Cannot read properties of undefined (reading "id") at 0x9a8b7c6d'], failedRequests: [{ method: 'POST', path: '/api/pay?id=12', status: 500 }] });
    expect(v.verdict).toBe('reproduced');
    expect(v.missing).toEqual([]);
  });
  it('partly, and what is missing', () => {
    const v = compareRun(rec, { errors: [], failedRequests: [{ method: 'POST', path: '/api/pay', status: 500 }] });
    expect(v.verdict).toBe('partly');
    expect(v.missing[0]).toContain('TypeError');
  });
  it('not reproduced, with the new problems that did appear', () => {
    const v = compareRun(rec, { errors: ['Different problem'], failedRequests: [] });
    expect(v.verdict).toBe('not-reproduced');
    expect(v.extra).toHaveLength(1);
  });
  it('says so when the recording had nothing wrong to compare', () => {
    expect(compareRun(sample([{ t: 0, kind: 'navigate', url: 'http://x.test/' }]), { errors: [], failedRequests: [] }).verdict).toBe('nothing-to-compare');
  });
});
