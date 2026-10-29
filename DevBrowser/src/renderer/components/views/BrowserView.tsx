import React from 'react';
import { 
  Globe, 
  Sparkles, 
  Network, 
  Layers
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../common/Badge';

export const BrowserView: React.FC = () => {
  const currentUrl = useAppStore(s => s.currentUrl);
  const splitLayout = useAppStore(s => s.splitLayout);
  const tabs = useAppStore(s => s.tabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const partitions = useAppStore(s => s.partitions);
  const setActiveView = useAppStore(s => s.setActiveView);
  const sendAiPrompt = useAppStore(s => s.sendAiPrompt);
  const addToast = useAppStore(s => s.addToast);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const activePartition = partitions.find(p => p.id === activeTab?.partitionId);

  const handleQuickAiAudit = () => {
    setActiveView('ai');
    sendAiPrompt(`Audit the security headers and network calls currently active on ${currentUrl}`);
    addToast({
      type: 'info',
      title: 'AI Analysis Initiated',
      message: `Analyzing active page: ${currentUrl}`
    });
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: splitLayout === 'split-horizontal' ? 'column' : 'row',
      overflow: 'hidden',
      background: 'var(--bg-primary)'
    }}>
      {/* Primary Browser Pane */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary)',
        borderRight: splitLayout === 'split-vertical' ? '1px solid var(--border-medium)' : 'none',
        borderBottom: splitLayout === 'split-horizontal' ? '1px solid var(--border-medium)' : 'none',
        position: 'relative'
      }}>
        {/* Pane Sub-header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={15} color="var(--accent-cyan)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Primary Webview Sandbox
            </span>
            {activePartition && (
              <Badge 
                label={activePartition.name} 
                variant="primary" 
                icon={<Layers size={10} />} 
              />
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveView('network')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
              className="transition-smooth hover:bg-slate-800"
            >
              <Network size={12} color="var(--accent-cyan)" />
              Inspect Network
            </button>

            <button
              onClick={handleQuickAiAudit}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: 'var(--accent-emerald)',
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
              className="transition-smooth hover:opacity-90"
            >
              <Sparkles size={12} />
              Ask AI to Diagnose
            </button>
          </div>
        </div>

        {/* The page itself. Its network traffic is intercepted over CDP (Network view, security audit) and
            its API calls feed the SentinelGraph dependency graph when connected. */}
        <webview
          src={currentUrl}
          partition={activePartition?.partitionKey ?? 'persist:dev-default'}
          style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
        />
      </div>

      {/* Secondary Split Pane (if active) */}
      {splitLayout !== 'single' && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          position: 'relative'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={14} color="var(--accent-indigo)" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Secondary Container Role (Split Pane)
              </span>
              <Badge label="Admin Role" variant="danger" />
            </div>
          </div>

          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center'
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Side-by-Side Multi-Tenant Testing
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.5 }}>
              Test multi-role permissions side-by-side. The secondary pane operates in a completely isolated Electron partition with distinct cookies and local storage.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
