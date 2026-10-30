import React, { useState } from 'react';
import { 
  Network, 
  Search, 
  Trash2, 
  Send, 
  Check, 
  Copy 
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ResizableHandle } from '../common/ResizableHandle';
import { InvestigationPanel, ServiceContextCard } from '../common/SentinelPanels';
import { EmptyState } from '../common/EmptyState';
import { SiteScope } from '../common/SiteScope';
import { forSite, siteOf } from '../../../shared/domain/browser';
import { timingPhases, toHar } from '../../../shared/domain/network';
import { THROTTLES } from '../../../shared/domain/browser';
import { useBrowserStore } from '../../store/useBrowserStore';
import { setThrottle } from '../../browser/pages';

export const NetworkView: React.FC = () => {
  const allTransactions = useAppStore(s => s.transactions);
  const currentUrl = useAppStore(s => s.currentUrl);
  const history = useAppStore(s => s.networkHistory);
  const setHistory = useAppStore(s => s.setNetworkHistory);
  const transactions = history ? allTransactions : forSite(allTransactions, currentUrl);
  const selectedTransactionId = useAppStore(s => s.selectedTransactionId);
  const setSelectedTransactionId = useAppStore(s => s.setSelectedTransactionId);
  const networkSearchQuery = useAppStore(s => s.networkSearchQuery);
  const setNetworkSearchQuery = useAppStore(s => s.setNetworkSearchQuery);
  const networkFilter = useAppStore(s => s.networkFilter);
  const setNetworkFilter = useAppStore(s => s.setNetworkFilter);
  const clearTransactions = useAppStore(s => s.clearTransactions);
  const loadFromNetworkTransaction = useAppStore(s => s.loadFromNetworkTransaction);
  const resizablePanelHeight = useAppStore(s => s.resizablePanelHeight);
  const setResizablePanelHeight = useAppStore(s => s.setResizablePanelHeight);
  const addToast = useAppStore(s => s.addToast);

  const activeTab = useBrowserStore(s => s.tabs.find(t => t.id === s.activeId));
  const throttle = activeTab?.throttle ?? 'none';

  const exportHar = (bodies: boolean) => {
    if (bodies && !confirm('Bodies can contain passwords or tokens that nothing can find and remove for you. Include them?')) return;
    const har = toHar(filteredTransactions, { bodies, version: __APP_VERSION__ });
    const url = URL.createObjectURL(new Blob([JSON.stringify(har, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `devbrowser-${new Date().toISOString().replace(/[:.]/g, '-')}.har`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: `Exported ${filteredTransactions.length} request${filteredTransactions.length === 1 ? '' : 's'}`,
      message: bodies ? 'HAR with bodies. Credentials in headers and query strings were removed; bodies were not scrubbed.' : 'HAR without bodies. Credentials were removed.' });
  };

  const [activeDetailTab, setActiveDetailTab] = useState<'headers' | 'payload' | 'response' | 'timing'>('headers');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const selectedTx = transactions.find(t => t.id === selectedTransactionId);

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = networkSearchQuery === '' ||
      t.url.toLowerCase().includes(networkSearchQuery.toLowerCase()) ||
      t.method.toLowerCase().includes(networkSearchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (networkFilter === 'all') return true;
    if (networkFilter === '2xx') return t.statusCode && t.statusCode >= 200 && t.statusCode < 300;
    if (networkFilter === '4xx') return t.statusCode && t.statusCode >= 400 && t.statusCode < 500;
    if (networkFilter === '5xx') return t.statusCode && t.statusCode >= 500;
    if (networkFilter === 'xhr') return t.mimeType?.includes('json') || t.method === 'POST';
    return true;
  });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
    addToast({ type: 'info', title: 'Copied to Clipboard' });
  };

  const handleResize = (deltaY: number) => {
    const newHeight = Math.max(160, Math.min(550, resizablePanelHeight + deltaY));
    setResizablePanelHeight(newHeight);
  };

  const getStatusColor = (code?: number) => {
    if (!code) return 'var(--text-muted)';
    if (code >= 200 && code < 300) return 'var(--accent-emerald)';
    if (code >= 300 && code < 400) return 'var(--accent-cyan)';
    if (code >= 400 && code < 500) return 'var(--accent-amber)';
    return 'var(--accent-rose)';
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      {/* Top Filter & Action Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-medium)',
            borderRadius: '6px',
            padding: '3px 8px',
            gap: '6px',
            maxWidth: '320px',
            width: '100%'
          }}>
            <Search size={13} color="var(--text-muted)" />
            <input
              type="text"
              value={networkSearchQuery}
              onChange={e => setNetworkSearchQuery(e.target.value)}
              placeholder="Filter by URL or method..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                outline: 'none'
              }}
            />
          </div>

          {/* Quick Filter Buttons */}
          <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '2px' }}>
            {['all', 'xhr', '2xx', '4xx', '5xx'].map((f) => (
              <button
                key={f}
                onClick={() => setNetworkFilter(f)}
                style={{
                  background: networkFilter === f ? 'var(--bg-surface)' : 'transparent',
                  color: networkFilter === f ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  border: 'none',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  cursor: 'pointer'
                }}
              >
                {f}
              </button>
            ))}
          </div>

          <SiteScope history={history} onChange={setHistory} currentUrl={currentUrl} site={siteOf(currentUrl)} total={allTransactions.length} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <select className="field" aria-label="Network throttling" value={throttle} style={{ height: 24, fontSize: 11, color: throttle === 'none' ? undefined : 'var(--warn)' }}
            title="Slow or cut this page's network, like DevTools. Reload the page to see the effect."
            onChange={e => void setThrottle(activeTab?.id ?? '', e.target.value)} disabled={!activeTab}>
            {THROTTLES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button className="btn" style={{ height: 24, fontSize: 11 }} disabled={!filteredTransactions.length} onClick={() => exportHar(false)}
            title="Save what is listed as a HAR file. Credentials are removed.">HAR</button>
          <button className="btn" style={{ height: 24, fontSize: 11 }} disabled={!filteredTransactions.length} onClick={() => exportHar(true)}
            title="HAR including request and response bodies (not scrubbed)">HAR + bodies</button>
          <button
            onClick={clearTransactions}
            title="Clear Network Stream"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '11px',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px'
            }}
            className="transition-smooth"
          >
            <Trash2 size={13} />
            Clear
          </button>
        </div>
      </div>

      {/* Main Network Transactions Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filteredTransactions.length === 0 ? (
          <EmptyState
            icon={<Network size={32} />}
            title={history ? 'No requests in the history' : siteOf(currentUrl) ? 'No requests for this site yet' : 'No page open'}
            description={siteOf(currentUrl) || history ? "DevBrowser's CDP interceptor is monitoring traffic. Navigate in the browser or trigger an API call to inspect traffic. Use History for earlier sites."
              : 'Open a page to see its network traffic. Use History for sites you visited earlier.'}
            actionLabel="Reset Filters"
            onAction={() => { setNetworkSearchQuery(''); setNetworkFilter('all'); }}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{
                borderBottom: '1px solid var(--border-medium)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-muted)',
                textAlign: 'left',
                position: 'sticky',
                top: 0,
                zIndex: 5
              }}>
                <th style={{ padding: '6px 10px', width: '70px' }}>Method</th>
                <th style={{ padding: '6px 10px', width: '80px' }}>Status</th>
                <th style={{ padding: '6px 10px' }}>URL Path</th>
                <th style={{ padding: '6px 10px', width: '120px' }}>MIME Type</th>
                <th style={{ padding: '6px 10px', width: '80px' }}>Protocol</th>
                <th style={{ padding: '6px 10px', width: '80px' }}>Size</th>
                <th style={{ padding: '6px 10px', width: '80px' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map(tx => {
                const isSelected = tx.id === selectedTransactionId;
                return (
                  <tr
                    key={tx.id}
                    onClick={() => setSelectedTransactionId(tx.id)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isSelected ? 'var(--bg-active)' : 'transparent',
                      cursor: 'pointer'
                    }}
                    className="transition-smooth"
                  >
                    <td style={{
                      padding: '6px 10px',
                      fontWeight: 700,
                      color: tx.method === 'POST' ? 'var(--accent-emerald)' : 'var(--accent-cyan)'
                    }}>
                      {tx.method}
                    </td>
                    <td style={{
                      padding: '6px 10px',
                      fontWeight: 600,
                      color: getStatusColor(tx.statusCode)
                    }}>
                      {tx.statusCode ? `${tx.statusCode} ${tx.statusText || ''}` : 'Pending'}
                    </td>
                    <td style={{
                      padding: '6px 10px',
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '380px'
                    }}>
                      {tx.url}
                    </td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>
                      {tx.mimeType || 'unknown'}
                    </td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>
                      {tx.protocol || '-'}
                    </td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>
                      {tx.encodedBodyLength ? `${Math.round(tx.encodedBodyLength / 1024 * 10) / 10} KB` : '-'}
                    </td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>
                      {tx.endTime && tx.startTime ? `${tx.endTime - tx.startTime} ms` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Resizable Divider Handle */}
      {selectedTx && (
        <ResizableHandle onResize={handleResize} />
      )}

      {/* Selected Transaction Inspector Detail Panel */}
      {selectedTx && (
        <div style={{
          height: `${resizablePanelHeight}px`,
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border-medium)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Detail Panel Sub-Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 12px',
            background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-subtle)'
          }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['headers', 'payload', 'response', 'timing'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveDetailTab(tab)}
                  style={{
                    padding: '4px 10px',
                    background: activeDetailTab === tab ? 'var(--bg-surface)' : 'transparent',
                    color: activeDetailTab === tab ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                    border: 'none',
                    borderBottom: activeDetailTab === tab ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    cursor: 'pointer'
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            <button
              onClick={() => loadFromNetworkTransaction(selectedTx)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--accent-indigo)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              className="transition-smooth hover:opacity-90"
            >
              <Send size={11} />
              Open in API Client
            </button>
          </div>

          {/* Detail Tab Contents */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            {activeDetailTab === 'headers' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <ServiceContextCard tx={selectedTx} />
                <InvestigationPanel />
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    GENERAL
                  </div>
                  <div style={{ background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                    <div><strong>Request URL:</strong> {selectedTx.url}</div>
                    <div><strong>Request Method:</strong> {selectedTx.method}</div>
                    <div><strong>Status Code:</strong> <span style={{ color: getStatusColor(selectedTx.statusCode) }}>{selectedTx.statusCode} {selectedTx.statusText}</span></div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    RESPONSE HEADERS
                  </div>
                  <div style={{ background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px' }}>
                    {Object.entries(selectedTx.responseHeaders || {}).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span style={{ color: 'var(--accent-cyan)' }}>{k}:</span>
                        <span style={{ color: 'var(--text-primary)' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    REQUEST HEADERS
                  </div>
                  <div style={{ background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px' }}>
                    {Object.entries(selectedTx.requestHeaders).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{k}:</span>
                        <span style={{ color: 'var(--text-primary)' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeDetailTab === 'payload' && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  REQUEST BODY (JSON)
                </div>
                <pre style={{
                  background: 'var(--bg-surface)',
                  padding: '10px',
                  borderRadius: '6px',
                  color: 'var(--accent-emerald)',
                  overflowX: 'auto'
                }}>
                  {selectedTx.requestBody || '// No request body transmitted for this method'}
                </pre>
              </div>
            )}

            {activeDetailTab === 'response' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>
                    RESPONSE BODY
                  </span>
                  {selectedTx.responseBody && (
                    <button
                      onClick={() => handleCopy(selectedTx.responseBody!, 'resp')}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent-cyan)',
                        cursor: 'pointer',
                        fontSize: '11px'
                      }}
                    >
                      {copiedKey === 'resp' ? <Check size={12} /> : <Copy size={12} />}
                      {copiedKey === 'resp' ? 'Copied' : 'Copy Response'}
                    </button>
                  )}
                </div>
                <pre style={{
                  background: 'var(--bg-surface)',
                  padding: '10px',
                  borderRadius: '6px',
                  color: 'var(--accent-cyan)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap'
                }}>
                  {selectedTx.responseBody || '// No response payload available'}
                </pre>
              </div>
            )}

            {activeDetailTab === 'timing' && (() => {
              const t = timingPhases(selectedTx);
              const total = t?.total || (selectedTx.endTime && selectedTx.startTime ? selectedTx.endTime - selectedTx.startTime : 0);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                    TIMING{total ? `: ${Math.round(total)} ms in total` : ''}
                  </div>
                  {!t ? (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      The browser reported no phases for this request (it came from the cache, or has no network step).
                    </div>
                  ) : (
                    <div style={{ background: 'var(--bg-surface)', padding: 10, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {t.phases.map(p => (
                        <div key={p.label} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 70px', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <span>{p.label}</span>
                          <span style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--bg-tertiary)' }}>
                            <span style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: 4, background: 'var(--accent)',
                              left: `${(p.start / t.total) * 100}%`, width: `${Math.max((p.duration / t.total) * 100, 1)}%` }} />
                          </span>
                          <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.duration.toFixed(p.duration < 10 ? 1 : 0)} ms</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
