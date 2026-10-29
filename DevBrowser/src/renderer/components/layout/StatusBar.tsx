import React from 'react';
import { 
  Cpu, 
  Flame, 
  HardDrive, 
  ShieldCheck, 
  Volume2, 
  Sun, 
  Moon, 
  Share2, 
  Sparkles 
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const StatusBar: React.FC = () => {
  const metrics = useAppStore(s => s.hardwareMetrics);
  const ollamaStatus = useAppStore(s => s.ollamaStatus);
  const tigerGraphStatus = useAppStore(s => s.tigerGraphStatus);
  const theme = useAppStore(s => s.theme);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const triggerNuclearShred = useAppStore(s => s.triggerNuclearShred);

  const formatBytes = (bytes: number): string => {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatMb = (bytes: number): string => {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  return (
    <footer style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '26px',
      background: 'var(--bg-primary)',
      borderTop: '1px solid var(--border-subtle)',
      padding: '0 10px',
      fontSize: '11px',
      fontFamily: 'var(--font-mono)',
      color: 'var(--text-muted)',
      userSelect: 'none',
      flexShrink: 0
    }}>
      {/* Left: Hardware Specs & Providers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Cpu size={12} color="var(--accent-cyan)" />
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>M4 Apple Silicon</span>
        </div>

        {metrics && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <HardDrive size={12} color="var(--accent-purple)" />
            <span>
              RAM: {formatBytes(metrics.totalUnifiedMemoryBytes - metrics.freeUnifiedMemoryBytes)} / {formatBytes(metrics.totalUnifiedMemoryBytes)}
            </span>
            <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
              (App RSS: {formatMb(metrics.appMemoryUsageBytes)})
            </span>
          </div>
        )}

        {/* Local AI status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Sparkles size={11} color={ollamaStatus.ok ? 'var(--accent-emerald)' : 'var(--accent-rose)'} />
          <span style={{ color: ollamaStatus.ok ? 'var(--text-secondary)' : 'var(--accent-rose)' }}>
            Ollama: {ollamaStatus.ok ? ollamaStatus.model : 'Offline'}
          </span>
        </div>

        {/* TigerGraph status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Share2 size={11} color="var(--text-muted)" />
          <span>
            TigerGraph: {tigerGraphStatus === 'connected' ? 'Cloud Cluster' : 'In-Memory Engine'}
          </span>
        </div>

        {/* Wispr Flow status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Volume2 size={12} color="var(--accent-indigo)" />
          <span>Voice: Wispr Flow Ready</span>
        </div>
      </div>

      {/* Right: Security, Theme Toggle & Nuclear Shred */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ShieldCheck size={12} color="var(--accent-emerald)" />
          <span style={{ color: 'var(--text-secondary)' }}>Keychain Vault Active</span>
        </div>

        {/* Theme Switcher Button */}
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: '4px'
          }}
          className="transition-smooth hover:bg-slate-800"
        >
          {theme === 'dark' ? <Sun size={12} color="var(--accent-amber)" /> : <Moon size={12} color="var(--accent-indigo)" />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>

        {/* Nuclear Shred Button */}
        <button
          onClick={() => {
            if (confirm('CRITICAL ACTION: Execute Nuclear Shred?\nThis will permanently delete all session partitions, SQLite history, and Keychain secrets.')) {
              triggerNuclearShred();
            }
          }}
          title="Permanently wipe local SQLite database, session partitions, and Keychain credentials"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: '11px',
            padding: '1px 7px',
            borderRadius: '4px',
            fontWeight: 600
          }}
          className="transition-smooth hover:bg-red-950"
        >
          <Flame size={12} />
          Nuclear Shred
        </button>
      </div>
    </footer>
  );
};
