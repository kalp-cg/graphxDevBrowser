import React, { useState } from 'react';
import { 
  Play, 
  Folder, 
  Plus, 
  Key, 
  Copy, 
  Check, 
  CheckCircle, 
  Clock
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../common/Badge';

export const ApiClientView: React.FC = () => {
  const activeRequest = useAppStore(s => s.activeRequest);
  const setActiveRequest = useAppStore(s => s.setActiveRequest);
  const environments = useAppStore(s => s.environments);
  const activeEnvironmentId = useAppStore(s => s.activeEnvironmentId);
  const collections = useAppStore(s => s.collections);
  const apiResponse = useAppStore(s => s.apiResponse);
  const isApiSending = useAppStore(s => s.isApiSending);
  const sendActiveRequest = useAppStore(s => s.sendActiveRequest);
  const addToast = useAppStore(s => s.addToast);

  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body' | 'assertions'>('body');
  const [copiedCurl, setCopiedCurl] = useState(false);

  const activeEnv = environments.find(e => e.id === activeEnvironmentId);

  const handleCopyCurl = () => {
    const curl = `curl -X ${activeRequest.method} '${activeRequest.url}' \\\n` +
      activeRequest.headers.filter(h => h.enabled).map(h => `  -H '${h.key}: ${h.value}'`).join(' \\\n') +
      (activeRequest.body.raw ? ` \\\n  -d '${activeRequest.body.raw}'` : '');

    navigator.clipboard.writeText(curl);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 1500);
    addToast({ type: 'info', title: 'cURL Command Copied to Clipboard' });
  };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      {/* Left Collections & Environment Sidebar */}
      <div style={{
        width: '230px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0
      }}>
        {/* Environment Profile Selector */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
            ACTIVE ENVIRONMENT
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--bg-primary)',
            padding: '5px 8px',
            borderRadius: '6px',
            border: '1px solid var(--border-medium)',
            fontSize: '12px'
          }}>
            <Key size={12} color="var(--accent-amber)" />
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
              {activeEnv?.name || 'No Environment'}
            </span>
          </div>

          <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {activeEnv?.variables.map(v => (
              <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--accent-cyan)' }}>{`{{${v.key}}}`}:</span>
                <span style={{ color: 'var(--text-muted)' }}>{v.isSecret ? '••••••••' : v.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Collections Tree */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>
              COLLECTIONS
            </span>
            <button
              title="New Collection"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <Plus size={14} />
            </button>
          </div>

          {collections.map(col => (
            <div key={col.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                padding: '4px 6px',
                borderRadius: '4px',
                background: 'var(--bg-tertiary)'
              }}>
                <Folder size={13} color="var(--accent-indigo)" />
                <span>{col.name}</span>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                padding: '4px 6px 4px 18px',
                borderRadius: '4px',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}>
                <Badge label={activeRequest.method} variant="success" size="sm" />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeRequest.name}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Request & Response Workspace */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Request URL Omnibox */}
        <div style={{
          padding: '12px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {activeRequest.name}
            </div>

            <button
              onClick={handleCopyCurl}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {copiedCurl ? <Check size={12} color="var(--accent-emerald)" /> : <Copy size={12} />}
              {copiedCurl ? 'Copied cURL' : 'Copy as cURL'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <select
              value={activeRequest.method}
              onChange={(e) => setActiveRequest({ ...activeRequest, method: e.target.value as never })}
              style={{
                background: 'var(--bg-primary)',
                color: activeRequest.method === 'POST' ? 'var(--accent-emerald)' : 'var(--accent-cyan)',
                border: '1px solid var(--border-medium)',
                borderRadius: '6px',
                padding: '6px 10px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: '13px'
              }}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>

            <input
              type="text"
              value={activeRequest.url}
              onChange={(e) => setActiveRequest({ ...activeRequest, url: e.target.value })}
              placeholder="https://api.example.com or {{baseUrl}}/api/v1/resource"
              style={{
                flex: 1,
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '6px',
                padding: '6px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px'
              }}
            />

            <button
              onClick={sendActiveRequest}
              disabled={isApiSending}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--accent-indigo)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 18px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: isApiSending ? 'wait' : 'pointer',
                opacity: isApiSending ? 0.7 : 1
              }}
              className="transition-smooth hover:opacity-90"
            >
              <Play size={14} />
              {isApiSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>

        {/* Request Tabs & Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Request Config (Left Half) */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--border-subtle)',
            background: 'var(--bg-primary)'
          }}>
            <div style={{
              display: 'flex',
              padding: '0 12px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)'
            }}>
              {(['body', 'headers', 'params', 'assertions'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: activeTab === tab ? '2px solid var(--accent-indigo)' : '2px solid transparent',
                    color: activeTab === tab ? 'var(--accent-indigo)' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    cursor: 'pointer'
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, padding: '12px', overflowY: 'auto' }}>
              {activeTab === 'body' && (
                <textarea
                  value={activeRequest.body.raw || ''}
                  onChange={(e) => setActiveRequest({
                    ...activeRequest,
                    body: { ...activeRequest.body, raw: e.target.value }
                  })}
                  style={{
                    width: '100%',
                    height: '100%',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: '6px',
                    padding: '10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    resize: 'none',
                    outline: 'none'
                  }}
                />
              )}

              {activeTab === 'headers' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {activeRequest.headers.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={h.key}
                        readOnly
                        style={{
                          flex: 1,
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-medium)',
                          padding: '4px 8px',
                          color: 'var(--accent-cyan)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          borderRadius: '4px'
                        }}
                      />
                      <input
                        type="text"
                        value={h.value}
                        readOnly
                        style={{
                          flex: 2,
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-medium)',
                          padding: '4px 8px',
                          color: 'var(--text-primary)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          borderRadius: '4px'
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'assertions' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {activeRequest.assertions.map(as => (
                    <div key={as.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'var(--bg-surface)',
                      padding: '8px 12px',
                      borderRadius: '6px'
                    }}>
                      <CheckCircle size={15} color="var(--accent-emerald)" />
                      <div style={{ flex: 1, fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                        {as.name}: <code>{as.script}</code>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Response Viewer (Right Half) */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-secondary)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)'
            }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>
                RESPONSE INSPECTOR
              </span>

              {apiResponse && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <Badge label="200 OK" variant="success" />
                  <Badge label="38 ms" variant="primary" icon={<Clock size={10} />} />
                </div>
              )}
            </div>

            <div style={{ flex: 1, padding: '12px', overflowY: 'auto' }}>
              {apiResponse ? (
                <pre style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--accent-cyan)',
                  background: 'var(--bg-primary)',
                  padding: '12px',
                  borderRadius: '6px',
                  height: '100%',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap'
                }}>
                  {JSON.stringify(apiResponse, null, 2)}
                </pre>
              ) : (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-muted)',
                  fontSize: '13px'
                }}>
                  Click "Send" to execute the request with environment interpolation
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
