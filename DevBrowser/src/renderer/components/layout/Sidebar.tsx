import React, { useEffect, useState } from 'react';
import {
  BookOpen, Bot, CircleDot, Globe, History, LayoutDashboard, Network, PanelLeftClose, PanelLeftOpen, Play, Plus, Search, Send,
  Settings, Share2, ShieldAlert, Terminal
} from 'lucide-react';
import { useRunStore } from '../../store/useRunStore';
import { useConsoleStore } from '../../store/useConsoleStore';
import { useRecorderStore } from '../../store/useRecorderStore';
import { useBrowserStore } from '../../store/useBrowserStore';
import { useAppStore, type NavigationView } from '../../store/useAppStore';
import { forSite } from '../../../shared/domain/browser';
import { useNarrow } from '../../useNarrow';

const COLLAPSED_KEY = 'devbrowser.sidebar.collapsed';
const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
const MOD = mac ? '⌘' : 'Ctrl+';

interface Item {
  id: NavigationView;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  tone?: 'danger' | 'accent';
  hint?: string;
}

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

/**
 * The app's navigation, grouped by what you are doing: the page you browse, your system (SentinelGraph), inspecting
 * the page, and building. Every destination is named, so nothing has to be guessed from an icon. Collapses to icons.
 */
export const Sidebar: React.FC = () => {
  const activeView = useAppStore(s => s.activeView);
  const setActiveView = useAppStore(s => s.setActiveView);
  const setPalette = useAppStore(s => s.setCommandPaletteOpen);
  const currentUrl = useAppStore(s => s.currentUrl);
  const siteFindings = useAppStore(s => s.findings);
  const siteRequests = useAppStore(s => s.transactions);
  const sentinel = useAppStore(s => s.sentinelStatus);
  const snapshot = useAppStore(s => s.sentinelSnapshot);
  const running = useAppStore(s => s.sentinelRun.phase === 'running');
  const newTab = useBrowserStore(s => s.newTab);
  const narrow = useNarrow();
  const [pinnedCollapsed, setPinnedCollapsed] = useState(readCollapsed);
  const collapsed = pinnedCollapsed || narrow;

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, pinnedCollapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [pinnedCollapsed]);

  // Badges describe the website that is open, like the panels do.
  const findings = forSite(siteFindings, currentUrl).length;
  const here = forSite(siteRequests, currentUrl);
  const failed = here.filter(t => !t.statusCode || t.statusCode >= 500).length;
  const recording = useRecorderStore(s => s.status === 'recording');
  const runStatus = useRunStore(s => s.status);
  const activeTab = useBrowserStore(s => s.activeId);
  const pageErrors = useConsoleStore(s => s.entries.filter(e => e.level === 'error' && e.tabId === activeTab).reduce((n, e) => n + e.count, 0));
  const alerts = sentinel === 'connected' ? (snapshot?.nodes ?? []).filter(n => n.type === 'Alert' && n.status !== 'resolved').length : 0;
  const services = (snapshot?.nodes ?? []).filter(n => n.type === 'Service').length;

  const groups: { title: string; items: Item[] }[] = [
    { title: 'Your system', items: [
      { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} />,
        badge: alerts ? String(alerts) : undefined, tone: 'danger' },
      { id: 'dependencies', label: 'System map', icon: <Share2 size={16} />, badge: running ? '' : undefined, tone: 'accent' }
    ] },
    { title: 'Inspect this page', items: [
      { id: 'network', label: 'Network', icon: <Network size={16} />,
        badge: failed ? String(failed) : here.length ? String(Math.min(here.length, 999)) : undefined, tone: failed ? 'danger' : undefined },
      { id: 'console', label: 'Console', icon: <Terminal size={16} />,
        badge: pageErrors ? String(Math.min(pageErrors, 99)) : undefined, tone: 'danger' },
      { id: 'security', label: 'Security', icon: <ShieldAlert size={16} />, badge: findings ? String(findings) : undefined, tone: 'danger' },
      { id: 'apiClient', label: 'API Client', icon: <Send size={16} /> }
    ] },
    { title: 'Build', items: [
      { id: 'run', label: 'Run', icon: <Play size={16} />,
        badge: runStatus === 'running' ? '' : runStatus === 'crashed' ? '!' : undefined, tone: runStatus === 'crashed' ? 'danger' : 'accent' },
      { id: 'recorder', label: 'Bug Recorder', icon: <CircleDot size={16} />, badge: recording ? '' : undefined, tone: 'danger' },
      { id: 'ai', label: 'AI Assistant', icon: <Bot size={16} /> }
    ] },
    { title: 'Browser', items: [
      { id: 'library', label: 'History & bookmarks', icon: <History size={16} /> }
    ] }
  ];

  const row = (item: Item, onClick?: () => void) => {
    const active = activeView === item.id;
    return (
      <button key={item.id} className={`nav-item${active ? ' active' : ''}`} title={collapsed ? item.label : item.hint}
        aria-label={item.label} aria-pressed={active}
        onClick={onClick ?? (() => setActiveView(active && item.id !== 'browser' ? 'browser' : item.id))}>
        <span className="nav-icon">{item.icon}</span>
        {!collapsed && <span className="nav-label">{item.label}</span>}
        {item.badge !== undefined && (
          <span className={`nav-badge${item.badge ? '' : ' dot'}${item.tone ? ` ${item.tone}` : ''}`}>{item.badge}</span>
        )}
      </button>
    );
  };

  const statusTone = sentinel === 'connected' ? (alerts ? 'danger' : 'ok') : sentinel === 'connecting' ? 'warn' : 'off';
  const statusText = sentinel === 'connected' ? `${services} services${alerts ? ` · ${alerts} alert${alerts === 1 ? '' : 's'}` : ' · healthy'}`
    : sentinel === 'connecting' ? 'Starting…' : 'Not connected';

  return (
    <nav aria-label="Tools" className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-top">
        {!narrow && (
          <button className="icon-btn" onClick={() => setPinnedCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>
      <button className="nav-item primary" onClick={() => { newTab(); setActiveView('browser'); }} aria-label="Open a new tab" title={collapsed ? 'New tab' : undefined}>
        <span className="nav-icon"><Plus size={16} /></span>
        {!collapsed && <><span className="nav-label">New tab</span><span className="nav-kbd">{MOD}T</span></>}
      </button>
      <button className="nav-item" onClick={() => setPalette(true)} aria-label="Search everything" title={collapsed ? 'Search everything' : undefined}>
        <span className="nav-icon"><Search size={16} /></span>
        {!collapsed && <><span className="nav-label">Search</span><span className="nav-kbd">{MOD}K</span></>}
      </button>
      {row({ id: 'browser', label: 'Browser', icon: <Globe size={16} /> })}

      <div className="sidebar-scroll">
        {groups.map(g => (
          <div key={g.title} role="group" aria-label={g.title} className="nav-group">
            {collapsed ? <div className="nav-sep" /> : <div className="nav-group-title">{g.title}</div>}
            {g.items.map(i => row(i))}
          </div>
        ))}
      </div>

      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => setActiveView(sentinel === 'connected' ? 'overview' : 'settings')}
          aria-label={`SentinelGraph: ${statusText}`} title={collapsed ? `SentinelGraph: ${statusText}` : undefined}>
          <span className="nav-icon"><span className={`status-dot ${statusTone}`} /></span>
          {!collapsed && (
            <span className="nav-label" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
              <span style={{ fontSize: 12 }}>SentinelGraph</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{statusText}</span>
            </span>
          )}
        </button>
        {row({ id: 'guide', label: 'Guide', icon: <BookOpen size={16} />, hint: 'What DevBrowser does and how to use it' })}
        {row({ id: 'settings', label: 'Settings', icon: <Settings size={16} /> })}
      </div>
    </nav>
  );
};
