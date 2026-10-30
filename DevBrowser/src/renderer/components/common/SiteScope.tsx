import React from 'react';
import { History } from 'lucide-react';
import { displayUrl } from '../../../shared/domain/browser';

/**
 * "This site | History": a panel shows what belongs to the website that is open; History shows everything captured
 * before, labelled with the page each item came from.
 */
export const SiteScope: React.FC<{ history: boolean; onChange: (history: boolean) => void; currentUrl: string; site: string;
  total: number }> = ({ history, onChange, currentUrl, site, total }) => {
  const tab = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', border: 0, borderRadius: 5, cursor: 'pointer',
    fontSize: 11, fontWeight: 600, background: active ? 'var(--bg-surface)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)'
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div role="group" aria-label="Scope" style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 7, background: 'var(--bg-tertiary)', flexShrink: 0 }}>
        <button style={tab(!history)} aria-pressed={!history} onClick={() => onChange(false)}>This site</button>
        <button style={tab(history)} aria-pressed={history} onClick={() => onChange(true)}>
          <History size={12} />
          History{total ? ` (${total})` : ''}
        </button>
      </div>
      <span title={currentUrl} style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        fontFamily: 'var(--font-mono)' }}>
        {history ? 'all pages' : site ? displayUrl(site) : 'no page open'}
      </span>
    </div>
  );
};
