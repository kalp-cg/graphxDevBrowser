import React, { useMemo, useState } from 'react';
import { Check, ClipboardPaste, Copy, Loader2, Plus, Save, Send, Trash2, X } from 'lucide-react';
import { useAppStore, newApiRequest } from '../../store/useAppStore';
import {
  buildSendRequest, parseCurl, type ApiAssertion, type ApiParam, type ApiRequestDraft, type ApiVariable, type AssertionKind
} from '../../../shared/domain/api-client';

type Tab = 'params' | 'headers' | 'body' | 'checks' | 'variables';
const METHODS: ApiRequestDraft['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const HEADER_HINTS = ['Accept', 'Authorization', 'Content-Type', 'Cookie', 'X-Api-Key'];

const statusTone = (status: number) =>
  status === 0 || status >= 500 ? 'var(--danger)' : status >= 400 ? 'var(--warn)' : 'var(--accent)';

function pretty(body: string, type: string | undefined): string {
  if (type && /json/i.test(type) || /^\s*[[{]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export const ApiClientView: React.FC = () => {
  const request = useAppStore(s => s.activeRequest);
  const setRequest = useAppStore(s => s.setActiveRequest);
  const variables = useAppStore(s => s.apiVariables);
  const setVariables = useAppStore(s => s.setApiVariables);
  const saved = useAppStore(s => s.savedRequests);
  const history = useAppStore(s => s.apiHistory);
  const result = useAppStore(s => s.apiResult);
  const checks = useAppStore(s => s.apiAssertionResults);
  const sending = useAppStore(s => s.isApiSending);
  const send = useAppStore(s => s.sendActiveRequest);
  const save = useAppStore(s => s.saveActiveRequest);
  const removeSaved = useAppStore(s => s.deleteSavedRequest);
  const addToast = useAppStore(s => s.addToast);

  const [tab, setTab] = useState<Tab>('headers');
  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body');
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [curlText, setCurlText] = useState('');
  const importCurl = (text: string): boolean => {
    const draft = parseCurl(text);
    if (!draft) {
      addToast({ type: 'warning', title: 'Not a curl command', message: 'Paste a command that starts with curl and has an address.' });
      return false;
    }
    setRequest(draft);
    setImporting(false);
    setCurlText('');
    addToast({ type: 'success', title: 'Imported', message: `${draft.method} ${draft.url}` });
    return true;
  };
  const patch = (p: Partial<ApiRequestDraft>) => setRequest({ ...request, ...p });

  const body = useMemo(() => (result ? pretty(result.body, result.headers['content-type']) : ''), [result]);
  const counts: Record<Tab, number> = {
    params: request.queryParams.filter(p => p.enabled && p.key).length,
    headers: request.headers.filter(h => h.enabled && h.key).length,
    body: request.body.mode === 'none' ? 0 : 1,
    checks: request.assertions.length,
    variables: variables.filter(v => v.key).length
  };

  const copyCurl = () => {
    const { request: r } = buildSendRequest(request, variables);
    const curl = [`curl -X ${r.method} '${r.url}'`, ...Object.entries(r.headers).map(([k, v]) => `-H '${k}: ${v}'`),
      ...(r.body ? [`-d '${r.body.replace(/'/g, "'\\''")}'`] : [])].join(' \\\n  ');
    void navigator.clipboard.writeText(curl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    addToast({ type: 'info', title: 'Copied as cURL', message: 'Variables are filled in: check it for secrets before sharing.' });
  };

  const load = (value: string) => {
    const [kind, id] = value.split(':');
    const draft = kind === 'saved' ? saved.find(r => r.id === id) : history.find(h => h.id === id)?.draft;
    if (draft) setRequest({ ...draft, id: kind === 'saved' ? draft.id : newApiRequest().id });
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <select className="field" aria-label="Method" value={request.method} style={{ width: 92, fontWeight: 700 }}
          onChange={e => patch({ method: e.target.value as ApiRequestDraft['method'] })}>
          {METHODS.map(m => <option key={m}>{m}</option>)}
        </select>
        <input className="field" aria-label="Request address" placeholder="{{baseUrl}}/api/items  or  localhost:3000/health"
          value={request.url} style={{ flex: '1 1 260px', minWidth: 160, fontFamily: 'var(--font-mono)' }}
          onChange={e => patch({ url: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void send(); }}
          onPaste={e => {
            const text = e.clipboardData.getData('text');
            if (/^\s*curl\s/.test(text) && importCurl(text)) e.preventDefault(); // paste a curl command here and it becomes the request
          }} />
        <button className="btn primary" onClick={() => void send()} disabled={sending}>
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button className="btn" onClick={save} title="Save this request (credentials in headers are not saved)"><Save size={13} /> Save</button>
        <button className="btn" onClick={() => setImporting(v => !v)} title="Paste a curl command: from API docs, or Copy as cURL in any DevTools"><ClipboardPaste size={13} /> Import cURL</button>
        <select className="field" aria-label="Load a request" value="" style={{ width: 96 }} onChange={e => load(e.target.value)}>
          <option value="">Load…</option>
          {saved.length > 0 && <optgroup label="Saved">{saved.map(r => <option key={r.id} value={`saved:${r.id}`}>{r.name}</option>)}</optgroup>}
          {history.length > 0 && (
            <optgroup label="Sent this session">
              {history.map(h => <option key={h.id} value={`history:${h.id}`}>{h.method} {h.url.replace(/^https?:\/\//, '')} · {h.status || 'failed'}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {importing && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'flex-start' }}>
          <textarea aria-label="curl command" autoFocus spellCheck={false} value={curlText} onChange={e => setCurlText(e.target.value)}
            placeholder={"curl 'https://api.example.com/items' -H 'Authorization: Bearer …' --data-raw '{…}'"}
            style={{ flex: 1, minHeight: 64, resize: 'vertical', padding: 8, borderRadius: 6, border: '1px solid var(--border-medium)',
              background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          <button className="btn primary" disabled={!curlText.trim()} onClick={() => importCurl(curlText)}>Import</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', overflow: 'auto' }}>
        {/* The request */}
        <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-subtle)' }}>
          <div role="tablist" style={{ display: 'flex', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
            {(['headers', 'params', 'body', 'checks', 'variables'] as Tab[]).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                style={{ border: 0, borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                  background: tab === t ? 'var(--bg-active)' : 'transparent', color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {t}{counts[t] ? ` (${counts[t]})` : ''}
              </button>
            ))}
            <button className="btn" style={{ marginLeft: 'auto', height: 24 }} onClick={copyCurl}>
              {copied ? <Check size={12} /> : <Copy size={12} />} cURL
            </button>
          </div>
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tab === 'headers' && (
              <Rows rows={request.headers} onChange={headers => patch({ headers })} keyHint="Header" valueHint="Value" suggestions={HEADER_HINTS} />
            )}
            {tab === 'params' && <Rows rows={request.queryParams} onChange={queryParams => patch({ queryParams })} keyHint="Parameter" valueHint="Value" />}
            {tab === 'body' && (
              <>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['none', 'json', 'raw'] as const).map(m => (
                    <button key={m} className={`btn${request.body.mode === m ? ' primary' : ''}`} style={{ textTransform: 'capitalize' }}
                      onClick={() => patch({ body: { ...request.body, mode: m } })}>{m}</button>
                  ))}
                </div>
                {request.body.mode !== 'none' && (
                  <textarea aria-label="Request body" spellCheck={false} value={request.body.raw ?? ''}
                    placeholder={request.body.mode === 'json' ? '{\n  "name": "example"\n}' : 'Raw body'}
                    onChange={e => patch({ body: { ...request.body, raw: e.target.value } })}
                    style={{ minHeight: 160, resize: 'vertical', padding: 10, borderRadius: 6, border: '1px solid var(--border-medium)',
                      background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                )}
                {request.method === 'GET' && request.body.mode !== 'none' && (
                  <div style={{ fontSize: 12, color: 'var(--warn)' }}>GET and HEAD requests are sent without a body.</div>
                )}
              </>
            )}
            {tab === 'checks' && <Checks list={request.assertions} onChange={assertions => patch({ assertions })} />}
            {tab === 'variables' && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Use <code>{'{{name}}'}</code> in the address, headers or body. Values of names that look like credentials
                  (token, secret, key, password, authorization) are kept in memory only and are gone when you quit.
                </div>
                <Rows rows={variables.map(v => ({ ...v, enabled: true }))} withEnabled={false} keyHint="Name" valueHint="Value"
                  onChange={rows => setVariables(rows.map(({ key, value }) => ({ key, value })) as ApiVariable[])} />
              </>
            )}
          </div>
        </div>

        {/* The response */}
        <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
            minHeight: 41, flexWrap: 'wrap' }}>
            <span className="section-label">Response</span>
            {result?.ok && (
              <>
                <strong style={{ color: statusTone(result.status), fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  {result.status} {result.statusText}
                </strong>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{result.durationMs} ms</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{bytes(result.size)}</span>
              </>
            )}
          </div>
          {!result && !sending && (
            <div style={{ padding: 18, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
              Press <strong>Send</strong> (or Enter in the address). Requests go out from this app, not from a page, so CORS does not
              apply. Cookies from your browsing are not sent; add a Cookie header if the request needs one.
            </div>
          )}
          {result && !result.ok && (
            <div role="alert" style={{ margin: 12, padding: 12, borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13 }}>
              <strong>No response.</strong> {result.error}
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>after {result.durationMs} ms · {result.finalUrl}</div>
            </div>
          )}
          {result?.ok && (
            <>
              {checks.length > 0 && (
                <ul aria-label="Check results" style={{ listStyle: 'none', margin: 0, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4,
                  borderBottom: '1px solid var(--border-subtle)' }}>
                  {checks.map(c => (
                    <li key={c.id} style={{ display: 'flex', gap: 8, fontSize: 12, color: c.passed ? 'var(--text-secondary)' : 'var(--danger)' }}>
                      {c.passed ? <Check size={14} color="var(--accent)" /> : <X size={14} />}
                      <span>{c.passed ? 'Passed' : 'Failed'}: {c.message}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: 2, padding: '6px 8px' }}>
                {(['body', 'headers'] as const).map(t => (
                  <button key={t} onClick={() => setResponseTab(t)}
                    style={{ border: 0, borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                      background: responseTab === t ? 'var(--bg-active)' : 'transparent', color: responseTab === t ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {t}{t === 'headers' ? ` (${Object.keys(result.headers).length})` : ''}
                  </button>
                ))}
              </div>
              {responseTab === 'body' ? (
                <pre aria-label="Response body" style={{ margin: 0, padding: '4px 12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>
                  {body || '(empty body)'}
                  {result.bodyTruncated && `\n\n[showing the first 2 MB of ${bytes(result.size)}]`}
                </pre>
              ) : (
                <dl style={{ margin: 0, padding: '4px 12px 14px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 12 }}>
                  {Object.entries(result.headers).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{k}</dt>
                      <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{v}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
      </div>

      {saved.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '6px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
          <span className="section-label" style={{ alignSelf: 'center' }}>Saved</span>
          {saved.slice(0, 6).map(r => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 5, background: 'var(--bg-tertiary)' }}>
              <button onClick={() => setRequest({ ...r })} style={{ border: 0, background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}>
                {r.name}
              </button>
              <button aria-label={`Delete ${r.name}`} onClick={() => removeSaved(r.id)}
                style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}><Trash2 size={12} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/** An editable list of name/value rows with an enabled switch and an always-present empty row to type into. */
const Rows: React.FC<{ rows: ApiParam[]; onChange: (rows: ApiParam[]) => void; keyHint: string; valueHint: string;
  withEnabled?: boolean; suggestions?: string[] }> = ({ rows, onChange, keyHint, valueHint, withEnabled = true, suggestions }) => {
  const list = rows.length && !rows[rows.length - 1]!.key && !rows[rows.length - 1]!.value ? rows : [...rows, { key: '', value: '', enabled: true }];
  const set = (i: number, p: Partial<ApiParam>) => onChange(list.map((r, j) => (j === i ? { ...r, ...p } : r)).filter((r, j, a) => r.key || r.value || j === a.length - 1));
  const listId = suggestions ? `hints-${keyHint}` : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {suggestions && <datalist id={listId}>{suggestions.map(s => <option key={s} value={s} />)}</datalist>}
      {list.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', opacity: r.enabled ? 1 : 0.5 }}>
          {withEnabled && <input type="checkbox" aria-label={`Enable ${r.key || 'row'}`} checked={r.enabled} onChange={e => set(i, { enabled: e.target.checked })} />}
          <input className="field" aria-label={`${keyHint} ${i + 1}`} list={listId} placeholder={keyHint} value={r.key}
            style={{ flex: '1 1 40%', minWidth: 0, fontFamily: 'var(--font-mono)' }} onChange={e => set(i, { key: e.target.value })} />
          <input className="field" aria-label={`${valueHint} ${i + 1}`} placeholder={valueHint} value={r.value}
            style={{ flex: '1 1 60%', minWidth: 0, fontFamily: 'var(--font-mono)' }} onChange={e => set(i, { value: e.target.value })} />
          <button aria-label="Remove row" className="icon-btn" onClick={() => onChange(list.filter((_, j) => j !== i))}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
};

const KIND_LABEL: Record<AssertionKind, string> = { status: 'Status is', time: 'Time under (ms)', contains: 'Body contains', json: 'JSON value' };
const KIND_HINT: Record<AssertionKind, string> = { status: '200, 2xx or <400', time: '500', contains: 'text', json: 'expected value' };

const Checks: React.FC<{ list: ApiAssertion[]; onChange: (list: ApiAssertion[]) => void }> = ({ list, onChange }) => {
  const set = (id: string, p: Partial<ApiAssertion>) => onChange(list.map(a => (a.id === id ? { ...a, ...p } : a)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>Checks run on every response and show passed or failed beside it.</div>
      {list.map(a => (
        <div key={a.id} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="field" aria-label="Check type" value={a.kind} style={{ width: 130 }}
            onChange={e => set(a.id, { kind: e.target.value as AssertionKind })}>
            {(Object.keys(KIND_LABEL) as AssertionKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          {a.kind === 'json' && (
            <input className="field" aria-label="JSON path" placeholder="data.items.0.id" value={a.path ?? ''}
              style={{ width: 130, fontFamily: 'var(--font-mono)' }} onChange={e => set(a.id, { path: e.target.value })} />
          )}
          <input className="field" aria-label="Expected value" placeholder={KIND_HINT[a.kind]} value={a.value}
            style={{ flex: 1, minWidth: 90, fontFamily: 'var(--font-mono)' }} onChange={e => set(a.id, { value: e.target.value })} />
          <button aria-label="Remove check" className="icon-btn" onClick={() => onChange(list.filter(x => x.id !== a.id))}><X size={13} /></button>
        </div>
      ))}
      <button className="btn" style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...list, { id: `chk-${Date.now()}-${list.length}`, kind: 'status', value: '2xx' }])}>
        <Plus size={13} /> Add check
      </button>
    </div>
  );
};
