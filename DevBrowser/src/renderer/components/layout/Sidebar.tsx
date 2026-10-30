import React from 'react';
import { Bot, Network, Send, Settings, Share2, ShieldAlert } from 'lucide-react';
import { useAppStore, type NavigationView } from '../../store/useAppStore';

/** The tool rail: each button opens its panel beside the page; clicking the open one closes it. */
export const Sidebar: React.FC = () => {
  const activeView = useAppStore(s => s.activeView);
  const setActiveView = useAppStore(s => s.setActiveView);
  const findings = useAppStore(s => s.findings.length);
  const requests = useAppStore(s => s.transactions.length);
  const failed = useAppStore(s => s.transactions.filter(t => !t.statusCode || t.statusCode >= 500).length);
  const sentinel = useAppStore(s => s.sentinelStatus);
  const running = useAppStore(s => s.sentinelRun.phase === 'running');

  const items: { id: NavigationView; label: string; icon: React.ReactNode; badge?: string; tone?: 'danger' | 'accent' }[] = [
    { id: 'network', label: 'Network', icon: <Network size={18} />,
      badge: failed ? String(failed) : requests ? String(Math.min(requests, 999)) : undefined, tone: failed ? 'danger' : undefined },
    { id: 'dependencies', label: 'Dependencies (SentinelGraph)', icon: <Share2 size={18} />,
      badge: running ? '' : undefined, tone: 'accent' },
    { id: 'apiClient', label: 'API Client', icon: <Send size={18} /> },
    { id: 'security', label: 'Security', icon: <ShieldAlert size={18} />,
      badge: findings ? String(findings) : undefined, tone: 'danger' },
    { id: 'ai', label: 'AI Assistant', icon: <Bot size={18} /> }
  ];

  const button = (item: (typeof items)[number] | { id: NavigationView; label: string; icon: React.ReactNode; badge?: string; tone?: string }) => {
    const active = activeView === item.id;
    return (
      <button
        key={item.id}
        title={item.label}
        aria-label={item.label}
        aria-pressed={active}
        onClick={() => setActiveView(active ? 'browser' : item.id)}
        style={{ position: 'relative', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 0, borderRadius: 8, cursor: 'pointer',
          background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        {item.icon}
        {item.badge !== undefined && (
          <span style={{ position: 'absolute', top: 3, right: 2, minWidth: item.badge ? 15 : 7, height: item.badge ? 15 : 7,
            padding: item.badge ? '0 3px' : 0, borderRadius: 8, fontSize: 9, fontWeight: 700, lineHeight: '15px',
            textAlign: 'center', color: 'var(--accent-contrast)',
            background: item.tone === 'danger' ? 'var(--danger)' : item.tone === 'accent' ? 'var(--accent)' : 'var(--text-muted)' }}>
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <nav aria-label="Tools" style={{ width: 48, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 4, padding: '8px 0', background: 'var(--bg-primary)', borderRight: '1px solid var(--border-subtle)' }}>
      {items.map(button)}
      <div style={{ flex: 1 }} />
      {button({ id: 'settings', label: sentinel === 'connected' ? 'Settings' : 'Settings (SentinelGraph not connected)',
        icon: <Settings size={18} /> })}
    </nav>
  );
};
