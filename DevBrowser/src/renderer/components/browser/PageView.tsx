import React, { useEffect, useRef } from 'react';
import type { WebviewTag } from 'electron';
import { RotateCw, Smartphone, X } from 'lucide-react';
import { DEVICES } from '../../../shared/domain/browser';
import { emulate, markReady, navigate, registerPage, reload } from '../../browser/pages';
import { profileName, useBrowserStore, type Tab } from '../../store/useBrowserStore';
import { useAppStore } from '../../store/useAppStore';
import { FindBar } from './FindBar';
import { StartPage } from './StartPage';

interface Props {
  tab: Tab;
  visible: boolean;
  /** Left (0) or right (1) pane in split view. */
  paneOrder: number;
  /** Shown in split view: marks which pane has focus and names the profile. */
  showPaneHeader: boolean;
  focused: boolean;
}

/** Chrome reports an aborted navigation (a new one started) as -3; it isn't an error the user should see. */
const ABORTED = -3;

/**
 * One tab's page. The <webview> is created once and never moved: the parent only shows or hides it, so
 * switching tabs, panels or split view never reloads a page.
 */
export const PageView: React.FC<Props> = ({ tab, visible, paneOrder, showPaneHeader, focused }) => {
  const ref = useRef<WebviewTag | null>(null);
  const update = useBrowserStore(s => s.update);
  const activate = useBrowserStore(s => s.activate);
  const findOpen = useBrowserStore(s => s.findOpen);
  const preset = DEVICES.find(d => d.id === tab.device);

  useEffect(() => {
    const view = ref.current;
    if (!view) return;
    const unregister = registerPage(tab.id, view);
    const id = tab.id;
    const state = () => useBrowserStore.getState().tabs.find(t => t.id === id);
    const syncNav = () => update(id, { canGoBack: view.canGoBack(), canGoForward: view.canGoForward() });
    let first = true;

    const onReady = () => {
      markReady(id);
      if (first) {
        first = false;
        const t = state();
        if (t && t.zoom !== 1) view.setZoomFactor(t.zoom);
        // An address typed on the start page before the page attached.
        if (t && t.url !== t.initialUrl && t.url !== 'about:blank') navigate(id, t.url);
      }
      syncNav();
    };
    const onStart = () => update(id, { loading: true });
    const onStop = () => {
      update(id, { loading: false });
      syncNav();
    };
    const onNavigate = (e: Electron.DidNavigateEvent) => {
      if (e.url.startsWith('chrome-error:')) return; // the error is shown by our own page, keep the real URL
      update(id, { url: e.url, error: null, favicon: undefined });
      const t = state();
      if (t?.zoom && t.zoom !== 1) view.setZoomFactor(t.zoom); // zoom is per origin in Chromium
      syncNav();
    };
    const onInPage = (e: Electron.DidNavigateInPageEvent) => {
      if (e.isMainFrame) {
        update(id, { url: e.url });
        syncNav();
      }
    };
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => {
      update(id, { title: e.title });
      const t = state();
      if (t) useBrowserStore.getState().record(t.url, e.title);
    };
    const onFavicon = (e: Electron.PageFaviconUpdatedEvent) => update(id, { favicon: e.favicons[0] });
    const onFail = (e: Electron.DidFailLoadEvent) => {
      if (!e.isMainFrame || e.errorCode === ABORTED) return;
      update(id, { loading: false, error: { code: e.errorCode, description: e.errorDescription, url: e.validatedURL } });
    };
    const onCrash = () => update(id, { loading: false, error: { code: 0, description: 'The page crashed', url: state()?.url ?? '' } });
    // Focus selects the tab only for the other pane of a split view: a hidden tab's page can receive focus
    // (a reload, a script calling focus()) and must not steal the selection.
    const onFocus = () => {
      const { split } = useBrowserStore.getState();
      if (split?.includes(id)) activate(id);
    };

    view.addEventListener('dom-ready', onReady);
    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-navigate', onNavigate as EventListener);
    view.addEventListener('did-navigate-in-page', onInPage as EventListener);
    view.addEventListener('page-title-updated', onTitle as EventListener);
    view.addEventListener('page-favicon-updated', onFavicon as EventListener);
    view.addEventListener('did-fail-load', onFail as EventListener);
    view.addEventListener('render-process-gone', onCrash);
    view.addEventListener('focus', onFocus);
    return () => {
      unregister();
      view.removeEventListener('dom-ready', onReady);
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-navigate', onNavigate as EventListener);
      view.removeEventListener('did-navigate-in-page', onInPage as EventListener);
      view.removeEventListener('page-title-updated', onTitle as EventListener);
      view.removeEventListener('page-favicon-updated', onFavicon as EventListener);
      view.removeEventListener('did-fail-load', onFail as EventListener);
      view.removeEventListener('render-process-gone', onCrash);
      view.removeEventListener('focus', onFocus);
    };
    // Runs once per tab: the webview element lives exactly as long as the tab, and its id never changes.
  }, [tab.id]);

  const width = preset ? (tab.rotated ? preset.height : preset.width) : undefined;
  const height = preset ? (tab.rotated ? preset.width : preset.height) : undefined;
  const isStart = tab.url === 'about:blank' && !tab.error;

  return (
    <div
      data-tab-id={tab.id}
      style={{ display: visible ? 'flex' : 'none', flex: 1, minWidth: 0, flexDirection: 'column', position: 'relative',
        order: paneOrder,
        borderLeft: showPaneHeader && paneOrder === 1 ? '1px solid var(--border-subtle)' : undefined }}
      onMouseDown={() => activate(tab.id)}
    >
      {showPaneHeader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 10px', fontSize: 12,
          borderBottom: `2px solid ${focused ? 'var(--accent)' : 'transparent'}`, background: 'var(--bg-secondary)',
          color: 'var(--text-secondary)' }}>
          <span className={`tag${focused ? ' accent' : ''}`}>{profileName(tab.profile)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title}</span>
        </div>
      )}

      {preset && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: 34, flexShrink: 0,
          fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-subtle)' }}>
          <Smartphone size={13} />
          <select className="field" style={{ height: 24, fontSize: 12 }} value={preset.id} aria-label="Device"
            onChange={e => void emulate(tab.id, e.target.value, tab.rotated)}>
            {DEVICES.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
            {width} × {height}
          </span>
          <button className="icon-btn" title="Rotate" onClick={() => void emulate(tab.id, preset.id, !tab.rotated)}>
            <RotateCw size={14} />
          </button>
          <button className="icon-btn" title="Exit device mode" onClick={() => void emulate(tab.id, null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: preset ? 'auto' : 'hidden',
        background: preset ? 'var(--bg-primary)' : 'var(--page-bg)', padding: preset ? 24 : 0,
        justifyContent: preset ? 'center' : undefined, alignItems: preset ? 'flex-start' : undefined }}>
        <webview
          ref={ref as unknown as React.Ref<HTMLElement>}
          src={tab.initialUrl}
          partition={tab.profile}
          allowpopups="true"
          style={{
            flex: preset ? 'none' : 1,
            width: width ?? '100%',
            height: height ?? '100%',
            outline: preset ? '1px solid var(--border-medium)' : 'none',
            background: 'var(--page-bg)'
          }}
        />
      </div>

      {isStart && <StartPage tabId={tab.id} />}
      {tab.error && <ErrorPage tab={tab} />}
      {visible && focused && findOpen && <FindBar tabId={tab.id} />}
    </div>
  );
};

