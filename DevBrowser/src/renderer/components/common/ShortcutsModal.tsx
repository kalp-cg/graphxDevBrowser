import React from 'react';
import { X, Keyboard } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const ShortcutsModal: React.FC = () => {
  const isOpen = useAppStore(s => s.shortcutsModalOpen);
  const setOpen = useAppStore(s => s.setShortcutsModalOpen);

  if (!isOpen) return null;

  const shortcutGroups = [
    {
      category: 'Navigation & Views',
      shortcuts: [
        { keys: '⌘ 1', description: 'Switch to Browser View' },
        { keys: '⌘ 2', description: 'Switch to Network Inspector' },
        { keys: '⌘ 3', description: 'Switch to API Client' },
        { keys: '⌘ 4', description: 'Switch to Security Auditor' },
        { keys: '⌘ 5', description: 'Switch to Dependency Graph' },
        { keys: '⌘ 6', description: 'Switch to Local AI Assistant' },
        { keys: '⌘ ,', description: 'Open Settings' }
      ]
    },
    {
      category: 'Browser & Workspace',
      shortcuts: [
        { keys: '⌘ T', description: 'New Container Tab' },
        { keys: '⌘ W', description: 'Close Active Tab' },
        { keys: '⌘ R', description: 'Reload Active Tab' },
        { keys: '⌘ L', description: 'Focus Omnibox Address Input' },
        { keys: '⌘ K', description: 'Open Command Palette' },
        { keys: '?', description: 'Open Keyboard Shortcuts Cheatsheet' }
      ]
    },
    {
      category: 'Developer Suite & Actions',
      shortcuts: [
        { keys: '⌘ Enter', description: 'Send API Client Request' },
        { keys: '⌘ K ⌘ C', description: 'Clear Network Stream' },
        { keys: '⌘ \\', description: 'Toggle Left Navigation Sidebar' },
        { keys: '⌘ D', description: 'Run Local AI Diagnosis' },
        { keys: 'Esc', description: 'Close Modals / Cancel Operation' }
      ]
    }
  ];

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="fade-in"
        onClick={e => e.stopPropagation()}
        style={{
          width: '620px',
          maxHeight: '520px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Keyboard size={18} color="var(--accent-cyan)" />
            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Keyboard Shortcuts Cheatsheet
            </span>
          </div>

          <button
            onClick={() => setOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {shortcutGroups.map(group => (
            <div key={group.category}>
              <div style={{
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--accent-cyan)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '8px'
              }}>
                {group.category}
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(1, 1fr)',
                gap: '6px'
              }}>
                {group.shortcuts.map(sc => (
                  <div
                    key={sc.keys}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      background: 'var(--bg-surface)',
                      borderRadius: '6px'
                    }}
                  >
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {sc.description}
                    </span>
                    <kbd style={{
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-medium)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: 'var(--text-primary)',
                      boxShadow: 'var(--shadow-sm)'
                    }}>
                      {sc.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
