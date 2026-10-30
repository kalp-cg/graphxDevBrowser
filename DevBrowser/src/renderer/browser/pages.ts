import type { WebviewTag } from 'electron';
import { DEVICES, stepZoom, toNavigableUrl } from '../../shared/domain/browser';
import { useBrowserStore } from '../store/useBrowserStore';

/**
 * The live <webview> of each tab. Elements stay mounted for the life of the tab (moving or remounting one
 * reloads the page), so actions on a page go through this registry rather than through React.
 */
const pages = new Map<string, { view: WebviewTag; ready: boolean }>();

export function registerPage(tabId: string, view: WebviewTag): () => void {
  pages.set(tabId, { view, ready: false });
  return () => {
    if (pages.get(tabId)?.view === view) pages.delete(tabId);
  };
}

export function markReady(tabId: string): void {
  const page = pages.get(tabId);
  if (page) page.ready = true;
}

/** Run `fn` on a tab's page once it can take commands. Errors (a page mid-teardown) are swallowed. */
function withPage(tabId: string, fn: (view: WebviewTag) => void): void {
  const page = pages.get(tabId);
  if (!page?.ready) return;
  try {
    fn(page.view);
  } catch (err) {
    console.warn('[browser] page command failed:', err);
  }
}

const activeId = () => useBrowserStore.getState().activeId;
const tab = (id: string) => useBrowserStore.getState().tabs.find(t => t.id === id);

export function navigate(tabId: string, input: string): void {
  const url = toNavigableUrl(input);
  const store = useBrowserStore.getState();
  store.update(tabId, { url, error: null, loading: true });
  const page = pages.get(tabId);
  if (page?.ready) {
    page.view.loadURL(url).catch(() => undefined); // failures arrive as did-fail-load
  } else if (page) {
    // Not attached yet (typed right after launch or into a fresh tab): the webview loads `src` when it attaches.
    page.view.src = url;
  }
}

export const goBack = (id = activeId()) => withPage(id, v => v.canGoBack() && v.goBack());
export const goForward = (id = activeId()) => withPage(id, v => v.canGoForward() && v.goForward());
export const stop = (id = activeId()) => withPage(id, v => v.stop());

export function reload(id = activeId(), ignoreCache = false): void {
  const t = tab(id);
  if (t?.error) {
    navigate(id, t.error.url); // "Try again" on an error page reloads the URL that failed, not the error
    return;
  }
  withPage(id, v => (ignoreCache ? v.reloadIgnoringCache() : v.reload()));
}

export function setZoom(id: string, zoom: number): void {
  useBrowserStore.getState().update(id, { zoom });
  withPage(id, v => v.setZoomFactor(zoom));
}

export function zoom(direction: 1 | -1 | 0, id = activeId()): void {
  const current = tab(id)?.zoom ?? 1;
  setZoom(id, direction === 0 ? 1 : stepZoom(current, direction));
}

export function toggleDevTools(id = activeId()): void {
  withPage(id, v => (v.isDevToolsOpened() ? v.closeDevTools() : v.openDevTools()));
}

/**
 * Find in page. `next` moves through the matches of the current search; otherwise a new search starts.
 * Electron's option is inverted from its name: `findNext: true` *starts a new session*, and an initial request
 * sent with `findNext: false` never answers (verified against Electron 33).
 */
export function find(id: string, text: string, forward = true, next = false): void {
  withPage(id, v => {
    if (text) v.findInPage(text, { forward, findNext: !next });
    else v.stopFindInPage('clearSelection');
  });
}

export const stopFind = (id: string) => withPage(id, v => v.stopFindInPage('clearSelection'));

/** Emulate a device on a tab (null = desktop). The page reloads so it sees the new user agent. */
export async function setThrottle(id: string, presetId: string): Promise<void> {
  useBrowserStore.getState().update(id, { throttle: presetId });
  const page = pages.get(id);
  if (!page?.ready || !window.devBrowserAPI) return;
  const res = await window.devBrowserAPI.browser.throttle(page.view.getWebContentsId(), presetId);
  if (!res.ok) console.warn('[browser] throttling failed:', res.error);
}

export async function emulate(id: string, deviceId: string | null, rotated = false): Promise<void> {
  const store = useBrowserStore.getState();
  store.update(id, { device: deviceId, rotated: deviceId ? rotated : false });
  const page = pages.get(id);
  if (!page?.ready || !window.devBrowserAPI) return;
  const preset = DEVICES.find(d => d.id === deviceId);
  const device = preset
    ? { width: rotated ? preset.height : preset.width, height: rotated ? preset.width : preset.height,
        scale: preset.scale, mobile: preset.mobile, userAgent: preset.userAgent }
    : null;
  const res = await window.devBrowserAPI.browser.emulate(page.view.getWebContentsId(), device);
  if (!res.ok) console.warn('[browser] device emulation failed:', res.error);
  page.view.reload();
}
