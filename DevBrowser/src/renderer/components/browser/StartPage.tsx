import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Keyboard, LayoutDashboard, Play, Search, Share2, Star, X } from 'lucide-react';
import { displayUrl } from '../../../shared/domain/browser';
import { navigate } from '../../browser/pages';
import { useAppStore } from '../../store/useAppStore';
import { useBrowserStore } from '../../store/useBrowserStore';
import { Logo } from '../common/Logo';

const PORTS = ['3000', '5173', '8080', '4200', '8000'];
const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
const MOD = mac ? '⌘' : 'Ctrl';

function greeting(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/**
 * A new tab: a calm place to start. Search or go anywhere, jump back to the sites you use, see what is running on this
 * machine, and glance at the health of your system, one dot per service.
 */
export const StartPage: React.FC<{ tabId: string }> = ({ tabId }) => {
  const history = useBrowserStore(s => s.history);
  const bookmarks = useBrowserStore(s => s.bookmarks);
  const removeBookmark = useBrowserStore(s => s.removeBookmark);
  const sentinel = useAppStore(s => s.sentinelStatus);
  const snapshot = useAppStore(s => s.sentinelSnapshot);
  const project = useAppStore(s => s.sentinelProject);
  const setActiveView = useAppStore(s => s.setActiveView);
  const connectCodebase = useAppStore(s => s.connectCodebase);
  const setShortcuts = useAppStore(s => s.setShortcutsModalOpen);
  const connected = sentinel === 'connected';
  const [servers, setServers] = useState<{ port: number; title: string; status: number }[]>([]);
  const [query, setQuery] = useState('');

  // The local servers that are up right now, so opening your app is one click, not remembering a port.
  useEffect(() => {
    let alive = true;
    const scan = () => window.devBrowserAPI?.browser.scanPorts().then(s => alive && setServers(s)).catch(() => undefined);
    void scan();
    const timer = setInterval(() => void scan(), 4000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const h of history) {
      const host = hostOf(h.url);
      if (!seen.has(host)) {
        seen.add(host);
        out.push(h);
      }
      if (out.length === 6) break;
    }
    return out;
  }, [history]);

  const services = (snapshot?.nodes ?? []).filter(n => n.type === 'Service' || (n.type === 'Database' && n.id.startsWith('svc:')));
  const alerts = (snapshot?.nodes ?? []).filter(n => n.type === 'Alert' && n.status !== 'resolved').length;
  const unhealthy = services.filter(n => n.status && n.status !== 'healthy').length;

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-brand">
          <Logo size={28} />
          <h1>DevBrowser</h1>
          <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 11 }}>v{__APP_VERSION__}</span>
        </header>

        <section className="home-hero" aria-label="Search">
          <p className="home-greeting">{greeting(new Date().getHours())}.</p>
          <form className="home-search" onSubmit={e => { e.preventDefault(); if (query.trim()) navigate(tabId, query); }}>
            <Search size={18} aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input aria-label="Search the web or type an address" placeholder="Search the web, or type an address or a port"
              value={query} onChange={e => setQuery(e.target.value)} spellCheck={false} />
            {query.trim() && <button type="submit" className="icon-btn" aria-label="Go"><ArrowRight size={16} /></button>}
          </form>
          <button className="home-howto" onClick={() => setActiveView('guide')}>
            <BookOpen size={13} /> New here? See how DevBrowser works <ArrowRight size={12} />
          </button>
        </section>

        {recent.length > 0 && (
          <section aria-label="Recent" className="home-tiles">
            {recent.map((h, i) => (
              <button key={h.url} className="tile" onClick={() => navigate(tabId, h.url)} title={h.url}>
                <span className={`tile-mark ${i % 3 === 1 ? 'hl' : ''}`}>{(h.title || hostOf(h.url)).trim().charAt(0).toUpperCase()}</span>
                <span className="tile-title">{h.title || hostOf(h.url)}</span>
                <span className="tile-host">{displayUrl(h.url)}</span>
              </button>
            ))}
          </section>
        )}

        <div className="home-grid">
          <section aria-label="Your system" className={`home-card system${alerts ? ' alerting' : ''}`}>
            <div className="home-card-head">
              <span className="eyebrow">Your system</span>
              {connected && !project && <span className="tag warn">Demo data</span>}
            </div>
            {connected ? (
              <>
                <p className="home-card-title">
                  {alerts ? <><span className="hl-text">{alerts} alert{alerts === 1 ? '' : 's'} firing</span> across {services.length} services</>
                    : <>{project ?? 'Sample company'}: all {services.length} services healthy</>}
                </p>
                <div className="constellation" aria-label={`${services.length} services, ${unhealthy} unhealthy`} role="img">
                  {services.map(s => (
                    <span key={s.id} title={`${s.name ?? s.label}: ${s.status ?? 'healthy'}`}
                      className={`star ${s.status === 'down' ? 'down' : s.status && s.status !== 'healthy' ? 'degraded' : ''}`} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className={`btn ${alerts ? 'highlight' : 'primary'}`} onClick={() => setActiveView('overview')}>
                    <LayoutDashboard size={14} /> {alerts ? 'See what broke' : 'Overview'}
                  </button>
                  <button className="btn" onClick={() => setActiveView('dependencies')}><Share2 size={14} /> Explore the map</button>
                  {!project && <button className="btn" onClick={() => void connectCodebase()}>Connect your codebase…</button>}
                </div>
              </>
            ) : (
              <>
                <p className="home-card-title">{sentinel === 'connecting' ? 'Starting SentinelGraph…' : 'See how your services connect'}</p>
                <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                  SentinelGraph maps your codebase and finds the root cause when something breaks. No diagrams to draw.
                </p>
                {sentinel !== 'connecting' && (
                  <div><button className="btn primary" onClick={() => setActiveView('settings')}>Connect SentinelGraph</button></div>
                )}
              </>
            )}
          </section>

          <section aria-label="Running on your machine" className="home-card">
            <div className="home-card-head"><span className="eyebrow">Running on your machine</span></div>
            {servers.length === 0 ? (
              <>
                <p className="muted" style={{ fontSize: 13 }}>No local server is up. Try a usual port, or start your project.</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {PORTS.map(p => (
                    <button key={p} className="btn" style={{ fontFamily: 'var(--font-mono)' }} onClick={() => navigate(tabId, `localhost:${p}`)}>:{p}</button>
                  ))}
                  <button className="btn" onClick={() => setActiveView('run')}><Play size={13} /> Start your project</button>
                </div>
              </>
            ) : (
              <div className="server-list">
                {servers.map(s => (
                  <button key={s.port} className="server" onClick={() => navigate(tabId, `localhost:${s.port}`)} aria-label={`Open localhost:${s.port}`}>
                    <span className={`server-dot${s.status >= 500 ? ' bad' : ''}`} />
                    <span className="server-title">{s.title || (s.status ? `HTTP ${s.status}` : 'No page')}</span>
                    <span className="mono muted">:{s.port}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {bookmarks.length > 0 && (
          <section aria-label="Bookmarks" className="home-card">
            <div className="home-card-head"><span className="eyebrow"><Star size={11} style={{ marginRight: 6, verticalAlign: -1 }} />Bookmarks</span></div>
            <div className="server-list">
              {bookmarks.slice(0, 12).map(b => (
                <div key={b.url} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button className="server" style={{ flex: 1 }} onClick={() => navigate(tabId, b.url)}>
                    <span className="server-title">{b.title}</span>
                    <span className="mono muted" style={{ whiteSpace: 'nowrap' }}>{displayUrl(b.url)}</span>
                  </button>
                  <button className="icon-btn" aria-label={`Remove bookmark ${b.title}`} onClick={() => removeBookmark(b.url)} style={{ width: 24, height: 24 }}><X size={12} /></button>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="home-footer">
          <span><kbd>{MOD}</kbd> <kbd>L</kbd> address bar</span>
          <span><kbd>{MOD}</kbd> <kbd>T</kbd> new tab</span>
          <span><kbd>{MOD}</kbd> <kbd>K</kbd> search everything</span>
          <button onClick={() => setShortcuts(true)}><Keyboard size={13} /> All shortcuts</button>
        </footer>
      </div>
    </div>
  );
};
