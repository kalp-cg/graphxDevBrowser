import React, { useEffect, useState } from 'react';
import { Check, Loader2, Network, ShieldAlert, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { NetworkTransaction } from '../../../shared/domain/network';
import type { SentinelResolution } from '../../../shared/domain/sentinel';

const card: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-secondary)',
  borderRadius: '6px',
  padding: '10px 12px',
  fontFamily: 'var(--font-sans)',
  fontSize: '12px',
  color: 'var(--text-secondary)'
};
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' };
const statusColor = (s?: string) =>
  s === 'down' ? 'var(--accent-rose)' : s === 'degraded' ? 'var(--accent-amber)' : 'var(--accent-emerald)';

const button = (tone: 'danger' | 'ok' | 'plain'): string => `btn${tone === 'danger' ? ' danger' : tone === 'ok' ? ' primary' : ''}`;

/** What SentinelGraph knows about the service a captured request went to, and a way to investigate it. */
export const ServiceContextCard: React.FC<{ tx: NetworkTransaction }> = ({ tx }) => {
  const sentinelStatus = useAppStore(s => s.sentinelStatus);
  const resolveSentinelUrl = useAppStore(s => s.resolveSentinelUrl);
  const startSentinelInvestigation = useAppStore(s => s.startSentinelInvestigation);
  const runPhase = useAppStore(s => s.sentinelRun.phase);
  const [info, setInfo] = useState<SentinelResolution | null>(null);

  useEffect(() => {
    let live = true;
    setInfo(null);
    if (sentinelStatus === 'connected') void resolveSentinelUrl(tx.url).then(r => live && setInfo(r));
    return () => { live = false; };
  }, [tx.url, sentinelStatus, resolveSentinelUrl]);

  if (sentinelStatus !== 'connected') return null;
  const failed = !tx.statusCode || tx.statusCode >= 500;

  return (
    <div style={card}>
      <div style={{ ...label, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Network size={12} /> SENTINELGRAPH
      </div>
      {!info && <div>Looking up {tx.url}…</div>}
      {info && !info.known && (
        <div>
          <code>{info.host}</code> is not a service in the graph yet (a third-party API, or a service no scan or
          trace has reported).
        </div>
      )}
      {info?.known && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>{info.service}</strong>
            {' · '}<span style={{ color: statusColor(info.status) }}>{info.status}</span>
            {' · '}{info.tier}
            {info.team && <> · owned by <strong>{info.team}</strong>{info.slack_channel ? ` (${info.slack_channel})` : ''}</>}
          </div>
          {!!info.on_call?.length && <div>On call: {info.on_call.join(', ')}</div>}
          {info.blast_radius && (
            <div>
              If it fails, {info.blast_radius.count} service{info.blast_radius.count === 1 ? '' : 's'} break
              {info.blast_radius.impacted.length ? `: ${info.blast_radius.impacted.join(', ')}` : ''}
            </div>
          )}
          {info.recent_changes?.map(c => (
            <div key={c.uid}>Changed {c.minutes_ago} min ago: {c.version} {c.message ? `"${c.message}"` : ''}{c.author ? ` by ${c.author}` : ''}</div>
          ))}
        </div>
      )}
      {failed && (
        <div style={{ marginTop: '8px' }}>
          <button
            className={button('danger')}
            disabled={runPhase === 'running'}
            onClick={() => void startSentinelInvestigation(undefined, tx)}
            title="Start a SentinelGraph investigation with this failed request as evidence"
          >
            <ShieldAlert size={12} /> {runPhase === 'running' ? 'Investigation running…' : 'Investigate this failure'}
          </button>
        </div>
      )}
    </div>
  );
};

/** The current investigation: live steps, the root cause, and the proposed actions a human approves. */
export const InvestigationPanel: React.FC = () => {
  const run = useAppStore(s => s.sentinelRun);
  const decide = useAppStore(s => s.decideSentinelAction);
  const [busy, setBusy] = useState<string | null>(null);
  if (run.phase === 'idle') return null;

  const act = async (uid: string, approve: boolean) => {
    setBusy(uid);
    await decide(uid, approve);
    setBusy(null);
  };

  return (
    <div style={card}>
      <div style={{ ...label, display: 'flex', alignItems: 'center', gap: '6px' }}>
        {run.phase === 'running' ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
        INVESTIGATION {run.phase === 'running' ? 'RUNNING' : run.phase === 'done' ? `DONE${run.seconds ? ` IN ${run.seconds}s` : ''}` : 'FAILED'}
      </div>
      <ol style={{ margin: '0 0 8px', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.45,
        display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {run.steps.map((s, i) => (
          <li key={i} style={{ color: s.error ? 'var(--accent-rose)' : undefined }}>
            <strong>{s.name}</strong> {s.summary}
          </li>
        ))}
      </ol>
      {run.rootCause && (
        <div style={{ marginBottom: '8px' }}>
          Root cause: <strong style={{ color: 'var(--text-primary)' }}>{run.rootCause}</strong>
        </div>
      )}
      {run.phase === 'failed' && <div style={{ color: 'var(--accent-rose)' }}>{run.report}</div>}
      {run.proposed.map(a => (
        <div key={a.uid} role="group" aria-label={`${a.kind} on ${a.target}`}
          style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 0',
          borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ minWidth: 0 }}>
            <strong>{a.kind}</strong> on {a.target} <span style={{ color: 'var(--text-muted)' }}>({a.risk} risk)</span>
            {a.reason && <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{a.reason}</div>}
            {a.outcome && <div style={{ fontSize: '11px' }}>{a.outcome}</div>}
          </div>
          {a.status === 'pending' ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className={button('ok')} disabled={busy === a.uid} onClick={() => void act(a.uid, true)}>
                <Check size={12} /> Approve
              </button>
              <button className={button('plain')} disabled={busy === a.uid} onClick={() => void act(a.uid, false)}>
                <X size={12} /> Reject
              </button>
            </div>
          ) : (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.status}</span>
          )}
        </div>
      ))}
    </div>
  );
};
