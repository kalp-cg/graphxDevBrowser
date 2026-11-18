import React, { useEffect, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, FolderGit2, GitCompareArrows, Loader2, Share2, ShieldAlert } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { SentinelNode } from '../../../shared/domain/sentinel';

const REFRESH_MS = 5000;

function ago(at: number | undefined, now: number): string {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/**
 * The first thing to look at: what this system is, whether it is healthy, what changed, and the one action that
 * matters right now. Every number is read from the live graph; the sample company is labelled as demo data.
 */
export const OverviewView: React.FC = () => {
  const status = useAppStore(s => s.sentinelStatus);
  const message = useAppStore(s => s.sentinelMessage);
  const snapshot = useAppStore(s => s.sentinelSnapshot);
  const project = useAppStore(s => s.sentinelProject);
  const refresh = useAppStore(s => s.refreshSentinelGraph);
  const run = useAppStore(s => s.sentinelRun);
  const investigate = useAppStore(s => s.startSentinelInvestigation);
  const connectCodebase = useAppStore(s => s.connectCodebase);
  const checkImpact = useAppStore(s => s.checkImpact);
  const setActiveView = useAppStore(s => s.setActiveView);

  useEffect(() => {
    if (status !== 'connected') return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [status, refresh]);

  const now = Date.now();
  const data = useMemo(() => {
    const nodes = snapshot?.nodes ?? [];
    const links = snapshot?.links ?? [];
    const byId = new Map(nodes.map(n => [n.id, n]));
    const target = (src: string, type: string) => {
      const l = links.find(x => x.source === src && x.type === type);
      return l ? byId.get(l.target) : undefined;
    };
    const services = nodes.filter(n => n.type === 'Service');
    const databases = nodes.filter(n => n.type === 'Database');
    const unhealthy = [...services, ...databases].filter(n => n.status && n.status !== 'healthy');
    const alerts = nodes.filter(n => n.type === 'Alert' && n.status !== 'resolved')
      .map(a => ({ alert: a, service: target(a.id, 'FIRED_ON') }));
    const changes = nodes.filter(n => n.type === 'Deployment').sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 6)
      .map(d => ({ deploy: d, service: target(d.id, 'DEPLOYED_TO') }));
    const critical = [...services].sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0)).slice(0, 5);
    const pending = nodes.filter(n => n.type === 'Action' && n.status === 'pending');
    return {
      services, databases, unhealthy, alerts, changes, critical, pending,
      dependencies: links.filter(l => l.type === 'DEPENDS_ON').length,
      teams: nodes.filter(n => n.type === 'Team').length,
      incidents: nodes.filter(n => n.type === 'Incident').length
    };
  }, [snapshot]);

  if (status !== 'connected') {
    return (
      <div className="page"><div className="page-inner" style={{ maxWidth: 560, paddingTop: '8vh' }}>
        {status === 'connecting' ? (
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <Loader2 size={16} className="animate-spin" /> Starting SentinelGraph…
          </p>
        ) : (
          <>
            <h1>Map your system</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 14 }}>
              SentinelGraph reads your codebase and the traffic you browse, builds a map of your services, and finds the
              cause when something breaks. It is not connected right now ({message}). Browsing works as usual without it.
            </p>
            <div><button className="btn primary" onClick={() => setActiveView('settings')}>Connect SentinelGraph</button></div>
          </>
        )}
      </div></div>
    );
  }

  const openMap = () => setActiveView('dependencies');
  const alerting = [...new Set(data.alerts.map(a => a.service?.name ?? a.service?.label).filter(Boolean))] as string[];

  return (
    <div className="page">
      <div className="page-inner">
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1>{project ?? 'Sample company'}</h1>
            <p style={{ marginTop: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
              {project
                ? `${data.services.length} services mapped from your repository and the traffic you browse.`
                : <><span className="tag warn" style={{ marginRight: 8 }}>Demo data</span>A {data.services.length}-service sample shop to try everything on. Connect your codebase to map your own system.</>}
            </p>
          </div>
          <button className="btn" onClick={() => void connectCodebase()}><FolderGit2 size={13} /> {project ? 'Rescan codebase' : 'Connect codebase…'}</button>
          <button className="btn" onClick={openMap}><Share2 size={13} /> Open system map</button>
        </header>

        <Banner>
          {run.phase === 'running' ? (
            <StatusLine tone="accent" icon={<Loader2 size={18} className="animate-spin" />}
              title="Investigating…"
              body={run.steps.length ? `Step ${run.steps.length}: ${run.steps[run.steps.length - 1]!.summary}` : 'Reading the alerts from the graph.'}
              action={<button className="btn primary" onClick={openMap}>Watch on the map</button>} />
          ) : run.phase === 'done' && run.rootCause ? (
            <StatusLine tone="danger" icon={<ShieldAlert size={18} />}
              title={`Root cause: ${run.rootCause}`}
              body={[run.confidence && `Confidence ${run.confidence}${run.confidenceReason ? `: ${run.confidenceReason}` : ''}`,
                run.seconds !== null && `found in ${run.seconds.toFixed(1)} s`].filter(Boolean).join(' · ')}
              action={<button className="btn primary" onClick={openMap}>
                Review {run.proposed.length ? `${run.proposed.length} proposed fix${run.proposed.length === 1 ? '' : 'es'}` : 'the report'}
              </button>} />
          ) : data.alerts.length ? (
            <StatusLine tone="danger" icon={<AlertTriangle size={18} />}
              title={`${data.alerts.length} alert${data.alerts.length === 1 ? '' : 's'} firing${alerting.length ? ` on ${alerting.join(', ')}` : ''}`}
              body={`${data.unhealthy.length} service${data.unhealthy.length === 1 ? ' is' : 's are'} unhealthy. SentinelGraph walks the dependency graph to the shared cause and the change behind it.`}
              action={<button className="btn highlight" onClick={() => { void investigate(); openMap(); }}>Investigate</button>} />
          ) : (
            <StatusLine tone="ok" icon={<CheckCircle2 size={18} />}
              title={`All ${data.services.length} services healthy`}
              body="Before you merge, check which services your uncommitted changes touch and what depends on them."
              action={<button className="btn" onClick={() => { void checkImpact(); openMap(); }}><GitCompareArrows size={13} /> Check my changes</button>} />
          )}
        </Banner>

        <section aria-label="Summary" className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <Stat label="Services" value={data.services.length} />
          <Stat label="Dependencies" value={data.dependencies} />
          <Stat label="Databases" value={data.databases.length} />
          <Stat label="Teams" value={data.teams} />
          <Stat label="Past incidents learned" value={data.incidents} />
        </section>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
          <List title="Active alerts" empty="No alert is firing.">
            {data.alerts.map(({ alert, service }) => (
              <div key={alert.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--danger)', flexShrink: 0, alignSelf: 'center' }} />
                <strong style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{service?.name ?? service?.label ?? 'unknown service'}</strong>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}>{ago(alert.at, now)}</span>
                <span className="mono muted" style={{ flexBasis: '100%', paddingLeft: 17 }}>
                  {(alert.metric ?? '').replace(/_/g, ' ')} {alert.value?.toLocaleString()} (limit {alert.threshold?.toLocaleString()})
                </span>
              </div>
            ))}
          </List>
          <List title="Waiting for your approval" hint="The agent only proposes. Nothing runs until a person approves it." empty="Nothing to approve.">
            {data.pending.map(a => (
              <button key={a.id} className="list-row" onClick={openMap} style={{ flexWrap: 'wrap' }}>
                <strong style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{actionTitle(a)}</strong>
                {a.risk && <span className={`tag${a.risk === 'high' ? ' danger' : a.risk === 'medium' ? ' warn' : ''}`}>{a.risk} risk</span>}
                <span className="muted" style={{ flexBasis: '100%', fontSize: 12, lineHeight: 1.45 }}>{a.reason}</span>
              </button>
            ))}
          </List>
          <List title="Recent changes" empty="No deploy recorded yet. Changes come from git history and your deploy pipeline.">
            {data.changes.map(({ deploy, service }) => (
              <div key={deploy.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                <strong style={{ fontWeight: 600 }}>{service?.name ?? deploy.label}</strong>
                <span className="tag">{deploy.version}</span>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}>{ago(deploy.at, now)}</span>
                {deploy.change_summary && <span style={{ flexBasis: '100%', fontSize: 12.5, color: 'var(--text-secondary)' }}>{deploy.change_summary}</span>}
              </div>
            ))}
          </List>
          <List title="Most critical services" hint="Ranked by PageRank on the dependency graph: what the most traffic depends on" empty="No services yet.">
            {data.critical.map((s, i) => (
              <div key={s.id} className="list-row">
                <span className="mono muted" style={{ width: 14 }}>{i + 1}</span>
                <strong style={{ fontWeight: 600 }}>{s.name ?? s.label}</strong>
                <Health node={s} />
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{s.team ?? ''}</span>
              </div>
            ))}
          </List>
        </div>
      </div>
    </div>
  );
};

