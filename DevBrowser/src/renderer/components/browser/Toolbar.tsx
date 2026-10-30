import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Columns2, Info, Lock, PanelRight, RotateCw, SquareTerminal, Smartphone, Star, TriangleAlert, X
} from 'lucide-react';
import { canBookmark, DEVICES, displayUrl, isBookmarked, siteSecurity } from '../../../shared/domain/browser';
import { emulate, goBack, goForward, navigate, reload, setZoom, stop, toggleDevTools } from '../../browser/pages';
import { useBrowserStore } from '../../store/useBrowserStore';
import { useAppStore } from '../../store/useAppStore';

/** Back / forward / reload, the address bar, and the page tools (device, split, DevTools, side panel). */
export const Toolbar: React.FC = () => {
  const tab = useBrowserStore(s => s.tabs.find(t => t.id === s.activeId));
  const split = useBrowserStore(s => s.split);
  const toggleSplit = useBrowserStore(s => s.toggleSplit);
  const addressFocus = useBrowserStore(s => s.addressFocus);
  const bookmarks = useBrowserStore(s => s.bookmarks);
  const toggleBookmarkOfActive = useBrowserStore(s => s.toggleBookmarkOfActive);
  const starred = !!tab && isBookmarked(bookmarks, tab.url);
  const activeView = useAppStore(s => s.activeView);
  const togglePanel = useAppStore(s => s.togglePanel);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [deviceMenu, setDeviceMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) setText(displayUrl(tab?.url ?? ''));
  }, [tab?.url, tab?.id, editing]);

  useEffect(() => {
    if (addressFocus) {
      input.current?.focus();
      input.current?.select();
    }
  }, [addressFocus]);

  useEffect(() => {
    if (!deviceMenu) return;
    const close = (e: MouseEvent) => menuRef.current?.contains(e.target as Node) || setDeviceMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [deviceMenu]);

  if (!tab) return null;
  const security = siteSecurity(tab.url);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 40, padding: '0 8px', flexShrink: 0,
      background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
      <button className="icon-btn" title="Back (Cmd+[)" aria-label="Back" disabled={!tab.canGoBack} onClick={() => goBack()}>
        <ArrowLeft size={16} />
      </button>
      <button className="icon-btn" title="Forward (Cmd+])" aria-label="Forward" disabled={!tab.canGoForward}
        onClick={() => goForward()}>
        <ArrowRight size={16} />
      </button>
      {tab.loading ? (
        <button className="icon-btn" title="Stop" aria-label="Stop loading" onClick={() => stop()}><X size={16} /></button>
      ) : (
        <button className="icon-btn" title="Reload (Cmd+R)" aria-label="Reload" onClick={() => reload()}>
          <RotateCw size={15} />
        </button>
      )}

      <form
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 10px',
          margin: '0 4px', borderRadius: 15, background: 'var(--bg-tertiary)',
          border: `1px solid ${editing ? 'var(--accent)' : 'transparent'}` }}
        onSubmit={e => {
          e.preventDefault();
          if (text.trim()) navigate(tab.id, text);
          input.current?.blur();
        }}
      >
        {security === 'secure' && <Lock size={13} aria-label="Secure connection" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
        {security === 'insecure' && (
          <span className="tag warn" title="This site is not using HTTPS"><TriangleAlert size={11} style={{ marginRight: 4 }} />Not secure</span>
        )}
        {security === 'local' && (
          <span title="Local development server" style={{ display: 'flex', flexShrink: 0 }}>
            <Info size={13} style={{ color: 'var(--text-muted)' }} />
          </span>
        )}
        <input
          ref={input}
          aria-label="Address and search bar"
          spellCheck={false}
          placeholder="Search or enter address"
          value={text}
          onChange={e => setText(e.target.value)}
          onFocus={e => {
            setEditing(true);
            setText(tab.url === 'about:blank' ? '' : tab.url);
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setText(displayUrl(tab.url));
              e.currentTarget.blur();
            }
          }}
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'var(--text-primary)',
            font: '13px var(--font-sans)' }}
        />
        {canBookmark(tab.url) && (
          <button type="button" className="icon-btn" aria-label={starred ? 'Remove bookmark' : 'Bookmark this page'} aria-pressed={starred}
            title={`${starred ? 'Remove bookmark' : 'Bookmark this page'} (Cmd+D)`} onClick={toggleBookmarkOfActive}
            style={{ width: 22, height: 22, color: starred ? 'var(--warn)' : 'var(--text-muted)' }}>
            <Star size={14} fill={starred ? 'currentColor' : 'none'} />
          </button>
        )}
        {tab.zoom !== 1 && (
          <button type="button" className="tag" style={{ border: 0, cursor: 'pointer' }} title="Reset zoom (Cmd+0)"
            onClick={() => setZoom(tab.id, 1)}>
            {Math.round(tab.zoom * 100)}%
          </button>
        )}
      </form>

      <div ref={menuRef} style={{ position: 'relative' }}>
        <button className="icon-btn" title="Device mode (Cmd+Shift+M)" aria-label="Device mode" aria-pressed={!!tab.device}
          onClick={() => setDeviceMenu(m => !m)}>
          <Smartphone size={16} />
        </button>
        {deviceMenu && (
          <div className="menu" role="menu" style={{ top: 32, right: 0 }}>
            <button role="menuitemradio" aria-checked={!tab.device}
              onClick={() => { void emulate(tab.id, null); setDeviceMenu(false); }}>
              Desktop (no emulation)
            </button>
            <hr />
            {DEVICES.map(d => (
              <button key={d.id} role="menuitemradio" aria-checked={tab.device === d.id}
                onClick={() => { void emulate(tab.id, d.id); setDeviceMenu(false); }}>
                {d.name}
                <span className="hint">{d.width} × {d.height}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="icon-btn" title="Split view: compare this page as another profile (Cmd+Shift+S)" aria-label="Split view"
        aria-pressed={!!split} onClick={toggleSplit}>
        <Columns2 size={16} />
      </button>
      <button className="icon-btn" title="Page developer tools (Cmd+Option+I)" aria-label="Page developer tools"
        onClick={() => toggleDevTools()}>
        <SquareTerminal size={16} />
      </button>
      <button className="icon-btn" title="Tool panel (Cmd+\)" aria-label="Tool panel" aria-pressed={activeView !== 'browser'}
        onClick={togglePanel}>
        <PanelRight size={16} />
      </button>
    </div>
  );
};