const ErrorPage: React.FC<{ tab: Tab }> = ({ tab }) => {
  const setActiveView = useAppStore(s => s.setActiveView);
  const err = tab.error!;
  let host = err.url;
  try {
    host = new URL(err.url).host;
  } catch {
    // keep the raw URL
  }
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', padding: 24 }}>
      <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>{err.code === 0 ? 'This page crashed' : `Can't reach ${host}`}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
          {explain(err.description, local)}
        </p>
        <code style={{ fontSize: 12, color: 'var(--danger)' }}>{err.description || `Error ${err.code}`}</code>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn primary" onClick={() => reload(tab.id)}>Try again</button>
          <button className="btn" onClick={() => setActiveView('network')}>Open network panel</button>
        </div>
      </div>
    </div>
  );
};

/** The errors developers hit most, in plain words. */
function explain(code: string, local: boolean): string {
  if (code.includes('CONNECTION_REFUSED')) {
    return local ? 'Nothing is listening on that port. Is the dev server running?' : 'The server refused the connection.';
  }
  if (code.includes('UNSAFE_PORT')) return 'Chromium blocks this port for every site. Run the server on another port.';
  if (code.includes('NAME_NOT_RESOLVED')) return 'That host name does not resolve. Check the spelling, VPN or /etc/hosts.';
  if (code.includes('CERT_')) return 'The certificate is not trusted. A local HTTPS server needs a trusted dev certificate.';
  if (code.includes('TIMED_OUT')) return 'The server did not answer in time.';
  if (code.includes('INTERNET_DISCONNECTED')) return 'This computer is offline.';
  return 'The page could not be loaded.';
}
