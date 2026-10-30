import { inject } from './recorderAgent';
import { navigate, runInPage, screenshotOf, webContentsIdOf } from './pages';
import { useAppStore } from '../store/useAppStore';
import { useBrowserStore } from '../store/useBrowserStore';
import { useConsoleStore } from '../store/useConsoleStore';
import { IDLE_REPLAY, useRecorderStore, type StepResult } from '../store/useRecorderStore';
import {
  LIMITS, buildRecording, compareRun, isFailedRequest, pathOf, rebase, redactText, replayPlan, requestStep, suggestTitle, pauseBefore,
  type ObservedRun, type Recording, type RecordedStep
} from '../../shared/domain/recording';
import type { NetworkTransaction } from '../../shared/domain/network';

/** Records what happens in one tab, and replays a recording in a new one. Only this module touches the page; the panel only reads the store. */

interface PageEvent {
  type: 'click' | 'input' | 'key' | 'scroll' | 'error';
  at: number;
  [k: string]: unknown;
}
interface Info { width: number; height: number; userAgent: string; url: string; title: string }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const toast = (type: 'info' | 'warning' | 'error' | 'success', title: string, message?: string) =>
  useAppStore.getState().addToast({ type, title, message });
const tabOf = (id: string) => useBrowserStore.getState().tabs.find(t => t.id === id);

// ---- recording ------------------------------------------------------------------------------------------------------------------

interface Session {
  tabId: string; startedAt: number; startUrl: string; info: Info;
  steps: RecordedStep[]; redactions: number; shots: number; polling: boolean; stopping: boolean;
  txs: Map<string, NetworkTransaction>;
  timer: ReturnType<typeof setInterval>; unsubscribe: Array<() => void>;
}
let session: Session | null = null;

const stripMeta = (html: string) => html.replace(/<meta[^>]+(?:csrf|token|nonce)[^>]*>/gi, '');

function stepOf(s: Session, e: PageEvent): RecordedStep | null {
  const t = Math.max(0, e.at - s.startedAt);
  const clean = (v: unknown) => { const r = redactText(String(v ?? '').slice(0, 3900)); s.redactions += r.count; return r.text; };
  switch (e.type) {
    case 'click': return { t, kind: 'click', target: e.target as never, x: e.x as number, y: e.y as number };
    case 'input': return { t, kind: 'input', target: e.target as never, value: e.masked ? '' : clean(e.value), masked: !!e.masked };
    case 'key': return { t, kind: 'key', key: String(e.key), target: e.target as never };
    case 'scroll': return { t, kind: 'scroll', x: e.x as number, y: e.y as number };
    case 'error': return { t, kind: 'error', message: clean(e.message), source: e.source ? String(e.source) : undefined, line: e.line as number | undefined, stack: e.stack ? clean(e.stack) : undefined };
    default: return null;
  }
}

async function snapshot(s: Session, label: string, withPicture: boolean): Promise<void> {
  const snap = await runInPage<{ url: string; html: string }>(s.tabId, inject('window.__dbRec.snapshot()'));
  if (!snap) return;
  const html = redactText(stripMeta(snap.html));
  s.redactions += html.count;
  let screenshot: string | undefined;
  if (withPicture && s.shots < LIMITS.screenshots) {
    const shot = await screenshotOf(s.tabId);
    if (shot && shot.length <= LIMITS.screenshot) { screenshot = shot; s.shots++; }
  }
  s.steps.push({ t: Date.now() - s.startedAt, kind: 'snapshot', label, url: snap.url, html: html.text, screenshot });
}

async function poll(s: Session): Promise<void> {
  if (s.polling) return;
  s.polling = true;
  try {
    const events = await runInPage<PageEvent[]>(s.tabId, inject('window.__dbRec.drain()'));
    for (const e of events ?? []) {
      const step = stepOf(s, e);
      if (!step) continue;
      if (step.kind === 'scroll') {
        const prev = s.steps.at(-1);
        if (prev?.kind === 'scroll' && step.t - prev.t < 1200) { s.steps[s.steps.length - 1] = step; continue; }
      }
      s.steps.push(step);
      if (step.kind === 'error' && s.steps.filter(x => x.kind === 'snapshot').length < 4) void snapshot(s, `After error: ${step.message.slice(0, 60)}`, true);
    }
    const live = useRecorderStore.getState().live;
    const actions = s.steps.filter(x => x.kind === 'click' || x.kind === 'input' || x.kind === 'key').length;
    const errors = s.steps.filter(x => x.kind === 'error').length;
    if (actions !== live.actions || errors !== live.errors) useRecorderStore.getState().set({ live: { ...live, actions, errors } });
  } finally {
    s.polling = false;
  }
  if (!tabOf(s.tabId)) void stopRecording('The recorded tab was closed.');
}

