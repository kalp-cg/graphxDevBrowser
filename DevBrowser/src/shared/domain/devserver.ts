/**
 * "Did my dev server just die?" A browser tab pointed at localhost knows before anyone else: the page it loaded is gone.
 * Each local tab's origin is probed on a short interval; a server counts as down only after two failed probes in a row (one
 * dropped request while it restarts on a file change is not a crash), and as recovered on the first success after that.
 */
export type DevServerState = 'unknown' | 'up' | 'down';

export interface DevServerWatch {
  state: DevServerState;
  failures: number;
}

export type DevServerEvent = 'went-down' | 'recovered' | null;

export const FAILURES_TO_DOWN = 2;

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[a-z0-9-]+\.localhost)$/i;

/** `http://localhost:3000/some/page` -> `http://localhost:3000`; null for anything that is not a local http(s) page. */
export function localOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && LOCAL_HOST.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

/** `localhost:3000` (the form the service map's addresses use). */
export const originAddress = (origin: string): string => new URL(origin).host;

export function stepWatch(w: DevServerWatch, ok: boolean): { watch: DevServerWatch; event: DevServerEvent } {
  if (ok) {
    return { watch: { state: 'up', failures: 0 }, event: w.state === 'down' ? 'recovered' : null };
  }
  const failures = w.failures + 1;
  if (w.state === 'down') return { watch: { state: 'down', failures }, event: null };
  // A server that was never seen up (a stale tab from last session) is down quietly: nothing "crashed" while we watched.
  if (failures >= FAILURES_TO_DOWN) return { watch: { state: 'down', failures }, event: w.state === 'up' ? 'went-down' : null };
  return { watch: { state: w.state, failures }, event: null };
}
