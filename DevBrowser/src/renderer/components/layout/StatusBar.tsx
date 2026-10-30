import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useBrowserStore } from '../../store/useBrowserStore';

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

const Dot: React.FC<{ tone: 'ok' | 'warn' | 'off' }> = ({ tone }) => (
  <span style={{ width: 7, height: 7, borderRadius: 4, flexShrink: 0,
    background: tone === 'ok' ? 'var(--accent)' : tone === 'warn' ? 'var(--warn)' : 'var(--text-muted)' }} />
);

/** Facts only: what the active page is doing, what is connected, what the app uses. */
export const StatusBar: React.FC = () => {
  const tab = useBrowserStore(s => s.tabs.find(t => t.id === s.activeId));
  const sentinel = useAppStore(s => s.sentinelStatus);
  const sentinelUrl = useAppStore(s => s.sentinelUrl);
  const ollama = useAppStore(s => s.ollamaStatus);
  const metrics = useAppStore(s => s.hardwareMetrics);
  const requests = useAppStore(s => s.transactions.length);
  const theme = useAppStore(s => s.theme);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const setActiveView = useAppStore(s => s.setActiveView);

  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };

  return (
    <footer style={{ display: 'flex', alignItems: 'center', gap: 16, height: 24, padding: '0 12px', flexShrink: 0,
      fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-primary)', borderTop: '1px solid var(--border-subtle)' }}>
      <span style={{ ...item, minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tab?.error ? `Failed: ${tab.error.description}` : tab?.loading ? `Loading ${tab.url}` : tab?.url === 'about:blank' ? '' : tab?.url}
        </span>
      </span>
      <span style={item}>{requests} requests captured</span>
      <button onClick={() => setActiveView('settings')} title={sentinel === 'connected' ? sentinelUrl : 'Connect in Settings'}
        style={{ ...item, border: 0, background: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
        <Dot tone={sentinel === 'connected' ? 'ok' : sentinel === 'connecting' ? 'warn' : 'off'} />
        SentinelGraph {sentinel === 'connected' ? 'connected' : sentinel === 'connecting' ? 'connecting' : 'not connected'}
      </button>
      <span style={item} title={ollama.message}>
        <Dot tone={ollama.ok ? 'ok' : 'off'} />
        Local AI {ollama.ok ? ollama.model : 'offline'}
      </span>
      {metrics && (
        <span style={item} title="Memory used by every Dev Browser process (UI and pages)">
          {gb(metrics.appMemoryUsageBytes)} used
        </span>
      )}
      <button onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        aria-label="Toggle theme" style={{ ...item, border: 0, background: 'none', color: 'inherit', cursor: 'pointer' }}>
        {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
      </button>
    </footer>
  );
};
