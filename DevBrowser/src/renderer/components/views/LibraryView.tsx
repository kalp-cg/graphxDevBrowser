import React, { useState } from 'react';
import { Star, X } from 'lucide-react';
import { displayUrl } from '../../../shared/domain/browser';
import { useAppStore } from '../../store/useAppStore';
import { useBrowserStore } from '../../store/useBrowserStore';

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Everything you browsed and saved, searchable. History is kept on this machine only. */
export const LibraryView: React.FC = () => {
  const history = useBrowserStore(s => s.history);
  const bookmarks = useBrowserStore(s => s.bookmarks);
  const removeBookmark = useBrowserStore(s => s.removeBookmark);
  const newTab = useBrowserStore(s => s.newTab);
  const setActiveView = useAppStore(s => s.setActiveView);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const match = (e: { url: string; title: string }) => !q || e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q);
  const open = (url: string) => { newTab(url); setActiveView('browser'); };

  const days: { label: string; entries: typeof history }[] = [];
  for (const h of history.filter(match).slice(0, 300)) {
    const label = dayLabel(h.at);
    if (days[days.length - 1]?.label !== label) days.push({ label, entries: [] });
    days[days.length - 1]!.entries.push(h);
  }

  const marks = bookmarks.filter(match);

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 820 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ flex: 1 }}>History & bookmarks</h1>
          <input className="field" type="search" aria-label="Search history and bookmarks" placeholder="Search…"
            value={query} onChange={e => setQuery(e.target.value)} style={{ width: 260, maxWidth: '100%' }} autoFocus />
        </div>

        <section className="card" aria-label="Bookmarks">
          <div className="card-head"><Star size={13} /><h2>Bookmarks</h2><span className="muted" style={{ fontSize: 12 }}>{marks.length}</span></div>
          {marks.length === 0 ? (
            <p className="muted" style={{ padding: '12px 14px', fontSize: 13 }}>
              {bookmarks.length ? 'No bookmark matches.' : 'No bookmarks yet. Press the star in the address bar to save a page.'}
            </p>
          ) : marks.map(b => (
            <div key={b.url} className="list-row" style={{ alignItems: 'center', padding: '4px 6px 4px 0' }}>
              <button className="list-row" style={{ flex: 1, minWidth: 0, borderTop: 0 }} onClick={() => open(b.url)}>
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{b.title}</span>
                <span className="mono muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{displayUrl(b.url)}</span>
              </button>
              <button className="icon-btn" aria-label={`Remove bookmark ${b.title}`} onClick={() => removeBookmark(b.url)}><X size={13} /></button>
            </div>
          ))}
        </section>

        {days.length === 0 ? (
          <section className="card" aria-label="History">
            <p className="muted" style={{ padding: '12px 14px', fontSize: 13 }}>
              {history.length ? 'Nothing in your history matches.' : 'Pages you visit appear here. History stays on this machine.'}
            </p>
          </section>
        ) : days.map(d => (
          <section key={d.label} className="card" aria-label={`History: ${d.label}`}>
            <div className="card-head"><h2>{d.label}</h2></div>
            {d.entries.map(h => (
              <button key={`${h.url}-${h.at}`} className="list-row" onClick={() => open(h.url)}>
                <span className="mono muted" style={{ width: 44, flexShrink: 0 }}>
                  {new Date(h.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{h.title || displayUrl(h.url)}</span>
                <span className="mono muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%' }}>{displayUrl(h.url)}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
};
