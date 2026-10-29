import React, { useState } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Download, 
  Trash2, 
  Check, 
  Copy 
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';

export const SecurityView: React.FC = () => {
  const findings = useAppStore(s => s.findings);
  const selectedFindingId = useAppStore(s => s.selectedFindingId);
  const setSelectedFindingId = useAppStore(s => s.setSelectedFindingId);
  const securitySeverityFilter = useAppStore(s => s.securitySeverityFilter);
  const setSecuritySeverityFilter = useAppStore(s => s.setSecuritySeverityFilter);
  const dismissFinding = useAppStore(s => s.dismissFinding);
  const addToast = useAppStore(s => s.addToast);

  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const filteredFindings = findings.filter(f => {
    if (securitySeverityFilter === 'all') return true;
    return f.severity === securitySeverityFilter;
  });

  const selectedFinding = findings.find(f => f.id === selectedFindingId) || filteredFindings[0];

  const handleExportSarif = () => {
    const sarif = {
      version: '2.1.0',
      $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json',
      runs: [{
        tool: {
          driver: {
            name: 'Dev Browser Passive Security Auditor',
            version: '1.0.0',
            rules: findings.map(f => ({
              id: f.ruleId,
              name: f.title,
              shortDescription: { text: f.description },
              helpUri: `https://cwe.mitre.org/data/definitions/${f.cwe}.html`
            }))
          }
        },
        results: findings.map(f => ({
          ruleId: f.ruleId,
          level: f.severity === 'HIGH' || f.severity === 'CRITICAL' ? 'error' : 'warning',
          message: { text: f.description },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: f.evidence.url }
            }
          }]
        }))
      }]
    };

    const blob = new Blob([JSON.stringify(sarif, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devbrowser-security-sarif-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    addToast({
      type: 'success',
      title: 'SARIF Report Exported',
      message: 'Ready for GitHub Code Scanning / CI import'
    });
  };

  const handleCopyRemediation = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 1500);
    addToast({ type: 'info', title: 'Remediation Snippet Copied' });
  };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      {/* Left Findings List Panel */}
      <div style={{
        width: '380px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0
      }}>
        {/* Sub-header Filter */}
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldAlert size={16} color="#ef4444" />
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Passive Security Findings
              </span>
            </div>

            <Badge label="Zero Synthetic Traffic" variant="success" />
          </div>

          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '2px' }}>
            {['all', 'HIGH', 'MEDIUM', 'LOW'].map(lvl => (
              <button
                key={lvl}
                onClick={() => setSecuritySeverityFilter(lvl)}
                style={{
                  flex: 1,
                  background: securitySeverityFilter === lvl ? 'var(--bg-surface)' : 'transparent',
                  color: securitySeverityFilter === lvl ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: 'none',
                  padding: '3px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        {/* Findings List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {filteredFindings.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={32} color="var(--accent-emerald)" />}
              title="No Security Findings Detected"
              description="All evaluated HTTP response headers, cookie flags, and DOM sinks satisfy active OWASP passive audit rules."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredFindings.map(f => {
                const isSelected = f.id === selectedFinding?.id;
                return (
                  <div
                    key={f.id}
                    onClick={() => setSelectedFindingId(f.id)}
                    style={{
                      background: isSelected ? 'var(--bg-active)' : 'var(--bg-surface)',
                      borderLeft: `4px solid ${f.severity === 'HIGH' ? '#ef4444' : 'var(--accent-amber)'}`,
                      borderRadius: '6px',
                      padding: '10px 12px',
                      cursor: 'pointer'
                    }}
                    className="transition-smooth hover:bg-slate-800"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <Badge
                        label={f.severity}
                        variant={f.severity === 'HIGH' ? 'danger' : 'warning'}
                        size="sm"
                      />
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {f.ruleId}
                      </span>
                    </div>

                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                      {f.title}
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.evidence.url}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom SARIF Export Bar */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button
            onClick={handleExportSarif}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            className="transition-smooth hover:bg-slate-800"
          >
            <Download size={13} />
            Export Audit Report (SARIF v2.1.0)
          </button>
        </div>
      </div>

      {/* Right Detailed Finding Inspector */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '20px' }}>
        {selectedFinding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '750px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Badge label={selectedFinding.severity} variant={selectedFinding.severity === 'HIGH' ? 'danger' : 'warning'} />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    [{selectedFinding.ruleId}]
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--accent-indigo)' }}>
                    {selectedFinding.owaspCategory}
                  </span>
                </div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {selectedFinding.title}
                </h2>
              </div>

              <button
                onClick={() => dismissFinding(selectedFinding.id)}
                title="Suppress Finding"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  borderRadius: '5px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                <Trash2 size={12} />
                Dismiss
              </button>
            </div>

            {/* Description */}
            <div style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              borderRadius: '8px',
              padding: '14px',
              lineHeight: 1.5,
              fontSize: '13px',
              color: 'var(--text-secondary)'
            }}>
              {selectedFinding.description}
            </div>

            {/* Evidence Card */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
                IMMUTABLE RAW EVIDENCE (CDP CAPTURED)
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px'
              }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Target: <span style={{ color: 'var(--text-primary)' }}>{selectedFinding.evidence.url}</span>
                </div>
                <pre style={{
                  color: 'var(--accent-amber)',
                  background: 'var(--bg-primary)',
                  padding: '8px',
                  borderRadius: '4px',
                  overflowX: 'auto'
                }}>
                  {selectedFinding.evidence.rawSnippet || 'No raw snippet attached.'}
                </pre>
              </div>
            </div>

            {/* Remediation Patch */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
                  RECOMMENDED REMEDIATION
                </span>
                <button
                  onClick={() => handleCopyRemediation(selectedFinding.remediation)}
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
                  {copiedSnippet ? <Check size={12} /> : <Copy size={12} />}
                  {copiedSnippet ? 'Copied' : 'Copy Remediation'}
                </button>
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '13px',
                color: 'var(--text-primary)',
                lineHeight: 1.5
              }}>
                {selectedFinding.remediation}
              </div>
            </div>

            {/* Reference */}
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              CWE Reference: <a
                href={`https://cwe.mitre.org/data/definitions/${selectedFinding.cwe}.html`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}
              >
                CWE-{selectedFinding.cwe}
              </a>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<ShieldCheck size={36} color="var(--accent-emerald)" />}
            title="Select a Finding"
            description="Select any finding from the list on the left to inspect raw evidence and remediation configuration snippets."
          />
        )}
      </div>
    </div>
  );
};
