import React, { useMemo } from 'react';
import { displayUrl } from '../../../shared/domain/browser';
import { navigate } from '../../browser/pages';
import { useBrowserStore } from '../../store/useBrowserStore';

/** A new tab: the sites visited most recently, one per host, local dev servers first. */
export const StartPage: React.FC<{ tabId: string }> = ({ tabId }) => {
  const history = useBrowserStore(s => s.history);
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const h of history) {
      const host = new URL(h.url).host;
      if (!seen.has(host)) {
        seen.add(host);
        out.push(h);
      }
      if (out.length === 8) break;
    }
    return out;
  }, [history]);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: 'var(--bg-primary)', padding: '12vh 24px 24px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>New tab</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Type an address, a port number for a local dev server (<code>3000</code>), or a search.
          </p>
        </div>
        {recent.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="section-label" style={{ marginBottom: 4 }}>Recent</div>
            {recent.map(h => (
              <button key={h.url} onClick={() => navigate(tabId, h.url)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 10px',
                  border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-primary)', textAlign: 'left',
                  cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{h.title}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{displayUrl(h.url)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
