import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useAppStore, type NavigationView } from '../../store/useAppStore';
import { FULL_PAGE_VIEWS, useNarrow } from '../../useNarrow';

const TITLES: Partial<Record<NavigationView, string>> = {
  network: 'Network',
  apiClient: 'API Client',
  security: 'Security',
  dependencies: 'SentinelGraph',
  ai: 'AI Assistant',
  settings: 'Settings'
};

const WIDTH_KEY = 'devbrowser.dock.width';
const MIN = 360;

/** A tool panel docked to the right of the page, like DevTools docked right. Drag its edge to resize. */
export const ToolDock: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const view = useAppStore(s => s.activeView);
  const setActiveView = useAppStore(s => s.setActiveView);
  const narrow = useNarrow();
  const fullPage = FULL_PAGE_VIEWS.has(view);
  const maximized = useAppStore(s => s.panelMaximized) || narrow || fullPage;
  const setMaximized = useAppStore(s => s.setPanelMaximized);
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= MIN ? saved : Math.round(window.innerWidth * 0.42);
  });
  const dragging = useRef(false);
  const [resizing, setResizing] = useState(false);

  const onMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    setWidth(Math.min(Math.max(window.innerWidth - e.clientX, MIN), window.innerWidth - 320));
  }, []);

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setResizing(false);
      setWidth(w => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', up);
    };
  }, [onMove]);

  return (
    <section aria-label={`${TITLES[view] ?? ''} panel`} style={{ position: 'relative', display: 'flex', flexDirection: 'column',
      width: maximized ? undefined : width, flex: maximized ? 1 : 'none', minWidth: 0, maxWidth: '100%',
      background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-subtle)' }}>
      {!maximized && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          onMouseDown={e => { e.preventDefault(); dragging.current = true; setResizing(true); }}
          style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 5 }}
        />
      )}
      {/* While resizing, a shield stops the page's webview from swallowing mouse events. */}
      {resizing && <div style={{ position: 'fixed', inset: 0, zIndex: 100, cursor: 'col-resize' }} />}
      <header style={{ display: 'flex', alignItems: 'center', gap: 4, height: 34, padding: '0 6px 0 12px', flexShrink: 0,
        borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{TITLES[view]}</span>
        {!narrow && !fullPage && <button className="icon-btn" title={maximized ? 'Restore beside page' : 'Maximize'}
          aria-label={maximized ? 'Restore panel' : 'Maximize panel'} onClick={() => setMaximized(!maximized)}>
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>}
        <button className="icon-btn" title={fullPage ? 'Back to the page (Cmd+\\)' : 'Close panel (Cmd+\\)'} aria-label="Close panel" onClick={() => setActiveView('browser')}>
          <X size={15} />
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>
    </section>
  );
};