const ACTIONS: Record<string, string> = { rollback: 'Roll back', scale_up: 'Scale up', page_oncall: 'Page on-call for', restart: 'Restart' };
function actionTitle(a: SentinelNode): string {
  const [kind = '', ...rest] = a.label.split(' ');
  return `${ACTIONS[kind] ?? kind.replace(/_/g, ' ')} ${rest.join(' ')}`;
}

const Banner: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <section aria-label="Status" className="card" style={{ padding: '14px 16px' }}>{children}</section>
);

const StatusLine: React.FC<{ tone: 'ok' | 'danger' | 'accent'; icon: React.ReactNode; title: string; body: string; action: React.ReactNode }> =
  ({ tone, icon, title, body, action }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <span style={{ color: tone === 'danger' ? 'var(--danger)' : 'var(--accent)', display: 'flex' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        {body && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>{body}</div>}
      </div>
      {action}
    </div>
  );

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border-subtle)' }}>
    <div style={{ fontSize: 22, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
  </div>
);

const List: React.FC<{ title: string; hint?: string; empty: string; children: React.ReactNode[] }> = ({ title, hint, empty, children }) => (
  <section className="card" aria-label={title}>
    <div className="card-head" title={hint}><h2>{title}</h2>{children.length > 0 && <span className="muted" style={{ fontSize: 12 }}>{children.length}</span>}</div>
    {children.length ? children : <p className="muted" style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.5 }}>{empty}</p>}
  </section>
);

const Health: React.FC<{ node: SentinelNode }> = ({ node }) =>
  node.status && node.status !== 'healthy'
    ? <span className={`tag ${node.status === 'down' ? 'danger' : 'warn'}`}>{node.status}</span>
    : null;
