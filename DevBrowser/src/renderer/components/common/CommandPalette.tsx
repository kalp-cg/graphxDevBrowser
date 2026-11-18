import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen, Bot, CircleDot, Flame, FolderGit2, GitCompareArrows, Globe, HelpCircle, History, LayoutDashboard, Moon, Network,
  Play, Plus, Search, Send, Settings, Share2, ShieldAlert, Sun, Terminal, Trash2
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useBrowserStore } from '../../store/useBrowserStore';
import { useRecorderStore } from '../../store/useRecorderStore';
import { startRecording, stopRecording } from '../../browser/recorder';

interface CommandItem {
  id: string;
  category: 'Your system' | 'Inspect this page' | 'Build' | 'Browser' | 'DevBrowser';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

export const CommandPalette: React.FC = () => {
  const isOpen = useAppStore(s => s.commandPaletteOpen);
  const setOpen = useAppStore(s => s.setCommandPaletteOpen);
  const setActiveView = useAppStore(s => s.setActiveView);
  const newTab = useBrowserStore(s => s.newTab);
  const clearTransactions = useAppStore(s => s.clearTransactions);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const theme = useAppStore(s => s.theme);
  const setShortcutsOpen = useAppStore(s => s.setShortcutsModalOpen);
  const triggerNuclearShred = useAppStore(s => s.triggerNuclearShred);
  const investigate = useAppStore(s => s.startSentinelInvestigation);
  const checkImpact = useAppStore(s => s.checkImpact);
  const connectCodebase = useAppStore(s => s.connectCodebase);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const go = (view: Parameters<typeof setActiveView>[0]) => () => setActiveView(view);
  const recording = useRecorderStore.getState().status === 'recording';
  // One list of everything DevBrowser does, grouped like the sidebar. Titles are what you want to do, not what the tool is.
  const commands: CommandItem[] = [
    { id: 'overview', category: 'Your system', title: 'Overview', subtitle: 'Health, alerts, recent changes and what waits for you',
      icon: <LayoutDashboard size={16} />, action: go('overview') },
    { id: 'map', category: 'Your system', title: 'System map', subtitle: 'Every service and how they depend on each other',
      icon: <Share2 size={16} />, action: go('dependencies') },
    { id: 'investigate', category: 'Your system', title: 'Investigate what is failing', subtitle: 'Walk the map to the root cause and the change behind it',
      icon: <ShieldAlert size={16} />, action: () => { setActiveView('dependencies'); void investigate(); } },
    { id: 'impact', category: 'Your system', title: 'Check my changes', subtitle: 'Which services your uncommitted work affects, before you merge',
      icon: <GitCompareArrows size={16} />, action: () => { setActiveView('dependencies'); void checkImpact(); } },
    { id: 'connect', category: 'Your system', title: 'Connect a codebase…', subtitle: 'Map a repository on this machine: services, modules, owners',
      icon: <FolderGit2 size={16} />, action: () => void connectCodebase() },
    { id: 'network', category: 'Inspect this page', title: 'Network', subtitle: 'Every request this page made, with timing, headers and bodies',
      icon: <Network size={16} />, action: go('network') },
    { id: 'console', category: 'Inspect this page', title: 'Console', subtitle: 'Errors and warnings from this page',
      icon: <Terminal size={16} />, action: go('console') },
    { id: 'security', category: 'Inspect this page', title: 'Security', subtitle: 'What this site exposes, with evidence and how to fix it',
      icon: <ShieldAlert size={16} />, action: go('security') },
    { id: 'api', category: 'Inspect this page', title: 'API client', subtitle: 'Send a request, replay one from Network, import cURL',
      icon: <Send size={16} />, action: go('apiClient') },
    { id: 'clear-network', category: 'Inspect this page', title: 'Clear captured requests', subtitle: 'Empty the Network list',
      icon: <Trash2 size={16} />, action: () => clearTransactions() },
    { id: 'run', category: 'Build', title: 'Run your project', subtitle: 'Start a dev server; its page opens when it is up',
      icon: <Play size={16} />, action: go('run') },
    { id: 'record', category: 'Build', title: recording ? 'Stop recording' : 'Record a bug in this tab',
      subtitle: 'Clicks, requests and errors as one file a teammate can replay', icon: <CircleDot size={16} />,
      action: () => { if (recording) void stopRecording(); else { setActiveView('recorder'); void startRecording(); } } },
    { id: 'ai', category: 'Build', title: 'AI assistant', subtitle: 'Ask about this page; runs on your machine',
      icon: <Bot size={16} />, action: go('ai') },
    { id: 'new-tab', category: 'Browser', title: 'New tab', icon: <Plus size={16} />, shortcut: '⌘T', action: () => newTab() },
    { id: 'page', category: 'Browser', title: 'Back to the page', subtitle: 'Close the tool and give the page the whole window',
      icon: <Globe size={16} />, action: go('browser') },
    { id: 'history', category: 'Browser', title: 'History & bookmarks', icon: <History size={16} />, action: go('library') },
    { id: 'shred', category: 'Browser', title: 'Clear browsing data',
      subtitle: 'Cookies, storage and cache of every profile, saved credentials, captured traffic', icon: <Flame size={16} color="var(--danger)" />,
      action: () => {
        if (confirm('Clear cookies, storage and cache for every profile, saved credentials and captured traffic?')) triggerNuclearShred();
      } },
    { id: 'guide', category: 'DevBrowser', title: 'Guide: what DevBrowser does and how', subtitle: 'The whole product on one page',
      icon: <BookOpen size={16} />, action: go('guide') },
    { id: 'shortcuts', category: 'DevBrowser', title: 'Keyboard shortcuts', icon: <HelpCircle size={16} />, shortcut: '?',
      action: () => setShortcutsOpen(true) },
    { id: 'settings', category: 'DevBrowser', title: 'Settings', subtitle: 'SentinelGraph connection, local AI, privacy',
      icon: <Settings size={16} />, shortcut: '⌘,', action: go('settings') },
    { id: 'theme', category: 'DevBrowser', title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
      icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />, action: () => toggleTheme() },
  ];

  const filteredCommands = commands.filter(c => 
    c.title.toLowerCase().includes(query.toLowerCase()) || 
    c.category.toLowerCase().includes(query.toLowerCase()) ||
    (c.subtitle && c.subtitle.toLowerCase().includes(query.toLowerCase()))
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % (filteredCommands.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % (filteredCommands.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) {
        selected.action();
        setOpen(false);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="fade-in"
        onClick={e => e.stopPropagation()}
        style={{
          width: '560px',
          maxHeight: '420px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Search Input Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          gap: '10px'
        }}>
          <Search size={18} color="var(--accent)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="What do you want to do? Type to filter…"
            aria-label="Search commands"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '14px',
              fontFamily: 'var(--font-sans)',
              outline: 'none'
            }}
          />
          <span style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--bg-tertiary)',
            padding: '2px 6px',
            borderRadius: '4px'
          }}>
            ESC
          </span>
        </div>

        {/* Command Items List */}
        <div style={{ overflowY: 'auto', padding: '6px' }}>
          {filteredCommands.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              No commands found for "{query}"
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              const firstOfGroup = idx === 0 || filteredCommands[idx - 1]!.category !== cmd.category;
              return (
                <React.Fragment key={cmd.id}>
                {firstOfGroup && <div className="eyebrow" style={{ padding: idx ? '10px 12px 4px' : '4px 12px 4px' }}>{cmd.category}</div>}
                <div
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    cmd.action();
                    setOpen(false);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg-hover)' : 'transparent',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)'
                  }}
                  className="transition-smooth"
                >
                  <div style={{
                    color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    {cmd.icon}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                      {cmd.title}
                    </div>
                    {cmd.subtitle && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {cmd.subtitle}
                      </div>
                    )}
                  </div>

                  {cmd.shortcut && (
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-tertiary)',
                      padding: '2px 6px',
                      borderRadius: '4px'
                    }}>
                      {cmd.shortcut}
                    </span>
                  )}
                </div>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
