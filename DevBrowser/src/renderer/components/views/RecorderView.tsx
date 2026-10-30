import React, { useMemo, useRef, useState } from 'react';
import { Camera, CircleDot, Download, Globe, Keyboard, MousePointerClick, Play, Square, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { useRecorderStore } from '../../store/useRecorderStore';
import { useAppStore } from '../../store/useAppStore';
import { cancelReplay, startRecording, startReplay, stopRecording } from '../../browser/recorder';
import {
  describeStep, diagnose, fileName, hostOf, isFailedRequest, parseRecording, replayPlan, serializeRecording, summarize,
  type Recording, type RecordedStep, type StepKind
} from '../../../shared/domain/recording';

type Filter = 'all' | 'actions' | 'network' | 'problems';
const ICON: Record<StepKind, React.ReactNode> = {
  navigate: <Globe size={13} />, click: <MousePointerClick size={13} />, input: <Keyboard size={13} />, key: <Keyboard size={13} />,
  scroll: <span style={{ fontSize: 11 }}>↕</span>, console: <span style={{ fontSize: 11 }}>›</span>, error: <TriangleAlert size={13} />,
  request: <span style={{ fontSize: 10, fontWeight: 700 }}>↹</span>, snapshot: <Camera size={13} />
};
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const secs = (ms: number) => `+${(ms / 1000).toFixed(1)}s`;
const isProblem = (s: RecordedStep) => s.kind === 'error' || isFailedRequest(s) || (s.kind === 'console' && s.level === 'error');
const inFilter = (s: RecordedStep, f: Filter) =>
  f === 'all' ? s.kind !== 'scroll' : f === 'actions' ? ['navigate', 'click', 'input', 'key'].includes(s.kind) : f === 'network' ? s.kind === 'request' : isProblem(s);

/** Bug recorder: record what happens in a tab, export it as one file, and replay a file from a teammate. */
export const RecorderView: React.FC = () => {
  const { status, live, startedAt, recordings, selectedId, set } = useRecorderStore();
  const addToast = useAppStore(s => s.addToast);
  const fileInput = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());
  React.useEffect(() => {
    if (status !== 'recording') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [status]);

  const open = async (file: File | undefined) => {
    if (!file) return;
    const result = parseRecording(await file.text());
    if (!result.ok) return void addToast({ type: 'error', title: 'Could not open the recording', message: result.error });
    useRecorderStore.getState().add(result.recording);
    addToast({ type: 'success', title: 'Recording opened', message: result.recording.title });
  };

  return (
    <div role="region" aria-label="Bug Recorder panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {status === 'recording' ? (
            <button className="btn danger" aria-label="Stop recording" onClick={() => void stopRecording()}>
              <Square size={13} fill="currentColor" /> Stop · {clock(now - startedAt)}
            </button>
          ) : (
            <button className="btn primary" aria-label="Start recording" onClick={() => void startRecording()}>
              <CircleDot size={14} /> Record this tab
            </button>
          )}
          <button className="btn" aria-label="Open a recording file" disabled={status === 'recording'} onClick={() => fileInput.current?.click()}>
            <Upload size={13} /> Open file
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Recording file" hidden
            onChange={e => { void open(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {status === 'recording' && (
          <div role="status" aria-label="Recording progress" style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--danger)', fontWeight: 700 }}>● Recording</span>
            <span>{live.actions} actions</span><span>{live.requests} requests</span>
            <span style={{ color: live.errors ? 'var(--danger)' : undefined }}>{live.errors} errors</span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {recordings.length === 0 && status !== 'recording' && (
          <div style={{ padding: 18, fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: 13.5 }}>Make a bug reproducible</strong>
            <span>Load the page where it happens, press <em>Record this tab</em>, do what triggers the bug, and stop. DevBrowser keeps your clicks and typing, every request and response, console errors, and the page itself at the moment it broke.</span>
            <span>Export it as one file. A teammate opens it here and replays it against their own copy of the app, and DevBrowser tells them whether the same error happened.</span>
            <span>Passwords, tokens and cookies are removed before anything is saved.</span>
          </div>
        )}
        {recordings.length > 0 && (
          <ul aria-label="Recordings" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recordings.map(r => {
              const sum = summarize(r), on = r.id === selectedId;
              return (
                <li key={r.id}>
                  <button onClick={() => set({ selectedId: on ? null : r.id })} aria-pressed={on} aria-label={`Recording ${r.title}`}
                    style={{ width: '100%', textAlign: 'left', padding: '9px 12px', border: 0, borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                      background: on ? 'var(--accent-soft)' : 'transparent', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {hostOf(r.startUrl)} · {clock(r.durationMs)} · {sum.actions} actions · {sum.requests} requests
                      {sum.errors + sum.failedRequests > 0 && <span style={{ color: 'var(--danger)' }}> · {sum.errors + sum.failedRequests} problem{sum.errors + sum.failedRequests === 1 ? '' : 's'}</span>}
                    </span>
                  </button>
                  {on && <Detail recording={r} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

const Detail: React.FC<{ recording: Recording }> = ({ recording: r }) => {
  const addToast = useAppStore(s => s.addToast);
  const replay = useRecorderStore(s => s.replay);
  const status = useRecorderStore(s => s.status);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<number | null>(null);
  const [base, setBase] = useState(() => { try { return new URL(r.startUrl).origin; } catch { return ''; } });
  const [speed, setSpeed] = useState(1);
  const diagnosis = useMemo(() => diagnose(r), [r]);
  const plan = useMemo(() => replayPlan(r), [r]);
  const steps = useMemo(() => r.steps.filter(s => inFilter(s, filter)), [r, filter]);
  const mine = replay.recordingId === r.id;
  const running = replay.status === 'running';

  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([serializeRecording(r)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName(r); a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Recording exported', message: `${fileName(r)}${r.redactions ? ` · ${r.redactions} secret${r.redactions === 1 ? '' : 's'} removed` : ''}` });
  };
  const rename = (title: string) =>
    useRecorderStore.setState(s => ({ recordings: s.recordings.map(x => (x.id === r.id ? { ...x, title: title.slice(0, 300) } : x)) }));

  return (
    <div style={{ padding: '10px 12px 14px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
      <input className="field" aria-label="Recording title" value={r.title} onChange={e => rename(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn" aria-label="Export recording" onClick={exportFile}><Download size={13} /> Export file</button>
        <button className="btn" aria-label="Delete recording" disabled={running && mine} onClick={() => useRecorderStore.getState().remove(r.id)}><Trash2 size={13} /> Delete</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
          {r.redactions > 0 ? `${r.redactions} secret${r.redactions === 1 ? '' : 's'} removed` : 'no secrets found'}
        </span>
      </div>

      {diagnosis.firstProblem ? (
        <div role="note" aria-label="What went wrong" style={{ border: '1px solid var(--danger)', borderRadius: 8, padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
          background: 'color-mix(in srgb, var(--danger) 8%, transparent)' }}>
          <strong style={{ color: 'var(--danger)' }}>What went wrong</strong>
          <div>{describeStep(diagnosis.firstProblem)}</div>
          {diagnosis.trigger && <div style={{ color: 'var(--text-secondary)' }}>Right after: {describeStep(diagnosis.trigger)}</div>}
          {diagnosis.problems.length > 1 && <div style={{ color: 'var(--text-muted)' }}>and {diagnosis.problems.length - 1} more problem{diagnosis.problems.length === 2 ? '' : 's'} in the timeline</div>}
        </div>
      ) : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No errors or failing requests were captured in this recording.</div>}

      <section aria-label="Replay" style={{ border: '1px solid var(--border-medium)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="field" aria-label="Replay against" style={{ flex: 1, minWidth: 160 }} value={base} placeholder="http://localhost:3000"
            onChange={e => setBase(e.target.value)} title="Where the app runs on this machine. The recorded address is filled in." />
          <select className="field" aria-label="Replay speed" value={speed} onChange={e => setSpeed(Number(e.target.value))} style={{ width: 70 }}>
            <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
          </select>
          {running && mine
            ? <button className="btn danger" aria-label="Cancel replay" onClick={cancelReplay}><X size={13} /> Cancel</button>
            : <button className="btn primary" aria-label="Replay recording" disabled={status === 'recording' || running}
                onClick={() => void startReplay(r, { baseUrl: base, speed })}><Play size={13} /> Replay</button>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Opens a new tab and does the {plan.length} recorded action{plan.length === 1 ? '' : 's'} against {base || 'the recorded address'}, then checks whether the same problems appear.
        </div>
        {mine && replay.status !== 'idle' && (
          <div aria-label="Replay progress" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }} aria-hidden>
              {replay.results.map((res, i) => (
                <span key={i} title={`${i + 1}: ${describeStep(plan[i]!)} (${res})`} style={{ width: 9, height: 9, borderRadius: 2,
                  background: res === 'ok' ? 'var(--accent)' : res === 'missed' ? 'var(--danger)' : res === 'skipped' ? 'var(--warn)' : 'var(--border-medium)',
                  outline: running && i === replay.index ? '2px solid var(--text-primary)' : undefined }} />
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {replay.note}{replay.results.includes('missed') ? ` ${replay.results.filter(x => x === 'missed').length} step(s) could not find their element.` : ''}
              {replay.results.includes('skipped') ? ` ${replay.results.filter(x => x === 'skipped').length} step(s) skipped (hidden fields are never recorded).` : ''}
            </div>
            {replay.verdict && <VerdictCard v={replay.verdict} />}
          </div>
        )}
      </section>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {(['all', 'actions', 'network', 'problems'] as const).map(f => (
          <button key={f} className={`btn${filter === f ? ' primary' : ''}`} style={{ height: 24, fontSize: 11 }} aria-pressed={filter === f}
            onClick={() => { setFilter(f); setOpen(null); }}>{f[0]!.toUpperCase() + f.slice(1)}</button>
        ))}
      </div>
      <ol aria-label="Timeline" style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
        {steps.length === 0 && <li style={{ padding: 10, fontSize: 12, color: 'var(--text-muted)' }}>Nothing in this view.</li>}
        {steps.map((s, i) => (
          <li key={i} style={{ borderBottom: i < steps.length - 1 ? '1px solid var(--border-subtle)' : undefined }}>
            <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}
              style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 9px', border: 0, textAlign: 'left', cursor: 'pointer',
                background: isProblem(s) ? 'color-mix(in srgb, var(--danger) 9%, transparent)' : 'transparent', color: isProblem(s) ? 'var(--danger)' : 'var(--text-primary)', fontSize: 11.5 }}>
              <span style={{ width: 14, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>{ICON[s.kind]}</span>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', width: 48, flexShrink: 0 }}>{secs(s.t)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{describeStep(s)}</span>
            </button>
            {open === i && <StepDetail step={s} />}
          </li>
        ))}
      </ol>
    </div>
  );
};

const VerdictCard: React.FC<{ v: NonNullable<ReturnType<typeof useRecorderStore.getState>['replay']['verdict']> }> = ({ v }) => {
  const tone = v.verdict === 'reproduced' ? 'var(--danger)' : v.verdict === 'partly' ? 'var(--warn)' : 'var(--accent)';
  const title = { reproduced: 'Reproduced: the same problem happened', partly: 'Partly reproduced', 'not-reproduced': 'Not reproduced: the problem did not happen here',
    'nothing-to-compare': 'Replayed. The recording had no errors to compare' }[v.verdict];
  return (
    <div role="status" aria-label="Replay result" style={{ border: `1px solid ${tone}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, lineHeight: 1.5 }}>
      <strong style={{ color: tone }}>{title}</strong>
      {v.matched.map((m, i) => <div key={`m${i}`}>✓ {m}</div>)}
      {v.missing.map((m, i) => <div key={`x${i}`} style={{ color: 'var(--text-secondary)' }}>✗ did not happen: {m}</div>)}
      {v.extra.length > 0 && <div style={{ color: 'var(--text-muted)' }}>{v.extra.length} other problem{v.extra.length === 1 ? '' : 's'} appeared that the recording did not have</div>}
    </div>
  );
};

const pre: React.CSSProperties = { margin: 0, padding: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
  maxHeight: 180, overflow: 'auto', background: 'var(--bg-primary)', borderRadius: 6 };

const StepDetail: React.FC<{ step: RecordedStep }> = ({ step: s }) => {
  const [dom, setDom] = useState(false);
  const box: React.CSSProperties = { padding: '4px 10px 10px 31px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 };
  if (s.kind === 'request') {
    const headers = (h?: Record<string, string>) => Object.entries(h ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
    return (
      <div style={box}>
        <div style={{ color: 'var(--text-secondary)' }}>{s.method} {s.url}{s.durationMs !== undefined ? ` · ${Math.round(s.durationMs)} ms` : ''}{s.mimeType ? ` · ${s.mimeType}` : ''}</div>
        {s.requestBody && <><strong>Request body</strong><pre style={pre}>{s.requestBody}</pre></>}
        {s.responseBody && <><strong>Response body</strong><pre style={pre}>{s.responseBody}</pre></>}
        {s.responseHeaders && <><strong>Response headers</strong><pre style={pre}>{headers(s.responseHeaders)}</pre></>}
      </div>
    );
  }
  if (s.kind === 'snapshot') {
    return (
      <div style={box}>
        <div style={{ color: 'var(--text-secondary)' }}>{s.url}</div>
        {s.screenshot && <img alt={s.label} src={s.screenshot} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--border-medium)' }} />}
        {s.html && <button className="btn" style={{ alignSelf: 'flex-start', height: 24 }} onClick={() => setDom(!dom)}>{dom ? 'Hide' : 'View'} the page as it was</button>}
        {dom && s.html && <iframe title={`Page snapshot: ${s.label}`} sandbox="" srcDoc={s.html} style={{ width: '100%', height: 320, border: '1px solid var(--border-medium)', borderRadius: 6, background: '#fff' }} />}
      </div>
    );
  }
  if (s.kind === 'error') {
    return <div style={box}>{s.source && <div style={{ color: 'var(--text-secondary)' }}>{s.source}{s.line ? `:${s.line}` : ''}</div>}{s.stack && <pre style={pre}>{s.stack}</pre>}</div>;
  }
  if (s.kind === 'click' || s.kind === 'input' || s.kind === 'key') {
    const t = s.target;
    return t ? <div style={box}><code style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, overflowWrap: 'anywhere' }}>{t.selector}</code></div> : null;
  }
  return null;
};
