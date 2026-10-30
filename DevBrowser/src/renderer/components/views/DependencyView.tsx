import React, { useEffect, useMemo, useState } from 'react';
import { Crosshair, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { InvestigationPanel } from '../common/SentinelPanels';
import { GraphCanvas, type GraphHighlight } from '../graph/GraphCanvas';
import type { SentinelNode } from '../../../shared/domain/sentinel';

const REFRESH_MS = 5000;
const EMPTY = new Set<string>();

/**
 * SentinelGraph inside DevBrowser: the same live graph as the dashboard (services sized by PageRank, failures
 * in colour, the agent's path lit up), next to the page being debugged.
 */
export const DependencyView: React.FC = () => {
  const status = useAppStore(s => s.sentinelStatus);
  const snapshot = useAppStore(s => s.sentinelSnapshot);
  const refresh = useAppStore(s => s.refreshSentinelGraph);
  const run = useAppStore(s => s.sentinelRun);
  const blast = useAppStore(s => s.blastRadius);
  const computeBlast = useAppStore(s => s.calculateBlastRadiusForNode);
  const investigate = useAppStore(s => s.startSentinelInvestigation);
  const setActiveView = useAppStore(s => s.setActiveView);
  const theme = useAppStore(s => s.theme);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [fitKey, setFitKey] = useState(0);

  // Live while the panel is open (the dashboard streams over a WebSocket; this polls).
  useEffect(() => {
    if (status !== 'connected') return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [status, refresh]);

  const nodes = snapshot?.nodes ?? [];
  const services = nodes.filter(n => n.type === 'Service');
  const unhealthy = services.filter(n => n.status && n.status !== 'healthy');
  const alerts = nodes.filter(n => n.type === 'Alert').length;
  const selected = nodes.find(n => n.id === selectedId) ?? null;

  // The agent's path while a run is on screen; otherwise the blast radius of the selected service.
  const highlight: GraphHighlight = useMemo(() => {
    if (run.phase !== 'idle' && run.path.nodes.length) {
      return { tone: 'accent', nodes: new Set(run.path.nodes), edges: new Set(run.path.edges),
        currentNodes: new Set(run.path.currentNodes), currentEdges: new Set(run.path.currentEdges) };
    }
    if (blast && blast.rootNodeId === selectedId) {
      const ids = new Set([blast.rootNodeId, ...blast.affectedNodes.map(n => n.id)]);
      const edges = new Set((snapshot?.links ?? [])
        .filter(l => l.type === 'DEPENDS_ON' && ids.has(l.source) && ids.has(l.target)).map(l => l.id));
      return { tone: 'danger', nodes: ids, edges, currentNodes: new Set([blast.rootNodeId]), currentEdges: EMPTY };
    }
    return { tone: 'accent', nodes: EMPTY, edges: EMPTY, currentNodes: EMPTY, currentEdges: EMPTY };
  }, [run, blast, selectedId, snapshot]);

  if (status !== 'connected') {
    return (
      <Empty title="SentinelGraph is not connected"
        body="Connect to a SentinelGraph API to see your services, their health and dependencies, and to investigate failures. To try it locally, run python sandbox/run.py up and connect to http://localhost:8200.">
        <button className="btn primary" onClick={() => setActiveView('settings')}>Connect in Settings</button>
      </Empty>
    );
  }
  if (snapshot && !services.length) {
    return (
      <Empty title="No services in the graph yet"
        body="Scan your repository (python -m sentinel.ingest codebase .), point an OpenTelemetry Collector at /v1/traces, or browse your app here: its API calls are added as dependencies." />
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 12px', minHeight: 40,
        borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{services.length} services</span>
        {unhealthy.length > 0 ? (
          <span className="tag danger">{unhealthy.length} unhealthy</span>
        ) : (
          <span className="tag">all healthy</span>
        )}
        {alerts > 0 && <span className="tag warn">{alerts} alerts</span>}
        <div style={{ flex: 1 }} />
        <label title="Also show deploys, commits, people and incidents"
          style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showContext} onChange={e => setShowContext(e.target.checked)} />
          Context
        </label>
        <button className="icon-btn" title="Fit to view" aria-label="Fit graph to view" onClick={() => setFitKey(k => k + 1)}>
          <Crosshair size={15} />
        </button>
        <button className="icon-btn" title="Refresh" aria-label="Refresh graph" onClick={() => void refresh()}>
          <RefreshCw size={14} />
        </button>
        <button className={`btn${alerts ? ' danger' : ''}`} disabled={run.phase === 'running'}
          onClick={() => void investigate()}>
          <ShieldAlert size={13} />
          {run.phase === 'running' ? 'Investigating...' : 'Investigate'}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', background: 'var(--bg-primary)' }}>
          {snapshot && (
            <GraphCanvas nodes={snapshot.nodes} links={snapshot.links} highlight={highlight} showContext={showContext}
              selected={selectedId} onSelect={n => setSelectedId(n?.id ?? null)} fitKey={fitKey} theme={theme} />
          )}
          <Legend />
        </div>
        {(selected || run.phase !== 'idle') && (
          <aside style={{ width: 280, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
            padding: 12, borderLeft: '1px solid var(--border-subtle)' }}>
            <InvestigationPanel />
            {selected && (
              <Inspector node={selected} blastCount={blast?.rootNodeId === selected.id ? blast.affectedNodes.length : null}
                onBlast={() => computeBlast(selected.id)}
                onInvestigate={() => void investigate(
                  `${selected.name ?? selected.label} is failing. Find the root cause and propose a fix.`)}
                running={run.phase === 'running'} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
};

const Inspector: React.FC<{ node: SentinelNode; blastCount: number | null; onBlast: () => void; onInvestigate: () => void;
  running: boolean }> = ({ node, blastCount, onBlast, onInvestigate, running }) => {
  const rows: [string, React.ReactNode][] = [
    ['Type', node.type],
    ['Status', node.status ? <span className={`tag${node.status === 'down' ? ' danger' : node.status === 'degraded' ? ' warn' : ''}`}>{node.status}</span> : null],
    ['Tier', node.tier],
    ['Layer', node.layer],
    ['Team', node.team],
    ['PageRank', node.pagerank?.toFixed(3)],
    ['Betweenness', node.betweenness?.toFixed(1)],
    ['Version', node.version],
    ['Change', node.change_summary ?? (node.type === 'Commit' ? node.message : undefined)],
    ['Metric', node.metric ? `${node.metric} = ${node.value} (threshold ${node.threshold})` : undefined]
  ];
  const isService = node.type === 'Service';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div className="section-label">Selected</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4, wordBreak: 'break-word' }}>{node.label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{node.id}</div>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12, margin: 0 }}>
        {rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
          <React.Fragment key={k}>
            <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
            <dd style={{ margin: 0, color: 'var(--text-primary)', minWidth: 0, wordBreak: 'break-word' }}>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      {isService && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="btn" onClick={onBlast}>Show blast radius</button>
          {blastCount !== null && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {blastCount === 0 ? 'Nothing depends on it.' : `${blastCount} service${blastCount === 1 ? '' : 's'} break if it fails (in red).`}
            </div>
          )}
          <button className="btn" disabled={running} onClick={onInvestigate}>Investigate this service</button>
        </div>
      )}
    </div>
  );
};

const Legend: React.FC = () => (
  <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap', padding: '6px 10px',
    fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
    borderRadius: 6, pointerEvents: 'none' }}>
    <Key color="var(--text-muted)" label="healthy" />
    <Key color="var(--warn)" label="degraded" />
    <Key color="var(--danger)" label="down" />
    <Key color="var(--accent)" label="agent path" />
    <span>size = PageRank</span>
  </div>
);

const Key: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
    <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
    {label}
  </span>
);

const Empty: React.FC<{ title: string; body: string; children?: React.ReactNode }> = ({ title, body, children }) => (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h3>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{body}</p>
      {children && <div>{children}</div>}
    </div>
  </div>
);
