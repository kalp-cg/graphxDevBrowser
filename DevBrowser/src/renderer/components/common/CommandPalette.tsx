import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Globe, 
  Network, 
  Send, 
  ShieldAlert, 
  Share2, 
  Bot, 
  Settings, 
  Plus, 
  Trash2, 
  Sun, 
  Moon, 
  HelpCircle,
  Flame
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useBrowserStore } from '../../store/useBrowserStore';

interface CommandItem {
  id: string;
  category: 'Navigation' | 'Actions' | 'Workspace';
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

  const commands: CommandItem[] = [
    {
      id: 'nav-browser',
      category: 'Navigation',
      title: 'Close Tool Panel',
      subtitle: 'Give the page the full window',
      icon: <Globe size={16} />,
      action: () => setActiveView('browser')
    },
    {
      id: 'nav-network',
      category: 'Navigation',
      title: 'Go to Network Inspector',
      subtitle: 'View live CDP stream, headers, and request bodies',
      icon: <Network size={16} />,
      action: () => setActiveView('network')
    },
    {
      id: 'nav-api',
      category: 'Navigation',
      title: 'Go to API Client',
      subtitle: 'Build, replay, and chain HTTP requests',
      icon: <Send size={16} />,
      action: () => setActiveView('apiClient')
    },
    {
      id: 'nav-security',
      category: 'Navigation',
      title: 'Go to Passive Security Auditor',
      subtitle: 'Review OWASP Top 10 evidence-based findings',
      icon: <ShieldAlert size={16} />,
      action: () => setActiveView('security')
    },
    {
      id: 'nav-graph',
      category: 'Navigation',
      title: 'Open Dependency Graph',
      subtitle: 'SentinelGraph: services, health, blast radius, investigations',
      icon: <Share2 size={16} />,
      action: () => setActiveView('dependencies')
    },
    {
      id: 'nav-ai',
      category: 'Navigation',
      title: 'Go to Local AI Assistant',
      subtitle: 'On-device Ollama code & test assistant',
      icon: <Bot size={16} />,
      action: () => setActiveView('ai')
    },
    {
      id: 'nav-settings',
      category: 'Navigation',
      title: 'Go to Settings',
      subtitle: 'Manage privacy, AI model, and integrations',
      icon: <Settings size={16} />,
      shortcut: '⌘,',
      action: () => setActiveView('settings')
    },
    {
      id: 'act-new-tab',
      category: 'Workspace',
      title: 'New Tab',
      subtitle: 'Open a page in the current profile',
      icon: <Plus size={16} />,
      shortcut: '⌘T',
      action: () => newTab()
    },
    {
      id: 'act-clear-network',
      category: 'Actions',
      title: 'Clear Network Log',
      subtitle: 'Purge all captured HTTP transactions',
      icon: <Trash2 size={16} />,
      action: () => clearTransactions()
    },
    {
      id: 'act-toggle-theme',
      category: 'Actions',
      title: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`,
      subtitle: 'Toggle accessible color theme',
      icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
      action: () => toggleTheme()
    },
    {
      id: 'act-shortcuts',
      category: 'Actions',
      title: 'Keyboard Shortcuts Cheatsheet',
      subtitle: 'View all keyboard navigation shortcuts',
      icon: <HelpCircle size={16} />,
      shortcut: '?',
      action: () => setShortcutsOpen(true)
    },
    {
      id: 'act-nuclear-shred',
      category: 'Actions',
      title: 'Clear Browsing Data',
      subtitle: 'Cookies, storage and cache of every profile, saved credentials, captured traffic',
      icon: <Flame size={16} color="var(--danger)" />,
      action: () => {
        if (confirm('Clear cookies, storage and cache for every profile, saved credentials and captured traffic?')) {
          triggerNuclearShred();
        }
      }
    }
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
          <Search size={18} color="var(--accent-cyan)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search actions..."
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
              return (
                <div
                  key={cmd.id}
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
                    color: isSelected ? 'var(--accent-cyan)' : 'var(--text-muted)',
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
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
