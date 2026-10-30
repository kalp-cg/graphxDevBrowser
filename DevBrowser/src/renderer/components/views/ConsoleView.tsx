import React, { useMemo, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { asText, visible, type ConsoleFilter } from '../../../shared/domain/console';
import { useConsoleStore } from '../../store/useConsoleStore';
import { useBrowserStore } from '../../store/useBrowserStore';
import { useAppStore } from '../../store/useAppStore';

const TONE = { log: 'var(--text-primary)', warning: 'var(--warn)', error: 'var(--danger)' } as const;

/** Every page's console in one list: errors and warnings first-class, repeats folded, filterable, copyable. */
export const ConsoleView: React.FC = () => {
  const entries = useConsoleStore(s => s.entries);
  const clear = useConsoleStore(s => s.clear);
  const tabs = useBrowserStore(s => s.tabs);
  const activeId = useBrowserStore(s => s.activeId);
  const addToast = useAppStore(s => s.addToast);
  const [level, setLevel] = useState<ConsoleFilter['level']>('all');
  const [thisTab, setThisTab] = useState(true);
  const [text, setText] = useState('');
  const shown = useMemo(() => visible(entries, { level, tabId: thisTab ? activeId : null, text }), [entries, level, thisTab, activeId, text]);
  const title = (id: string) => tabs.find(t => t.id === id)?.title ?? 'closed tab';
  const errors = entries.filter(e => e.level === 'error' && (!thisTab || e.tabId === activeId)).reduce((n, e) => n + e.count, 0);

  return (
    <div role="region" aria-label="Console panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {(['all', 'error', 'warning'] as const).map(l => (
            <button key={l} className={`btn${level === l ? ' primary' : ''}`} style={{ height: 26 }} aria-pressed={level === l} onClick={() => setLevel(l)}>
              {l === 'all' ? 'All' : l === 'error' ? `Errors${errors ? ` (${errors})` : ''}` : 'Warnings'}
            </button>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', marginLeft: 6 }}>
            <input type="checkbox" checked={thisTab} onChange={e => setThisTab(e.target.checked)} /> This tab only
          </label>
          <button className="icon-btn" aria-label="Copy console" title="Copy what is shown" style={{ marginLeft: 'auto' }}
            onClick={() => { void navigator.clipboard.writeText(asText(shown)); addToast({ type: 'info', title: 'Copied' }); }}><Copy size={14} /></button>
          <button className="icon-btn" aria-label="Clear console" title="Clear" onClick={() => clear(thisTab ? activeId : undefined)}><Trash2 size={14} /></button>
        </div>
        <input className="field" aria-label="Filter console" placeholder="Filter messages" value={text} onChange={e => setText(e.target.value)} />
      </div>
      <div role="log" aria-label="Console messages" style={{ flex: 1, minHeight: 0, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
        {shown.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: 12.5 }}>
            {entries.length ? 'Nothing matches the filter.' : 'Nothing logged yet. Errors and warnings from every page you open show up here, even with this panel closed.'}
          </div>
        )}
        {shown.map(e => (
          <div key={e.id} style={{ display: 'flex', gap: 8, padding: '5px 12px', borderBottom: '1px solid var(--border-subtle)',
            background: e.level === 'error' ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : undefined }}>
            <span style={{ color: TONE[e.level], fontWeight: 700, width: 14, flexShrink: 0 }} aria-label={e.level}>{e.level === 'error' ? '✕' : e.level === 'warning' ? '!' : '›'}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: TONE[e.level] }}>{e.message}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>
                {new Date(e.at).toLocaleTimeString()}{e.source ? ` · ${e.source}:${e.line}` : ''}{!thisTab ? ` · ${title(e.tabId)}` : ''}
              </div>
            </div>
            {e.count > 1 && <span className="tag" style={{ height: 16, alignSelf: 'flex-start' }} aria-label={`${e.count} times`}>{e.count}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};
