import React, { useState } from 'react';
import { 
  Shield, 
  Bot, 
  Share2, 
  Database, 
  Flame, 
  Key, 
  Volume2, 
  RefreshCw
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../common/Badge';

export const SettingsView: React.FC = () => {
  const telemetryEnabled = useAppStore(s => s.telemetryEnabled);
  const historyAutoPurgeDays = useAppStore(s => s.historyAutoPurgeDays);
  const ollamaHost = useAppStore(s => s.ollamaHost);
  const selectedAiModel = useAppStore(s => s.selectedAiModel);
  const setSetting = useAppStore(s => s.setSetting);
  const triggerNuclearShred = useAppStore(s => s.triggerNuclearShred);
  const checkOllama = useAppStore(s => s.checkOllama);
  const ollamaStatus = useAppStore(s => s.ollamaStatus);
  const addToast = useAppStore(s => s.addToast);
  const sentinelUrl = useAppStore(s => s.sentinelUrl);
  const sentinelStatus = useAppStore(s => s.sentinelStatus);
  const sentinelMessage = useAppStore(s => s.sentinelMessage);
  const connectSentinel = useAppStore(s => s.connectSentinel);

  const [activeTab, setActiveTab] = useState<'privacy' | 'ai' | 'integrations' | 'storage'>('privacy');
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [sentinelUrlInput, setSentinelUrlInput] = useState(sentinelUrl);
  // The token is only handed to the main process (encrypted there); it is not kept in app state.
  const [sentinelTokenInput, setSentinelTokenInput] = useState('');

  const handleConnectSentinel = async () => {
    await connectSentinel(sentinelUrlInput, sentinelTokenInput);
    setSentinelTokenInput('');
  };

  const handleTestOllama = async () => {
    setIsTestingOllama(true);
    await checkOllama();
    setIsTestingOllama(false);
    addToast({
      type: ollamaStatus.ok ? 'success' : 'warning',
      title: 'Ollama Connection Test',
      message: ollamaStatus.message || (ollamaStatus.ok ? 'Ollama daemon responsive' : 'Connection failed')
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      {/* Settings Navigation Sidebar */}
      <div style={{
        width: '210px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        padding: '16px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        flexShrink: 0
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', padding: '0 8px', marginBottom: '6px' }}>
          SETTINGS
        </div>

        {[
          { id: 'privacy', label: 'Privacy & Security', icon: <Shield size={16} /> },
          { id: 'ai', label: 'Local AI (Ollama)', icon: <Bot size={16} /> },
          { id: 'integrations', label: 'Integrations', icon: <Share2 size={16} /> },
          { id: 'storage', label: 'Storage & Shred', icon: <Database size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as never)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === tab.id ? 'var(--bg-active)' : 'transparent',
              color: activeTab === tab.id ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: activeTab === tab.id ? 600 : 500,
              cursor: 'pointer',
              textAlign: 'left'
            }}
            className="transition-smooth hover:bg-slate-800"
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Main Settings Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* 1. Privacy Tab */}
          {activeTab === 'privacy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Privacy Controls & Data Retention
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Dev Browser is strictly local-first. We collect zero analytics and route zero traffic through remote proxy servers.
                </p>
              </div>

              {/* Zero Telemetry Toggle */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Anonymous Diagnostic Telemetry
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Strict Default: Disabled. When disabled, zero network packets leave the machine.
                  </div>
                </div>

                <input
                  type="checkbox"
                  checked={telemetryEnabled}
                  onChange={e => setSetting('telemetryEnabled', e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </div>

              {/* Keychain SafeStorage Status */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Key size={18} color="var(--accent-emerald)" />
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Hardware-Backed Keychain Encryption
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Leverages macOS Keychain via Electron <code>safeStorage</code> API. Secrets are encrypted at rest.
                    </div>
                  </div>
                </div>

                <Badge label="Active (macOS Keychain)" variant="success" />
              </div>

              {/* Auto Purge Slider */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Automatic History & Network Purge Retention
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                    {historyAutoPurgeDays} Days
                  </span>
                </div>

                <input
                  type="range"
                  min={7}
                  max={90}
                  step={7}
                  value={historyAutoPurgeDays}
                  onChange={e => setSetting('historyAutoPurgeDays', parseInt(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>7 Days (Minimal Storage)</span>
                  <span>30 Days (Recommended)</span>
                  <span>90 Days (Extended Audit)</span>
                </div>
              </div>
            </div>
          )}

          {/* 2. AI Model Tab */}
          {activeTab === 'ai' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Local AI Inference Engine (Ollama)
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Inference executes locally on your MacBook Air M4 using unified memory and Metal GPU acceleration.
                </p>
              </div>

              {/* Ollama Host & Ping */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Ollama Daemon Host URL
                  </label>
                  <button
                    onClick={handleTestOllama}
                    disabled={isTestingOllama}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-medium)',
                      color: 'var(--text-primary)',
                      borderRadius: '5px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: isTestingOllama ? 'wait' : 'pointer'
                    }}
                  >
                    <RefreshCw size={12} className={isTestingOllama ? 'animate-spin' : ''} />
                    Test Connection
                  </button>
                </div>

                <input
                  type="text"
                  value={ollamaHost}
                  onChange={e => setSetting('ollamaHost', e.target.value)}
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px'
                  }}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                  <Badge
                    label={ollamaStatus.ok ? `Connected (${ollamaStatus.model})` : 'Daemon Offline'}
                    variant={ollamaStatus.ok ? 'success' : 'danger'}
                  />
                </div>
              </div>

              {/* Model Selection */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Active Quantized Coding Model
                </label>

                <select
                  value={selectedAiModel}
                  onChange={e => setSetting('selectedAiModel', e.target.value)}
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px'
                  }}
                >
                  <option value="qwen2.5-coder:7b">qwen2.5-coder:7b (Recommended · 4.7 GB VRAM · ~38 tok/s on M4)</option>
                  <option value="llama3.2:3b">llama3.2:3b (Lightweight · 2.0 GB VRAM · Low Battery Mode)</option>
                </select>

                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Configured with dynamic eviction (<code>keep_alive: "5m"</code>). Automatically unloads weights from unified RAM after 5 minutes of inactivity to keep your Mac fast.
                </div>
              </div>
            </div>
          )}

          {/* 3. Integrations Tab */}
          {activeTab === 'integrations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  External Provider Integrations
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Decoupled provider integrations for API dependency graphing and voice dictation.
                </p>
              </div>

              {/* SentinelGraph Card: the TigerGraph dependency graph + incident agent */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Share2 size={18} color="var(--accent-emerald)" />
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      SentinelGraph (TigerGraph Dependency Graph)
                    </span>
                  </div>
                  <Badge
                    label={sentinelStatus === 'connected' ? 'Connected' : sentinelStatus === 'connecting' ? 'Connecting' : 'Disconnected (Sample Graph)'}
                    variant={sentinelStatus === 'connected' ? 'success' : 'warning'}
                  />
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Loads the live service graph from a SentinelGraph API (backed by TigerGraph) and sends it the API calls
                  pages make in the browser, so the graph shows what your app really calls. Blast radius runs as a GSQL
                  traversal. TigerGraph credentials stay on the SentinelGraph server; the admin token is kept encrypted
                  in the main process.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      SentinelGraph API URL
                    </label>
                    <input
                      type="text"
                      value={sentinelUrlInput}
                      onChange={e => setSentinelUrlInput(e.target.value)}
                      placeholder="http://localhost:8100"
                      style={{
                        width: '100%',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-medium)',
                        borderRadius: '6px',
                        padding: '7px 10px',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      Admin Token
                    </label>
                    <input
                      type="password"
                      value={sentinelTokenInput}
                      onChange={e => setSentinelTokenInput(e.target.value)}
                      placeholder="X-Admin-Token"
                      style={{
                        width: '100%',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-medium)',
                        borderRadius: '6px',
                        padding: '7px 10px',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    onClick={handleConnectSentinel}
                    disabled={sentinelStatus === 'connecting'}
                    style={{
                      background: 'var(--accent-emerald)',
                      color: '#000',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '6px 14px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: sentinelStatus === 'connecting' ? 'wait' : 'pointer'
                    }}
                  >
                    {sentinelStatus === 'connecting' ? 'Connecting...' : 'Connect & Load Graph'}
                  </button>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sentinelMessage}</span>
                </div>
              </div>

              {/* Wispr Flow Card */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Volume2 size={18} color="var(--accent-indigo)" />
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Wispr Flow Voice Dictation Workflow
                    </span>
                  </div>

                  <Badge label="Desktop Dictation Ready" variant="success" />
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong>Supported Workflow:</strong> Wispr Flow runs as a system-level assistant on macOS. Focus any input field, code editor, or the Local AI prompt bar, press your Wispr Flow hotkey, and spoken code/assertions will insert directly with auto-punctuation.
                </div>

                <div style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '10px',
                  fontSize: '11px',
                  color: 'var(--text-muted)'
                }}>
                  Direct Voice Interface API mode (WebSocket streaming via <code>wss://platform-api.wisprflow.ai/ws</code>) is available for users with active Wispr Flow developer access keys.
                </div>
              </div>
            </div>
          )}

          {/* 4. Storage & Nuclear Shred Tab */}
          {activeTab === 'storage' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Local Storage & Data Destruction
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Manage the local SQLite cache and execute complete cryptographic data purges.
                </p>
              </div>

              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Local SQLite Database (devbrowser.db)
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Path: <code>~/Library/Application Support/DevBrowser/devbrowser.db</code>
                  </div>
                </div>

                <Badge label="2.4 MB on disk" variant="outline" />
              </div>

              {/* Nuclear Shred Danger Card */}
              <div style={{
                background: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                padding: '18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
                  <Flame size={20} />
                  <span style={{ fontSize: '15px', fontWeight: 700 }}>Nuclear Shred (Cryptographic Wipe)</span>
                </div>

                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  This action permanently destroys all local SQLite history, purges all container session partitions (cookies, localStorage, IndexedDB), and securely removes all decrypted credentials from the macOS Keychain. This cannot be undone.
                </p>

                <button
                  onClick={() => {
                    if (confirm('CRITICAL: Permanently destroy all local databases, session cookies, and Keychain credentials?')) {
                      triggerNuclearShred();
                    }
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 18px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  className="transition-smooth hover:bg-red-700"
                >
                  <Flame size={14} />
                  Execute Nuclear Shred
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