export async function startRecording(): Promise<boolean> {
  const rec = useRecorderStore.getState();
  if (rec.status === 'recording') return true;
  if (rec.replay.status === 'running') { toast('warning', 'A replay is running', 'Wait for it to finish or cancel it first.'); return false; }
  const browser = useBrowserStore.getState();
  const tab = browser.tabs.find(t => t.id === browser.activeId);
  if (!tab || tab.url === 'about:blank' || tab.error) { toast('warning', 'Open a page first', 'Recording follows one tab: load the page where the bug happens, then record.'); return false; }
  const info = await runInPage<Info>(tab.id, inject('window.__dbRec.info()'));
  if (!info) { toast('warning', 'The page is not ready yet', 'Try again in a moment.'); return false; }

  const startedAt = Date.now();
  const s: Session = {
    tabId: tab.id, startedAt, startUrl: tab.url, info, steps: [], redactions: 0, shots: 0, polling: false, stopping: false,
    txs: new Map(), timer: setInterval(() => void poll(s), 300), unsubscribe: []
  };
  session = s;
  useRecorderStore.getState().set({ status: 'recording', tabId: tab.id, startedAt, live: { actions: 0, requests: 0, errors: 0 } });

  // Where the person goes (clicks that load pages, the address bar, back and forward).
  let lastUrl = tab.url;
  s.unsubscribe.push(useBrowserStore.subscribe(state => {
    const t = state.tabs.find(x => x.id === s.tabId);
    if (t && t.url !== lastUrl && t.url !== 'about:blank') {
      lastUrl = t.url;
      s.steps.push({ t: Date.now() - s.startedAt, kind: 'navigate', url: t.url.slice(0, 3900), title: t.title.slice(0, 290) });
    }
  }));
  // Every request this tab makes (the Network panel only keeps the latest 200, a recording keeps all of its own).
  s.unsubscribe.push(useAppStore.subscribe(state => {
    const wc = webContentsIdOf(s.tabId);
    if (wc === null) return;
    for (const tx of state.transactions) {
      if (tx.tabId === `webview-${wc}` && tx.startTime >= s.startedAt - 50) s.txs.set(tx.id, tx);
    }
    const n = s.txs.size;
    const live = useRecorderStore.getState().live;
    if (n !== live.requests) useRecorderStore.getState().set({ live: { ...live, requests: n } });
  }));

  s.steps.push({ t: 0, kind: 'navigate', url: tab.url.slice(0, 3900), title: tab.title.slice(0, 290) });
  await snapshot(s, 'Start', true);
  return true;
}

export async function stopRecording(reason?: string): Promise<Recording | null> {
  const s = session;
  if (!s || s.stopping) return null;
  s.stopping = true;
  clearInterval(s.timer);
  s.unsubscribe.forEach(u => u());
  await poll(s).catch(() => undefined);
  await snapshot(s, 'End', true).catch(() => undefined);
  session = null;

  const steps = [...s.steps];
  let redactions = s.redactions;
  for (const tx of s.txs.values()) {
    const r = requestStep(tx, s.startedAt, { bodies: true });
    steps.push(r.step); redactions += r.redactions;
  }
  for (const e of useConsoleStore.getState().entries) {
    if (e.tabId !== s.tabId || e.at < s.startedAt || e.level === 'log') continue;
    const m = redactText((e.count > 1 ? `${e.message.slice(0, 3800)} (×${e.count})` : e.message).slice(0, 3900));
    redactions += m.count;
    steps.push({ t: Math.max(0, e.at - s.startedAt), kind: 'console', level: e.level, message: m.text });
  }
  const endedAt = Date.now();
  const recording = buildRecording({
    id: crypto.randomUUID(), title: suggestTitle(steps, s.startUrl), startedAt: s.startedAt, endedAt, startUrl: s.startUrl,
    viewport: { width: s.info.width, height: s.info.height }, userAgent: s.info.userAgent, steps, redactions, appVersion: __APP_VERSION__
  });
  const store = useRecorderStore.getState();
  store.set({ status: 'idle', tabId: null, live: { actions: 0, requests: 0, errors: 0 } });
  store.add(recording);
  const problems = steps.filter(x => x.kind === 'error' || isFailedRequest(x)).length;
  toast(reason ? 'warning' : 'success', reason ?? 'Recording saved', `${recording.steps.length} steps, ${problems} problem${problems === 1 ? '' : 's'}. Export it to share.`);
  return recording;
}

