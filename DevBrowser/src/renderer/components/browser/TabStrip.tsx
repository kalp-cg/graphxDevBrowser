import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Pin, Plus, TriangleAlert, X } from 'lucide-react';
import { reload } from '../../browser/pages';
import { PROFILES, profileName, useBrowserStore, type Tab } from '../../store/useBrowserStore';

const isMac = navigator.platform.toUpperCase().includes('MAC');
const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

/** Tabs across the top. The empty space drags the window (the title bar is hidden on macOS). */
export const TabStrip: React.FC = () => {
  const tabs = useBrowserStore(s => s.tabs);
  const activeId = useBrowserStore(s => s.activeId);
  const newTab = useBrowserStore(s => s.newTab);
  const [menu, setMenu] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number; id: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const multipleProfiles = new Set(tabs.map(t => t.profile)).size > 1;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => menuRef.current?.contains(e.target as Node) || setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  // Whichever tab becomes active comes into view: with many tabs the strip scrolls, and the one you switched to must never be off-screen.
  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  useEffect(() => {
    if (!context) return;
    const close = () => setContext(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', close);
    };
  }, [context]);

  return (
    <div role="tablist" aria-label="Tabs" onDoubleClick={e => e.target === e.currentTarget && newTab()} style={{ ...drag, display: 'flex', alignItems: 'flex-end', gap: 2, height: 38,
      padding: `0 8px 0 ${isMac ? 78 : 8}px`, background: 'var(--bg-primary)', flexShrink: 0 }}>
      <div ref={scroller} className="tab-scroller" style={{ ...noDrag, display: 'flex', alignItems: 'flex-end', gap: 2, minWidth: 0, flex: '0 1 auto',
        overflowX: 'auto', overflowY: 'hidden' }}>
        {tabs.map((tab, index) => (
          <TabItem key={tab.id} tab={tab} index={index} active={tab.id === activeId} showProfile={multipleProfiles}
            onContext={(x, y) => setContext({ x, y, id: tab.id })} />
        ))}
      </div>
      <div ref={menuRef} style={{ ...noDrag, position: 'relative', display: 'flex', alignItems: 'center', height: 32 }}>
        <button className="icon-btn" title="New tab (Cmd+T)" aria-label="New tab" onClick={() => newTab()}>
          <Plus size={16} />
        </button>
        <button className="icon-btn" style={{ width: 18 }} title="New tab in a profile" aria-label="New tab in a profile"
          aria-expanded={menu} onClick={() => setMenu(m => !m)}>
          <ChevronDown size={13} />
        </button>
        {menu && (
          <div className="menu" role="menu" style={{ top: 32, left: 0 }}>
            {PROFILES.map(p => (
              <button key={p.key} role="menuitem" onClick={() => { newTab(undefined, p.key); setMenu(false); }}>
                New tab as {p.name}
                <span className="hint">own cookies and storage</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {context && <TabMenu x={context.x} y={context.y} id={context.id} close={() => setContext(null)} />}
    </div>
  );
};

/** Right-click menu of a tab: the things a browser's tab menu has. */
const TabMenu: React.FC<{ x: number; y: number; id: string; close: () => void }> = ({ x, y, id, close }) => {
  const tabs = useBrowserStore(s => s.tabs);
  const canReopen = useBrowserStore(s => s.closed.length > 0);
  const { closeTab, closeOthers, closeToRight, duplicateTab, togglePin, reopenTab } = useBrowserStore.getState();
  const tab = tabs.find(t => t.id === id);
  if (!tab) return null;
  const index = tabs.indexOf(tab);
  const item = (label: string, run: () => void, hint?: string, disabled = false) => (
    <button role="menuitem" disabled={disabled} onMouseDown={e => e.stopPropagation()} onClick={() => { run(); close(); }}>
      {label}{hint && <span className="hint">{hint}</span>}
    </button>
  );
  return (
    <div className="menu" role="menu" aria-label="Tab menu" style={{ position: 'fixed', top: y, left: Math.min(x, window.innerWidth - 240) }}>
      {item('Reload', () => reload(id), 'Cmd+R')}
      {item('Duplicate', () => duplicateTab(id))}
      {item(tab.pinned ? 'Unpin tab' : 'Pin tab', () => togglePin(id))}
      {item('Close', () => closeTab(id), 'Cmd+W')}
      {item('Close other tabs', () => closeOthers(id), undefined, tabs.length < 2)}
      {item('Close tabs to the right', () => closeToRight(id), undefined, index >= tabs.length - 1)}
      {item('Reopen closed tab', () => reopenTab(), 'Cmd+Shift+T', !canReopen)}
    </div>
  );
};

const TabItem: React.FC<{ tab: Tab; index: number; active: boolean; showProfile: boolean; onContext: (x: number, y: number) => void }> =
  ({ tab, index, active, showProfile, onContext }) => {
  const activate = useBrowserStore(s => s.activate);
  const closeTab = useBrowserStore(s => s.closeTab);
  const moveTab = useBrowserStore(s => s.moveTab);
  const [iconFailed, setIconFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const [dropping, setDropping] = useState(false);
  useEffect(() => setIconFailed(false), [tab.favicon]);
  const down = tab.devServer === 'down';

  return (
    <div
      role="tab"
      aria-selected={active}
      aria-label={`${tab.title}${down ? ' (server stopped)' : ''}${tab.pinned ? ' (pinned)' : ''}`}
      title={`${tab.title}\n${tab.url}${down ? '\nThe dev server behind this page stopped responding' : ''}`}
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/devbrowser-tab', tab.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { if (e.dataTransfer.types.includes('text/devbrowser-tab')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={e => {
        e.preventDefault();
        setDropping(false);
        const id = e.dataTransfer.getData('text/devbrowser-tab');
        if (id && id !== tab.id) moveTab(id, index);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={e => { e.preventDefault(); onContext(e.clientX, e.clientY); }}
      onMouseDown={e => {
        if (e.button === 1) {
          e.preventDefault();
          if (!tab.pinned) closeTab(tab.id); // middle click
        } else if (e.button === 0) activate(tab.id);
      }}
      style={{ ...noDrag, display: 'flex', alignItems: 'center', gap: 7, flex: tab.pinned ? '0 0 38px' : '0 1 200px',
        minWidth: tab.pinned ? 38 : active ? 96 : 44, height: 32, padding: tab.pinned ? '0 0 0 12px' : '0 6px 0 10px',
        borderRadius: '8px 8px 0 0', cursor: 'default', position: 'relative',
        background: active ? 'var(--bg-secondary)' : hover ? 'var(--bg-hover, rgba(127,127,127,.12))' : 'transparent',
        boxShadow: dropping ? 'inset 2px 0 0 var(--accent)' : undefined,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
    >
      {tab.loading ? (
        <Loader2 size={13} className="animate-spin" style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      ) : down ? (
        <TriangleAlert size={14} aria-hidden style={{ flexShrink: 0, color: 'var(--danger)' }} />
      ) : tab.favicon && !iconFailed ? (
        <img src={tab.favicon} alt="" width={14} height={14} style={{ flexShrink: 0 }} onError={() => setIconFailed(true)} />
      ) : (
        <span style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 3, background: 'var(--bg-active)' }} />
      )}
      {!tab.pinned && (
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12,
          color: down ? 'var(--danger)' : undefined }}>
          {tab.title}
        </span>
      )}
      {tab.pinned && <Pin size={9} aria-hidden style={{ position: 'absolute', right: 5, bottom: 5, color: 'var(--text-muted)' }} />}
      {showProfile && !tab.pinned && <span className="tag" style={{ height: 16, fontSize: 10 }}>{profileName(tab.profile)}</span>}
      {!tab.pinned && (active || hover) && (
        <button className="icon-btn" style={{ width: 20, height: 20 }} title="Close tab (Cmd+W)" aria-label={`Close ${tab.title}`}
          onMouseDown={e => e.stopPropagation()} onClick={() => closeTab(tab.id)}>
          <X size={13} />
        </button>
      )}
    </div>
  );
};
