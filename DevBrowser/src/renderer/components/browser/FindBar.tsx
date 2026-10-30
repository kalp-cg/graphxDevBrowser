import React, { useEffect, useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { find, stopFind } from '../../browser/pages';
import { useBrowserStore } from '../../store/useBrowserStore';

/** Find in page (Cmd+F): Enter for the next match, Shift+Enter for the previous, Esc to close. */
export const FindBar: React.FC<{ tabId: string }> = ({ tabId }) => {
  const setFindOpen = useBrowserStore(s => s.setFindOpen);
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ active: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const view = document.querySelector<WebviewTag>(`[data-tab-id="${tabId}"] webview`);
    const onFound = (e: Electron.FoundInPageEvent) =>
      e.result.finalUpdate && setResult({ active: e.result.activeMatchOrdinal, total: e.result.matches });
    view?.addEventListener('found-in-page', onFound as EventListener);
    return () => {
      view?.removeEventListener('found-in-page', onFound as EventListener);
      stopFind(tabId);
    };
  }, [tabId]);

  const close = () => setFindOpen(false);

  return (
    <div role="search" style={{ position: 'absolute', top: 8, right: 16, zIndex: 20, display: 'flex', alignItems: 'center',
      gap: 4, padding: 4, border: '1px solid var(--border-medium)', borderRadius: 8, background: 'var(--bg-secondary)',
      boxShadow: 'var(--shadow-md)' }}>
      <input
        ref={input}
        className="field"
        style={{ width: 220, border: 0, background: 'transparent' }}
        placeholder="Find in page"
        aria-label="Find in page"
        value={text}
        onChange={e => {
          setText(e.target.value);
          if (!e.target.value) setResult(null);
          find(tabId, e.target.value);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') find(tabId, text, !e.shiftKey, true);
          if (e.key === 'Escape') close();
        }}
      />
      <span style={{ minWidth: 44, textAlign: 'right', fontSize: 12, color: result?.total === 0 ? 'var(--danger)' : 'var(--text-muted)',
        fontVariantNumeric: 'tabular-nums' }}>
        {result ? `${result.active}/${result.total}` : ''}
      </span>
      <button className="icon-btn" title="Previous match" disabled={!text} onClick={() => find(tabId, text, false, true)}>
        <ChevronUp size={15} />
      </button>
      <button className="icon-btn" title="Next match" disabled={!text} onClick={() => find(tabId, text, true, true)}>
        <ChevronDown size={15} />
      </button>
      <button className="icon-btn" title="Close (Esc)" onClick={close}><X size={15} /></button>
    </div>
  );
};