// ---- replay ---------------------------------------------------------------------------------------------------------------------

let cancelReplayFlag = false;
export function cancelReplay(): void { cancelReplayFlag = true; }

/** True once the tab's page can take commands and is not loading. */
async function settled(tabId: string, timeout = 15000): Promise<boolean> {
  const t0 = Date.now();
  await sleep(150);
  while (Date.now() - t0 < timeout) {
    const t = tabOf(tabId);
    if (!t) return false;
    if (!t.loading && (await runInPage(tabId, '1')) !== null) return true;
    await sleep(120);
  }
  return false;
}

export interface ReplayOptions { baseUrl?: string; speed?: number }

/** Opens the recorded page in a new tab and does what the person did. Resolves with whether the same problems showed up. */
export async function startReplay(recording: Recording, options: ReplayOptions = {}): Promise<void> {
  const store = useRecorderStore.getState();
  if (store.status === 'recording') { toast('warning', 'Stop recording first'); return; }
  if (store.replay.status === 'running') return;
  cancelReplayFlag = false;
  const recordedOrigin = (() => { try { return new URL(recording.startUrl).origin; } catch { return ''; } })();
  const target = options.baseUrl?.trim() || recordedOrigin;
  const mapUrl = (u: string) => (recordedOrigin && target ? rebase(u, recordedOrigin, /^https?:\/\//.test(target) ? target : `http://${target}`) : u);
  const plan = replayPlan(recording);
  const results: StepResult[] = plan.map(() => 'pending');
  const startedAt = Date.now();

  const tabId = useBrowserStore.getState().newTab(mapUrl(recording.startUrl));
  const set = (patch: Partial<ReturnType<typeof useRecorderStore.getState>['replay']>) =>
    useRecorderStore.getState().set({ replay: { ...useRecorderStore.getState().replay, ...patch } });
  useRecorderStore.getState().set({ replay: { ...IDLE_REPLAY, status: 'running', recordingId: recording.id, tabId, results: [...results], note: 'Opening the page…' } });

  const observedErrors: string[] = [];
  const finish = (status: 'done' | 'cancelled', note: string) => {
    const wc = webContentsIdOf(tabId);
    const failedRequests: ObservedRun['failedRequests'] = [];
    for (const tx of useAppStore.getState().transactions) {
      if (wc !== null && tx.tabId === `webview-${wc}` && tx.startTime >= startedAt && (tx.error || (tx.statusCode ?? 0) >= 400)) {
        failedRequests.push({ method: tx.method, path: pathOf(tx.url), status: tx.error ? 'error' : tx.statusCode ?? 0 });
      }
    }
    for (const e of useConsoleStore.getState().entries) if (e.tabId === tabId && e.at >= startedAt && e.level === 'error') observedErrors.push(e.message);
    // The recording's addresses may differ from this run's origin: compare on the path only.
    set({ status, note, verdict: status === 'done' ? compareRun(recording, { errors: observedErrors, failedRequests }) : null });
  };

  if (!(await settled(tabId))) { finish('done', 'The page did not load. Is the app running at the address you replayed against?'); return; }
  let previous: { t: number } | undefined;
  for (let i = 0; i < plan.length; i++) {
    if (cancelReplayFlag || !tabOf(tabId)) { finish('cancelled', 'Replay stopped.'); return; }
    const step = plan[i]!;
    set({ index: i, note: `Step ${i + 1} of ${plan.length}` });
    await sleep(pauseBefore(step, previous, options.speed));
    previous = step;
    let outcome: StepResult = 'ok';
    if (step.kind === 'navigate') {
      navigate(tabId, mapUrl(step.url));
    } else {
      const r = await runInPage<StepResult>(tabId, inject(`window.__dbRec.perform(${JSON.stringify(step)})`));
      outcome = r ?? 'missed';
    }
    results[i] = outcome;
    set({ results: [...results] });
    await sleep(200);
    await settled(tabId, 8000);
    const events = await runInPage<PageEvent[]>(tabId, inject('window.__dbRec.drain()'));
    for (const e of events ?? []) if (e.type === 'error') observedErrors.push(String(e.message));
  }
  await sleep(1200); // late errors and slow requests
  const tail = await runInPage<PageEvent[]>(tabId, inject('window.__dbRec.drain()'));
  for (const e of tail ?? []) if (e.type === 'error') observedErrors.push(String(e.message));
  finish('done', `Replayed ${plan.length} step${plan.length === 1 ? '' : 's'}.`);
}
