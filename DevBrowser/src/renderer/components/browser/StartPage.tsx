import React, { useMemo } from 'react';
import { Keyboard, Network, Share2, ShieldAlert, Send } from 'lucide-react';
import { displayUrl } from '../../../shared/domain/browser';
import { navigate } from '../../browser/pages';
import { useAppStore } from '../../store/useAppStore';
import { useBrowserStore } from '../../store/useBrowserStore';
import { Logo } from '../common/Logo';

const PORTS = ['3000', '5173', '8080', '4200', '8000'];
const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
const MOD = mac ? '⌘' : 'Ctrl';

/** A new tab: where to start, what is connected, and the sites visited most recently. */
export const StartPage: React.FC<{ tabId: string }> = ({ tabId }) => {
  const history = useBrowserStore(s => s.history);
  const sentinel = useAppStore(s => s.sentinelStatus);
  const sentinelUrl = useAppStore(s => s.sentinelUrl);
  const setActiveView = useAppStore(s => s.setActiveView);
  const connectCodebase = useAppStore(s => s.connectCodebase);
  const setShortcuts = useAppStore(s => s.setShortcutsModalOpen);
  const connected = sentinel === 'connected';

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const h of history) {
      const host = new URL(h.url).host;
      if (!seen.has(host)) {
        seen.add(host);
        out.push(h);
      }
      if (out.length === 6) break;
    }
    return out;
  }, [history]);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: 'var(--bg-primary)', padding: '9vh 20px 32px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Logo size={52} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.01em', margin: 0 }}>DevBrowser</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '3px 0 0' }}>
              The browser for people who build and run software.
            </p>
          </div>
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            v{__APP_VERSION__}
          </span>
        </header>

        <section aria-label="Get started" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Step n={1} title="Open your app" body="Type an address in the bar above, or jump to a local dev server.">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PORTS.map(p => (
                <button key={p} className="btn" style={{ fontFamily: 'var(--font-mono)' }}
                  onClick={() => navigate(tabId, `localhost:${p}`)}>:{p}</button>
              ))}
            </div>
          </Step>
          <Step n={2} title="Map your services"
            body={connected ? `Connected to ${displayUrl(sentinelUrl)}. Point it at your project to see how its services depend on each other.`
              : 'Connect SentinelGraph once, then point it at your project: no diagrams to draw.'}>
            {connected ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={() => void connectCodebase()}>Connect project…</button>
                <button className="btn" onClick={() => setActiveView('dependencies')}><Share2 size={13} /> Service map</button>
              </div>
            ) : (
              <button className="btn primary" onClick={() => setActiveView('settings')}>Connect SentinelGraph</button>
            )}
          </Step>
          <Step n={3} title="Inspect as you browse" body="Every request, header and cookie of the page you are on, without leaving it.">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setActiveView('network')}><Network size={13} /> Network</button>
              <button className="btn" onClick={() => setActiveView('security')}><ShieldAlert size={13} /> Security</button>
              <button className="btn" onClick={() => setActiveView('apiClient')}><Send size={13} /> API client</button>
            </div>
          </Step>
        </section>

        {recent.length > 0 && (
          <section aria-label="Recent" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="section-label" style={{ marginBottom: 6 }}>Recent</div>
            {recent.map(h => (
              <button key={h.url} onClick={() => navigate(tabId, h.url)}
                style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 10px', border: 0, borderRadius: 6,
                  background: 'transparent', color: 'var(--text-primary)', textAlign: 'left', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{h.title}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {displayUrl(h.url)}
                </span>
              </button>
            ))}
          </section>
        )}

        <footer style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', color: 'var(--text-muted)', fontSize: 12,
          borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <span><kbd style={kbd}>{MOD}</kbd> <kbd style={kbd}>L</kbd> address bar</span>
          <span><kbd style={kbd}>{MOD}</kbd> <kbd style={kbd}>T</kbd> new tab</span>
          <span><kbd style={kbd}>{MOD}</kbd> <kbd style={kbd}>K</kbd> commands</span>
          <button onClick={() => setShortcuts(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, border: 0, background: 'transparent', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>
            <Keyboard size={13} /> All shortcuts
          </button>
        </footer>
      </div>
    </div>
  );
};

const kbd: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, padding: '1px 5px', borderRadius: 4,
  border: '1px solid var(--border-medium)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' };

const Step: React.FC<{ n: number; title: string; body: string; children: React.ReactNode }> = ({ n, title, body, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 10, minWidth: 0,
    border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 20, height: 20, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
        background: 'var(--accent-soft)', color: 'var(--accent)' }}>{n}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
    </div>
    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-secondary)', flex: 1 }}>{body}</p>
    {children}
  </div>
);
