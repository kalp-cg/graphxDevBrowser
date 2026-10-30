import React, { useEffect, useRef } from 'react';
import { FolderOpen, Play, RotateCw, Square, ExternalLink, Trash2, TriangleAlert } from 'lucide-react';
import { useRunStore } from '../../store/useRunStore';
import { useBrowserStore } from '../../store/useBrowserStore';

const STATUS_LABEL = { idle: 'Not running', running: 'Running', stopped: 'Stopped', crashed: 'Crashed', done: 'Finished' } as const;
const STATUS_TONE = { idle: 'var(--text-muted)', running: 'var(--accent)', stopped: 'var(--text-muted)', crashed: 'var(--danger)', done: 'var(--text-secondary)' } as const;

/** Start your project here: its output, the page it serves, and a plain-English reason when it dies. */
export const RunView: React.FC = () => {
  const s = useRunStore();
  const newTab = useBrowserStore(b => b.newTab);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = log.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [s.lines.length]);

  const running = s.status === 'running';
  return (
    <div role="region" aria-label="Run panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn" onClick={() => void s.pickFolder()} title="The folder to run in">
            <FolderOpen size={13} /> {s.folder ? s.folder.split(/[\\/]/).filter(Boolean).pop() : 'Choose folder'}
          </button>
          {s.folder && <span title={s.folder} style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.folder}</span>}
          <span aria-label="Run status" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: STATUS_TONE[s.status] }}>
            {STATUS_LABEL[s.status]}{s.status === 'crashed' && s.exitCode != null ? ` (exit ${s.exitCode})` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="field" aria-label="Command" placeholder="npm run dev" value={s.command} spellCheck={false} disabled={running}
            onChange={e => s.setCommand(e.target.value)} onKeyDown={e => e.key === 'Enter' && void s.start()}
            style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)' }} />
          {running ? (
            <>
              <button className="btn" onClick={() => void s.restart()}><RotateCw size={13} /> Restart</button>
              <button className="btn danger" onClick={() => void s.stop()}><Square size={13} /> Stop</button>
            </>
          ) : (
            <button className="btn primary" onClick={() => void s.start()}><Play size={13} /> Run</button>
          )}
        </div>
        {s.suggestions.length > 0 && !running && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Suggested commands">
            {s.suggestions.slice(0, 6).map(c => (
              <button key={c.command} className="btn" style={{ height: 24, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                aria-pressed={s.command === c.command} onClick={() => s.setCommand(c.command)} title={c.label}>{c.command}</button>
            ))}
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={s.autoOpen} onChange={e => s.setAutoOpen(e.target.checked)} />
          Open the page in a tab when the server starts
        </label>
        {s.urls.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Addresses it serves">
            {s.urls.map(u => (
              <button key={u} className="btn" style={{ height: 24, fontSize: 11, fontFamily: 'var(--font-mono)' }} onClick={() => newTab(u)}>
                <ExternalLink size={11} /> {u.replace('http://', '')}
              </button>
            ))}
          </div>
        )}
      </div>

      {s.failure && (
        <div role="alert" aria-label="Why it stopped" style={{ margin: 12, padding: 12, borderRadius: 8, border: '1px solid var(--danger)',
          background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--danger)' }}>
            <TriangleAlert size={15} /> {s.failure.title}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{s.failure.hint}</div>
          {s.failure.evidence && (
            <code style={{ fontSize: 11.5, color: 'var(--danger)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.failure.evidence}</code>
          )}
          {s.failure.owner && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <span>Held by <b>{s.failure.owner.name || 'a process'}</b> (pid {s.failure.owner.pid}).</span>
              <button className="btn primary" style={{ height: 26 }} onClick={() => void s.freePort()}>Stop it and run again</button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
        <span>Output{s.lines.length ? ` · ${s.lines.length} ${s.lines.length === 1 ? 'line' : 'lines'}` : ''}</span>
        <button className="icon-btn" aria-label="Clear output" style={{ marginLeft: 'auto', width: 22, height: 22 }} onClick={s.clear}><Trash2 size={12} /></button>
      </div>
      <div ref={log} aria-label="Output" role="log" tabIndex={0}
        onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px 12px', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5 }}>
        {s.lines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: 12.5, lineHeight: 1.6 }}>
            {s.folder ? 'Press Run. What your project prints appears here.' : 'Choose your project folder. DevBrowser suggests what to run, shows what it prints, opens the page when the server is up, and explains it if it crashes.'}
          </div>
        )}
        {s.lines.map(l => (
          <div key={l.n} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: l.stream === 'err' ? 'var(--warn)' : 'var(--text-primary)' }}>{l.text || ' '}</div>
        ))}
      </div>
    </div>
  );
};
