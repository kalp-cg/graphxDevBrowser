import { describe, expect, it } from 'vitest';
import { parseDefaultBackend } from '../../src/shared/domain/default-backend';
import { SentinelGraphClient, type SavedConnection } from '../../src/main/integrations/sentinel-client';

describe('the backend an installer ships with', () => {
  it('reads an https address and drops a trailing slash', () => {
    expect(parseDefaultBackend('{"url":"https://sentinelgraph-api.onrender.com/"}')).toBe('https://sentinelgraph-api.onrender.com');
    expect(parseDefaultBackend('{"url":" http://localhost:8100 "}')).toBe('http://localhost:8100');
  });
  it('ignores a missing, empty, or unusable file, so a build without one connects to nothing', () => {
    for (const bad of ['', 'nope', '{}', '{"url":""}', '{"url":5}', '{"url":"ftp://x.test"}', '{"url":"not a url"}', 'null', '[]'])
      expect(parseDefaultBackend(bad)).toBeNull();
  });
  it('refuses an address with credentials in it', () => {
    expect(parseDefaultBackend('{"url":"https://user:pass@x.test"}')).toBeNull();
  });
});

describe('using it without saving it', () => {
  it('attach() uses the address for the session and leaves the saved connection alone', () => {
    let saved: SavedConnection | null = null;
    const client = new SentinelGraphClient(fetch, { load: () => saved, save: c => { saved = c; } });
    client.attach('https://demo.test/');
    expect(client.url).toBe('https://demo.test');
    expect(client.isConfigured()).toBe(true);
    expect(saved).toBeNull();                       // nothing written: the user's own choice, if they make one, is what persists
    client.configure('http://localhost:8100');
    expect(saved).toEqual({ baseUrl: 'http://localhost:8100' });
  });
});
