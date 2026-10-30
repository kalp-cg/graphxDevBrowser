import { describe, it, expect } from 'vitest';
import {
  DEVICES, PROFILES, SEARCH_URL, displayUrl, fallbackTitle, siteSecurity, stepZoom, toNavigableUrl
} from '../../src/shared/domain/browser';
import { summarizeRun } from '../../src/shared/domain/sentinel';

describe('omnibox', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['localhost:3000', 'http://localhost:3000'],
    ['localhost', 'http://localhost'],
    ['127.0.0.1:8200/api/health', 'http://127.0.0.1:8200/api/health'],
    ['3000', 'http://localhost:3000'],
    ['shop.test', 'http://shop.test'],
    ['192.168.1.20:8080', 'http://192.168.1.20:8080'],
    ['example.com', 'https://example.com'],
    ['github.com/kalp-cg/graphxDevBrowser', 'https://github.com/kalp-cg/graphxDevBrowser'],
    ['about:blank', 'about:blank'],
    ['view-source:https://example.com', 'view-source:https://example.com'],
    ['  ', 'about:blank']
  ])('%s -> %s', (input, url) => {
    expect(toNavigableUrl(input)).toBe(url);
  });

  it('searches anything that is not an address', () => {
    expect(toNavigableUrl('react useEffect cleanup')).toBe(`${SEARCH_URL}react%20useEffect%20cleanup`);
    expect(toNavigableUrl('why.is it slow')).toBe(`${SEARCH_URL}why.is%20it%20slow`);
    expect(toNavigableUrl('vitest')).toBe(`${SEARCH_URL}vitest`);
  });

  it('shows a short address and labels the connection', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com');
    expect(displayUrl('http://localhost:7400/cart?x=1')).toBe('localhost:7400/cart?x=1');
    expect(displayUrl('about:blank')).toBe('');
    expect(siteSecurity('https://example.com')).toBe('secure');
    expect(siteSecurity('http://example.com')).toBe('insecure');
    expect(siteSecurity('http://localhost:7400/')).toBe('local');
    expect(siteSecurity('about:blank')).toBe('internal');
    expect(fallbackTitle('http://localhost:7400/x')).toBe('localhost:7400');
    expect(fallbackTitle('about:blank')).toBe('New Tab');
  });
});

describe('zoom and devices', () => {
  it('steps through Chrome zoom levels and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(1.05, 1)).toBe(1.1); // off-grid values snap to the next level
  });

  it('has sane device presets and distinct profiles', () => {
    for (const d of DEVICES) expect(d.width > 0 && d.height > 0 && d.scale >= 1).toBe(true);
    expect(DEVICES.filter(d => d.mobile).every(d => d.userAgent)).toBe(true);
    expect(new Set(PROFILES.map(p => p.key)).size).toBe(PROFILES.length);
    expect(PROFILES.every(p => p.key.startsWith('persist:'))).toBe(true);
  });
});

describe('agent path on the graph', () => {
  it('collects every node and edge the agent touched, and the latest step', () => {
    const run = summarizeRun({ run_id: 'r', running: true, events: [
      { type: 'tool_result', name: 'find_common_cause', node_uids: ['svc:a', 'svc:b'], edge_uids: ['e:a->b'] },
      { type: 'tool_result', name: 'recent_changes', node_uids: ['svc:b', 'dep:b:v2'], edge_uids: [] }
    ] });
    expect(run.path).toEqual({ nodes: ['svc:a', 'svc:b', 'dep:b:v2'], edges: ['e:a->b'],
      currentNodes: ['svc:b', 'dep:b:v2'], currentEdges: [] });
    const done = summarizeRun({ run_id: 'r', running: false, events: [
      { type: 'tool_result', name: 'x', node_uids: ['svc:a'] }, { type: 'final', root_cause: 'a' }] });
    expect(done.path.nodes).toEqual(['svc:a']);
    expect(done.path.currentNodes).toEqual([]); // nothing "in progress" once the run ends
  });
});
