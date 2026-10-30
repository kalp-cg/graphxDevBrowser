import { describe, it, expect } from 'vitest';
import { localOrigin, originAddress, stepWatch, type DevServerWatch } from '../../src/shared/domain/devserver';

describe('dev server watch', () => {
  it('knows which pages are local', () => {
    expect(localOrigin('http://localhost:3000/app/page?x=1')).toBe('http://localhost:3000');
    expect(localOrigin('https://127.0.0.1:8443/')).toBe('https://127.0.0.1:8443');
    expect(localOrigin('http://shop.localhost:7400')).toBe('http://shop.localhost:7400');
    expect(localOrigin('https://example.com')).toBeNull();
    expect(localOrigin('about:blank')).toBeNull();
    expect(localOrigin('not a url')).toBeNull();
    expect(originAddress('http://localhost:3000')).toBe('localhost:3000');
  });

  it('calls a server down only after two failed probes in a row, and says so once', () => {
    let w: DevServerWatch = { state: 'unknown', failures: 0 };
    const feed = (ok: boolean) => { const r = stepWatch(w, ok); w = r.watch; return r.event; };
    expect(feed(true)).toBeNull();           // first sight: up, nothing to announce
    expect(feed(false)).toBeNull();          // one dropped probe: a restart on a file change
    expect(feed(true)).toBeNull();           // and it is back: no alarm
    expect(feed(false)).toBeNull();
    expect(feed(false)).toBe('went-down');   // two in a row
    expect(feed(false)).toBeNull();          // still down: not announced again
    expect(w.state).toBe('down');
    expect(feed(true)).toBe('recovered');
    expect(feed(true)).toBeNull();
  });

  it('does not announce a crash for a server that was never seen up', () => {
    let w: DevServerWatch = { state: 'unknown', failures: 0 };
    const events = [false, false, false].map(ok => { const r = stepWatch(w, ok); w = r.watch; return r.event; });
    expect(events).toEqual([null, null, null]);
    expect(w.state).toBe('down');
    expect(stepWatch(w, true).event).toBe('recovered');   // but its coming up is worth knowing
  });
});
