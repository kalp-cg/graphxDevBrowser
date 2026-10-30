import React, { useEffect, useState } from 'react';
import { Check, FlaskConical, GitCompareArrows, Loader2, Network, ShieldAlert, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { NetworkTransaction } from '../../../shared/domain/network';
import { alertmanagerReceiver, otelCollectorConfig, type SandboxAction, type SandboxState, type SentinelResolution } from '../../../shared/domain/sentinel';

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
      {run.rootCauses.length > 1 ? (
        <div style={{ marginBottom: '8px' }}>
          {run.rootCauses.length} separate failures:{' '}
          {run.rootCauses.map((c, i) => (
            <React.Fragment key={c}>{i > 0 && ', '}<strong style={{ color: 'var(--text-primary)' }}>{c}</strong></React.Fragment>
          ))}
        </div>
      ) : run.rootCause && (
        <div style={{ marginBottom: '8px' }}>
          Root cause: <strong style={{ color: 'var(--text-primary)' }}>{run.rootCause}</strong>
        </div>
      )}
      {run.confidence && (
        <div aria-label="Confidence" style={{ marginBottom: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          Confidence:{' '}
          <strong style={{ color: run.confidence === 'high' ? 'var(--accent)' : run.confidence === 'medium' ? 'var(--warn)' : 'var(--danger)' }}>
            {run.confidence}
          </strong>
          {run.confidenceReason ? `: ${run.confidenceReason}.` : ''}
        </div>
      )}
      {run.phase === 'failed' && <div style={{ color: 'var(--accent-rose)' }}>{run.report}</div>}
      {run.phase === 'done' && !run.rootCause && run.report && (
        <div style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>{run.report.replace(/\*\*/g, '')}</div>
      )}
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

const RISK_TONE: Record<string, string> = { none: 'var(--text-muted)', low: 'var(--accent)', medium: 'var(--warn)', high: 'var(--danger)' };

/** What the uncommitted changes touch: the services they live in, and everything that depends on them. */
export const ImpactPanel: React.FC<{ onSelect: (service: string) => void }> = ({ onSelect }) => {
  const impact = useAppStore(s => s.sentinelImpact);
  const clear = useAppStore(s => s.clearImpact);
  if (!impact || !impact.changed.length) return null;
  const pill = (name: string, tier: string) => (
    <button key={name} onClick={() => onSelect(name)} title={`${tier} tier`}
      style={{ border: '1px solid var(--border-medium)', borderRadius: 5, background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
        padding: '1px 7px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>{name}</button>
  );
  return (
    <div style={card} aria-label="Impact of your changes">
      <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
        <GitCompareArrows size={12} /> YOUR CHANGES
        <span style={{ marginLeft: 'auto', color: RISK_TONE[impact.risk], fontWeight: 700 }}>{impact.risk.toUpperCase()} RISK</span>
        <button className="icon-btn" aria-label="Clear" onClick={clear} style={{ width: 20, height: 20 }}><X size={12} /></button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
        {impact.changed.length} service{impact.changed.length === 1 ? '' : 's'} changed ({impact.files} file{impact.files === 1 ? '' : 's'});
        {' '}{impact.affected.length} more depend on {impact.changed.length === 1 ? 'it' : 'them'}, of {impact.services_total} mapped.
        {' '}{impact.risk_reason.charAt(0).toUpperCase() + impact.risk_reason.slice(1)}. <em>The level is a heuristic.</em>
      </div>
      <div className="section-label">Changed</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 8px' }}>{impact.changed.map(c => pill(c.name, c.tier))}</div>
      {impact.affected.length > 0 && (
        <>
          <div className="section-label">Could be affected</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {impact.affected.slice(0, 16).map(a => pill(a.name, a.tier))}
            {impact.affected.length > 16 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{impact.affected.length - 16} more</span>}
          </div>
        </>
      )}
    </div>
  );
};

/** How to feed the map real traffic: the collector and alert configuration for the connected server, ready to paste. */
export const LiveDataPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const url = useAppStore(s => s.sentinelUrl);
  const addToast = useAppStore(s => s.addToast);
  const [which, setWhich] = useState<'traces' | 'alerts'>('traces');
  const text = which === 'traces' ? otelCollectorConfig(url) : alertmanagerReceiver(url);
  return (
    <div style={card} aria-label="Live data setup">
      <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Network size={12} /> LIVE DATA
        <button className="icon-btn" aria-label="Close" onClick={onClose} style={{ marginLeft: 'auto', width: 20, height: 20 }}><X size={12} /></button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
        The map starts from what your code declares. To see what really happens and what is failing, send it traces
        (or alerts). Paste this where your collector runs; each service's <code>service.name</code> must match the map.
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['traces', 'alerts'] as const).map(w => (
          <button key={w} className={`btn${which === w ? ' primary' : ''}`} style={{ height: 24, fontSize: 11 }} onClick={() => setWhich(w)}>
            {w === 'traces' ? 'OpenTelemetry traces' : 'Alertmanager alerts'}
          </button>
        ))}
        <button className="btn" style={{ height: 24, fontSize: 11, marginLeft: 'auto' }}
          onClick={() => { void navigator.clipboard.writeText(text); addToast({ type: 'info', title: 'Copied' }); }}>Copy</button>
      </div>
      <pre aria-label="Configuration" style={{ margin: 0, padding: 8, borderRadius: 6, background: 'var(--bg-tertiary)', fontSize: 10.5, lineHeight: 1.45,
        fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto' }}>{text}</pre>
    </div>
  );
};

const OUTCOME_TONE: Record<string, string> = { correct: 'var(--accent)', 'false-alarm': 'var(--danger)', timeout: 'var(--warn)' };

/** A 38-service company to try the product on, and an exam: we break things, the agent says what is wrong, we score it. */
export const SandboxPanel: React.FC<{ onClose: () => void; onChanged: () => void }> = ({ onClose, onChanged }) => {
  const addToast = useAppStore(s => s.addToast);
  const [state, setState] = useState<SandboxState | null>(null);
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const call = async (args: SandboxAction) => window.devBrowserAPI!.sentinel.sandbox(args);
  const poll = async () => { try { setState(await call({ action: 'state' }) as SandboxState); } catch { /* server away: keep what we show */ } };
  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), 2000);
    return () => clearInterval(t);
  }, []);
  const run = async (fn: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try { await fn(); await poll(); onChanged(); }
    catch (err) { addToast({ type: 'warning', title: failed, message: err instanceof Error ? err.message.replace(/^SentinelGraph [A-Z]+ \S+: HTTP \d+ /, '') : String(err) }); }
    finally { setBusy(false); }
  };
  const exam = state?.exam;
  const running = exam?.status === 'starting' || exam?.status === 'running';
  const c = state?.company;
  const sum = exam?.summary;
  return (
    <div style={card} aria-label="Sandbox test">
      <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
        <FlaskConical size={12} /> SANDBOX
        <button className="icon-btn" aria-label="Close" onClick={onClose} style={{ marginLeft: 'auto', width: 20, height: 20 }}><X size={12} /></button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
        A made-up company to try this on. We break things in it on purpose, ask the agent what is wrong, and score the answer
        against what we broke. <strong>This replaces the current map</strong>; scan your codebase again to get yours back.
      </div>
      <button className="btn" disabled={busy || running || state?.running} onClick={() => void run(() => call({ action: 'load' }), 'Could not load the sandbox')}>
        {busy && !running ? <Loader2 size={12} /> : <FlaskConical size={12} />} {state?.loaded ? 'Reload sandbox' : 'Load sandbox'}
      </button>
      {state?.loaded && c && (
        <div aria-label="Sandbox company" style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '8px 0', lineHeight: 1.6 }}>
          {c.services} services, {c.databases} databases, {c.teams} teams, {c.engineers} engineers, {c.deployments} deployments,
          {' '}{c.dependencies} dependencies, {c.past_incidents} past incidents.
        </div>
      )}
      {state?.loaded && (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <select aria-label="Who investigates" value={provider} onChange={e => setProvider(e.target.value)} disabled={running}
              style={{ flex: 1, minWidth: 0, height: 26, fontSize: 11.5 }}>
              <option value="">Default agent</option>
              {state.providers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {running
              ? <button className="btn danger" onClick={() => void run(() => call({ action: 'cancel' }), 'Could not stop the test')}>Stop</button>
              : <button className="btn primary" disabled={busy || state.running}
                  onClick={() => void run(() => call({ action: 'test', provider: provider || undefined, cases: 12 }), 'Could not start the test')}>Run test</button>}
          </div>
          {exam && exam.status !== 'idle' && (
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6 }} aria-label="Test progress">
              {exam.provider ? `${exam.provider} · ` : ''}{exam.done} of {exam.total} cases
              {running && exam.current ? ` · now: ${exam.current.title}` : ''}{exam.status === 'cancelled' ? ' · stopped' : ''}
              {exam.error ? ` · ${exam.error}` : ''}
            </div>
          )}
          {sum && (
            <div aria-label="Test result" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              {sum.correct} of {sum.cases} correct
              {sum.fell_back_to_builtin > 0 && (
                <span style={{ fontWeight: 400, color: 'var(--warn)' }}>
                  {' '}· the chosen model could not answer {sum.fell_back_to_builtin}; the built-in agent did. Only its {sum.answered_by_chosen} count as its score
                  {sum.accuracy_of_chosen != null ? ` (${Math.round(sum.accuracy_of_chosen * 100)}%)` : ''}.
                </span>
              )}
            </div>
          )}
          {exam?.results.map(r => (
            <div key={r.id} style={{ fontSize: 11.5, padding: '4px 0', borderTop: '1px solid var(--border-subtle)' }} title={r.why}>
              <span style={{ color: OUTCOME_TONE[r.outcome] ?? 'var(--danger)', fontWeight: 700 }}>{r.correct ? 'FOUND' : r.outcome.toUpperCase()}</span>
              {' '}{r.title}
              <div style={{ color: 'var(--text-muted)' }}>
                {r.expected.length ? `broke ${r.expected.join(', ')} · said ${r.found.join(', ') || 'nothing'}` : r.why} · {r.seconds}s
                {r.fallback ? ' · built-in agent' : ''}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
            The cases are synthetic. A pass here shows the agent works on this kind of failure, not that it will on yours.
          </div>
        </>
      )}
    </div>
  );
};
