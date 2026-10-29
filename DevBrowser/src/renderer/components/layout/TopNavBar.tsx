import React, { useState } from 'react';
import { 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  Plus, 
  X, 
  Columns, 
  Rows, 
  Square, 
  Search, 
  HelpCircle,
  Lock,
  Layers
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface DragCSSProperties extends React.CSSProperties {
  WebkitAppRegion?: 'drag' | 'no-drag';
}

export const TopNavBar: React.FC = () => {
  const tabs = useAppStore(s => s.tabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const partitions = useAppStore(s => s.partitions);
  const currentUrl = useAppStore(s => s.currentUrl);
  const splitLayout = useAppStore(s => s.splitLayout);
  const setSplitLayout = useAppStore(s => s.setSplitLayout);
  const setActiveTabId = useAppStore(s => s.setActiveTabId);
  const createNewTab = useAppStore(s => s.createNewTab);
  const closeTab = useAppStore(s => s.closeTab);
  const navigateTab = useAppStore(s => s.navigateTab);
  const setCommandPaletteOpen = useAppStore(s => s.setCommandPaletteOpen);
  const setShortcutsOpen = useAppStore(s => s.setShortcutsModalOpen);

  const [inputUrl, setInputUrl] = useState(currentUrl);

  // Sync inputUrl when currentUrl changes from external navigation
  React.useEffect(() => {
    setInputUrl(currentUrl);
  }, [currentUrl]);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const activePartition = partitions.find(p => p.id === activeTab?.partitionId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl) return;
    const formatted = inputUrl.startsWith('http://') || inputUrl.startsWith('https://')
      ? inputUrl
      : `http://${inputUrl}`;
    navigateTab(formatted);
  };

  return (
    <header style={{
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-subtle)',
      WebkitAppRegion: 'drag'
    } as DragCSSProperties}>
      {/* Top Tab Bar with Window Drag Region */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '76px', // Spacing for macOS window controls
        paddingRight: '12px',
        height: '38px',
        gap: '4px',
        overflowX: 'auto'
      }}>
        {tabs.map((tab) => {
          const partition = partitions.find(p => p.id === tab.partitionId);
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 10px',
                borderRadius: '6px 6px 0 0',
                background: isActive ? 'var(--bg-surface)' : 'transparent',
                borderTop: isActive ? `2px solid ${partition?.color || 'var(--accent-cyan)'}` : '2px solid transparent',
                borderLeft: isActive ? '1px solid var(--border-medium)' : '1px solid transparent',
                borderRight: isActive ? '1px solid var(--border-medium)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                minWidth: '150px',
                maxWidth: '220px',
                WebkitAppRegion: 'no-drag'
              } as DragCSSProperties}
              className="transition-smooth"
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: partition?.color || '#3b82f6',
                  flexShrink: 0
                }}
              />
              <span style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1
              }}>
                {tab.title}
              </span>

              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  title="Close Tab (⌘W)"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '3px',
                    display: 'flex'
                  }}
                  className="transition-smooth hover:text-red-400"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={() => createNewTab()}
          title="New Container Tab (⌘T)"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '5px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            WebkitAppRegion: 'no-drag'
          } as DragCSSProperties}
          className="transition-smooth hover:bg-slate-800"
        >
          <Plus size={15} />
        </button>

        <div style={{ flex: 1 }} />

        {/* Action Buttons: Split View, Shortcuts, Command Palette */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', WebkitAppRegion: 'no-drag' } as DragCSSProperties}>
          <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '2px' }}>
            <button
              onClick={() => setSplitLayout('single')}
              title="Single Pane View"
              style={{
                background: splitLayout === 'single' ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                color: splitLayout === 'single' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                padding: '3px 6px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              <Square size={13} />
            </button>
            <button
              onClick={() => setSplitLayout('split-vertical')}
              title="Split Vertical View"
              style={{
                background: splitLayout === 'split-vertical' ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                color: splitLayout === 'split-vertical' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                padding: '3px 6px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              <Columns size={13} />
            </button>
            <button
              onClick={() => setSplitLayout('split-horizontal')}
              title="Split Horizontal View"
              style={{
                background: splitLayout === 'split-horizontal' ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                color: splitLayout === 'split-horizontal' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                padding: '3px 6px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              <Rows size={13} />
            </button>
          </div>

          <button
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard Shortcuts (?)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '5px'
            }}
          >
            <HelpCircle size={15} />
          </button>
        </div>
      </div>

      {/* Omnibox / Navigation Control Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '5px 12px 7px',
        gap: '8px',
        background: 'var(--bg-surface)',
        WebkitAppRegion: 'no-drag'
      } as DragCSSProperties}>
        <div style={{ display: 'flex', gap: '2px' }}>
          <button
            title="Back"
            disabled={!activeTab?.canGoBack}
            style={{
              background: 'transparent',
              border: 'none',
              color: activeTab?.canGoBack ? 'var(--text-secondary)' : 'var(--text-muted)',
              cursor: activeTab?.canGoBack ? 'pointer' : 'default',
              padding: '6px',
              borderRadius: '4px'
            }}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            title="Forward"
            disabled={!activeTab?.canGoForward}
            style={{
              background: 'transparent',
              border: 'none',
              color: activeTab?.canGoForward ? 'var(--text-secondary)' : 'var(--text-muted)',
              cursor: activeTab?.canGoForward ? 'pointer' : 'default',
              padding: '6px',
              borderRadius: '4px'
            }}
          >
            <ArrowRight size={14} />
          </button>
          <button
            title="Reload (⌘R)"
            onClick={() => navigateTab(currentUrl)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '4px'
            }}
          >
            <RotateCw size={13} />
          </button>
        </div>

        {/* Address Input Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            background: 'var(--bg-primary)',
            borderRadius: '6px',
            border: '1px solid var(--border-medium)',
            padding: '3px 10px',
            gap: '8px'
          }}
        >
          <Lock size={12} color="var(--accent-emerald)" />

          {activePartition && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: activePartition.color,
                background: `${activePartition.color}15`,
                padding: '2px 6px',
                borderRadius: '4px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Layers size={11} />
              {activePartition.name}
            </span>
          )}

          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Enter URL or localhost address..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              outline: 'none'
            }}
          />

          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Search size={10} />
            ⌘K
          </button>
        </form>
      </div>
    </header>
  );
};
