import React from 'react';
import { 
  Globe, 
  Network, 
  Send, 
  ShieldAlert, 
  Share2, 
  Bot, 
  Settings, 
  PanelLeftClose, 
  PanelLeftOpen 
} from 'lucide-react';
import { useAppStore, type NavigationView } from '../../store/useAppStore';

export const Sidebar: React.FC = () => {
  const activeView = useAppStore(s => s.activeView);
  const setActiveView = useAppStore(s => s.setActiveView);
  const collapsed = useAppStore(s => s.sidebarCollapsed);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const findingsCount = useAppStore(s => s.findings.length);
  const networkCount = useAppStore(s => s.transactions.length);
  const ollamaOk = useAppStore(s => s.ollamaStatus.ok);

  const navItems: Array<{
    id: NavigationView;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
    badgeColor?: string;
  }> = [
    { id: 'browser', label: 'Browser', icon: <Globe size={18} /> },
    { 
      id: 'network', 
      label: 'Network', 
      icon: <Network size={18} />, 
      badge: networkCount > 0 ? networkCount : undefined,
      badgeColor: 'var(--accent-cyan)'
    },
    { id: 'apiClient', label: 'API Client', icon: <Send size={18} /> },
    { 
      id: 'security', 
      label: 'Security', 
      icon: <ShieldAlert size={18} />, 
      badge: findingsCount > 0 ? findingsCount : undefined,
      badgeColor: '#ef4444'
    },
    { id: 'dependencies', label: 'Dependencies', icon: <Share2 size={18} /> },
    { 
      id: 'ai', 
      label: 'AI Assistant', 
      icon: <Bot size={18} />,
      badge: ollamaOk ? '●' : undefined,
      badgeColor: 'var(--accent-emerald)'
    },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> }
  ];

  return (
    <aside
      style={{
        width: collapsed ? '54px' : '190px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '8px 6px',
        transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        flexShrink: 0,
        zIndex: 15
      }}
    >
      {/* Top Nav Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: collapsed ? '8px 10px' : '8px 12px',
                borderRadius: '6px',
                border: 'none',
                background: isActive ? 'var(--bg-active)' : 'transparent',
                color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                width: '100%',
                position: 'relative',
                overflow: 'hidden'
              }}
              className="transition-smooth hover:bg-slate-800"
            >
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                {item.icon}
              </div>

              {!collapsed && (
                <span style={{ flex: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {item.label}
                </span>
              )}

              {item.badge !== undefined && (
                <span style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  color: item.badgeColor || 'var(--text-primary)',
                  background: 'var(--bg-tertiary)',
                  padding: collapsed ? '1px 3px' : '1px 6px',
                  borderRadius: '999px',
                  lineHeight: 1.2
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Sidebar Collapse Toggle */}
      <button
        onClick={toggleSidebar}
        title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          borderRadius: '6px',
          justifyContent: collapsed ? 'center' : 'flex-start'
        }}
        className="transition-smooth hover:bg-slate-800"
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        {!collapsed && <span style={{ fontSize: '11px' }}>Collapse View</span>}
      </button>
    </aside>
  );
};
