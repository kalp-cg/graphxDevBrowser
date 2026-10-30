import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus, X } from 'lucide-react';
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
  const menuRef = useRef<HTMLDivElement>(null);
  const multipleProfiles = new Set(tabs.map(t => t.profile)).size > 1;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => menuRef.current?.contains(e.target as Node) || setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  return (
    <div role="tablist" aria-label="Tabs" style={{ ...drag, display: 'flex', alignItems: 'flex-end', gap: 2, height: 38,
      padding: `0 8px 0 ${isMac ? 78 : 8}px`, background: 'var(--bg-primary)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
        {tabs.map(tab => (
          <TabItem key={tab.id} tab={tab} active={tab.id === activeId} showProfile={multipleProfiles} />
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
    </div>
  );
};

const TabItem: React.FC<{ tab: Tab; active: boolean; showProfile: boolean }> = ({ tab, active, showProfile }) => {
  const activate = useBrowserStore(s => s.activate);
  const closeTab = useBrowserStore(s => s.closeTab);
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => setIconFailed(false), [tab.favicon]);

  return (
    <div
      role="tab"
      aria-selected={active}
      title={`${tab.title}\n${tab.url}`}
      onMouseDown={e => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.id); // middle click
        } else if (e.button === 0) activate(tab.id);
      }}
      style={{ ...noDrag, display: 'flex', alignItems: 'center', gap: 7, width: 200, minWidth: 72, height: 32,
        padding: '0 6px 0 10px', borderRadius: '8px 8px 0 0', cursor: 'default', flexShrink: 1,
        background: active ? 'var(--bg-secondary)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
    >
      {tab.loading ? (
        <Loader2 size={13} className="animate-spin" style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      ) : tab.favicon && !iconFailed ? (
        <img src={tab.favicon} alt="" width={14} height={14} style={{ flexShrink: 0 }} onError={() => setIconFailed(true)} />
      ) : (
        <span style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 3, background: 'var(--bg-active)' }} />
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
        {tab.title}
      </span>
      {showProfile && <span className="tag" style={{ height: 16, fontSize: 10 }}>{profileName(tab.profile)}</span>}
      <button className="icon-btn" style={{ width: 20, height: 20 }} title="Close tab (Cmd+W)" aria-label={`Close ${tab.title}`}
        onMouseDown={e => e.stopPropagation()} onClick={() => closeTab(tab.id)}>
        <X size={13} />
      </button>
    </div>
  );
};
