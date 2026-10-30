import React, { useRef, useState } from 'react';
import { Check, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useMockStore, activeCount } from '../../store/useMockStore';
import { useRecorderStore } from '../../store/useRecorderStore';
import { useAppStore } from '../../store/useAppStore';
import {
  headerLines, newRule, parseHeaderLines, rulesFromHar, rulesFromRecording, statusText, summarizeRule, type MockRule
} from '../../../shared/domain/mock';

const label: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 3 };

/** The rules that answer a page's requests: made-up responses, delays and dropped connections. Lives inside the Network panel. */
export const MocksPane: React.FC = () => {
  const { enabled, rules, log, hits, editing, setEnabled, add, update, remove, clear, edit } = useMockStore();
  const recordings = useRecorderStore(s => s.recordings);
  const addToast = useAppStore(s => s.addToast);
  const harInput = useRef<HTMLInputElement>(null);
  const active = activeCount({ enabled, rules });

  const fromHar = async (file: File | undefined) => {
    if (!file) return;
    const r = rulesFromHar(await file.text());
    if (!r.ok) return void addToast({ type: 'error', title: 'Could not read the HAR file', message: r.error });
    if (!r.rules.length) return void addToast({ type: 'warning', title: 'Nothing to mock', message: 'The file has no data calls with response bodies. Export "HAR + bodies" from the Network panel.' });
    add(...r.rules);
    addToast({ type: 'success', title: `${r.rules.length} rule${r.rules.length === 1 ? '' : 's'} from the HAR`, message: r.skipped ? `${r.skipped} call(s) had no body and were skipped.` : 'Mocking is on. Reload the page.' });
  };
  const fromRecording = (id: string) => {
    const rec = recordings.find(r => r.id === id);
    if (!rec) return;
    const made = rulesFromRecording(rec);
    if (!made.length) return void addToast({ type: 'warning', title: 'Nothing to mock', message: 'That recording has no data calls with responses.' });
    add(...made);
    addToast({ type: 'success', title: `${made.length} rule${made.length === 1 ? '' : 's'} from the recording`, message: 'The page now gets the recorded responses. Reload it, or replay the recording without the backend.' });
  };

  return (
    <div role="region" aria-label="Mock rules" style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border-subtle)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
          <input type="checkbox" aria-label="Mocking enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Mocking {enabled ? 'is ON' : 'is off'}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
            {enabled ? `${active} active rule${active === 1 ? '' : 's'} answer${active === 1 ? 's' : ''} for the pages you browse` : 'requests go to the real servers'}
          </span>
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn primary" style={{ height: 26 }} aria-label="New mock rule" onClick={() => edit(newRule({ name: 'New rule' }))}><Plus size={13} /> New rule</button>
          <button className="btn" style={{ height: 26 }} aria-label="Mock from a HAR file" onClick={() => harInput.current?.click()}><Upload size={13} /> From HAR</button>
          <input ref={harInput} type="file" accept=".har,.json,application/json" aria-label="HAR file" hidden onChange={e => { void fromHar(e.target.files?.[0]); e.target.value = ''; }} />
          {recordings.length > 0 && (
            <select className="field" aria-label="Mock from a recording" style={{ height: 26, fontSize: 11, maxWidth: 190 }} value=""
              onChange={e => { fromRecording(e.target.value); e.target.value = ''; }}>
              <option value="">From a bug recording…</option>
              {recordings.map(r => <option key={r.id} value={r.id}>{r.title.slice(0, 50)}</option>)}
            </select>
          )}
          {rules.length > 0 && <button className="btn" style={{ height: 26, marginLeft: 'auto' }} aria-label="Delete all mock rules" onClick={clear}><Trash2 size={13} /> Delete all</button>}
        </div>
      </div>

      {editing && <Editor key={editing.id} rule={editing} isNew={!rules.some(r => r.id === editing.id)}
        onSave={r => { if (rules.some(x => x.id === r.id)) update(r); else add(r); edit(null); }} onCancel={() => edit(null)} />}

      {rules.length === 0 && !editing && (
        <div style={{ padding: 16, fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Try your page against a backend that is slow, broken or empty</strong>
          <span>Right-click any request in the list: <em>Mock this response</em>, <em>Return 500</em>, <em>Delay 5 seconds</em> or <em>Drop the connection</em>. Or make rules from a HAR file or a bug recording, and run the page with no backend at all.</span>
          <span>Rules answer only for the pages you browse here, and only while mocking is on.</span>
        </div>
      )}

      <ul aria-label="Rules" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rules.map(r => (
          <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderBottom: '1px solid var(--border-subtle)', opacity: r.enabled ? 1 : 0.55 }}>
            <input type="checkbox" aria-label={`Rule ${r.name} enabled`} checked={r.enabled} onChange={e => update({ ...r, enabled: e.target.checked })} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summarizeRule(r)}</div>
            </div>
            {(hits[r.id] ?? 0) > 0 && <span className="tag" title="Requests this rule has answered" aria-label={`${hits[r.id]} hits`}>{hits[r.id]}</span>}
            <button className="icon-btn" aria-label={`Edit rule ${r.name}`} title="Edit" onClick={() => edit(r)}><Pencil size={13} /></button>
            <button className="icon-btn" aria-label={`Delete rule ${r.name}`} title="Delete" onClick={() => remove(r.id)}><Trash2 size={13} /></button>
          </li>
        ))}
      </ul>

      {log.length > 0 && (
        <div aria-label="Mock activity" style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 3 }}>Recent</div>
          {log.slice(0, 8).map((h, i) => (
            <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {new Date(h.at).toLocaleTimeString()} {h.method} {h.url.replace(/^https?:\/\//, '')} → {h.action === 'respond' ? `${h.status} ${statusText(h.status ?? 0)}` : h.action === 'drop' ? 'dropped' : `delayed ${h.delayMs} ms`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Editor: React.FC<{ rule: MockRule; isNew: boolean; onSave: (r: MockRule) => void; onCancel: () => void }> = ({ rule, isNew, onSave, onCancel }) => {
  const [r, setR] = useState(rule);
  const [headers, setHeaders] = useState(headerLines(rule.headers));
  const set = <K extends keyof MockRule>(k: K, v: MockRule[K]) => setR(x => ({ ...x, [k]: v }));
  const valid = r.url.trim().length > 0 && r.status >= 100 && r.status <= 599;
  return (
    <form aria-label="Rule editor" onSubmit={e => { e.preventDefault(); if (valid) onSave({ ...r, url: r.url.trim(), headers: parseHeaderLines(headers) }); }}
      style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
      <strong style={{ fontSize: 12 }}>{isNew ? 'New rule' : 'Edit rule'}</strong>
      <label style={label}>Name<input className="field" aria-label="Rule name" value={r.name} onChange={e => set('name', e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ ...label, width: 90 }}>Method
          <select className="field" aria-label="Rule method" value={r.method} onChange={e => set('method', e.target.value)}>
            {['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m === '*' ? 'Any' : m}</option>)}
          </select>
        </label>
        <label style={{ ...label, flex: 1 }}>Address (use * as a wildcard)
          <input className="field" aria-label="Rule address" placeholder="http://localhost:3100/api/*" value={r.url} onChange={e => set('url', e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={label}>What it does
          <select className="field" aria-label="Rule action" value={r.kind} onChange={e => set('kind', e.target.value as MockRule['kind'])}>
            <option value="respond">Answer with this response</option>
            <option value="passthrough">Let the real server answer (delayed)</option>
            <option value="drop">Drop the connection</option>
          </select>
        </label>
        {r.kind === 'respond' && <label style={{ ...label, width: 80 }}>Status
          <input className="field" aria-label="Rule status" type="number" min={100} max={599} value={r.status} onChange={e => set('status', Number(e.target.value))} />
        </label>}
        <label style={{ ...label, width: 110 }}>Delay (ms)
          <input className="field" aria-label="Rule delay" type="number" min={0} max={120000} step={100} value={r.delayMs} onChange={e => set('delayMs', Math.max(0, Number(e.target.value)))} />
        </label>
      </div>
      {r.kind === 'respond' && <>
        <label style={label}>Headers (one per line)<textarea className="field" aria-label="Rule headers" rows={2} value={headers} onChange={e => setHeaders(e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical' }} placeholder="content-type: application/json" /></label>
        <label style={label}>Body<textarea className="field" aria-label="Rule body" rows={6} value={r.body} onChange={e => set('body', e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical' }} /></label>
      </>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" className="btn primary" aria-label="Save rule" disabled={!valid}><Check size={13} /> Save rule</button>
        <button type="button" className="btn" aria-label="Cancel editing" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};
