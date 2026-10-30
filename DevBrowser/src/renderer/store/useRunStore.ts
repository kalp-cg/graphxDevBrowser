import { create } from 'zustand';
import { detectLocalUrls, explainFailure, stripAnsi, type CommandSuggestion, type Failure, type PortOwner, type RunEvent } from '../../shared/domain/run';
import { originAddress } from '../../shared/domain/devserver';
import { useAppStore } from './useAppStore';
import { useBrowserStore } from './useBrowserStore';

export type RunStatus = 'idle' | 'running' | 'stopped' | 'crashed' | 'done';

export interface RunLine {
  n: number;
  stream: 'out' | 'err';
  text: string;
}

const MAX_LINES = 3000;
const KEY = 'devbrowser.run.v1';

interface Saved {
  folder: string;
  command: string;
  autoOpen: boolean;
}

function load(): Saved {
  try {
    return { folder: '', command: '', autoOpen: true, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { folder: '', command: '', autoOpen: true };
  }
}

interface RunState extends Saved {
  suggestions: CommandSuggestion[];
  status: RunStatus;
  id: string | null;
  lines: RunLine[];
  urls: string[];
  failure: (Failure & { owner?: PortOwner | null }) | null;
  exitCode: number | null;
  /** The address whose crash was reported to SentinelGraph, so that its recovery can be. */
  reported: { service: string; address: string } | null;
  setCommand: (command: string) => void;
  setAutoOpen: (on: boolean) => void;
  setFolder: (folder: string) => Promise<void>;
  pickFolder: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  freePort: () => Promise<void>;
  clear: () => void;
  handle: (e: RunEvent) => void;
}

const persist = (s: RunState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ folder: s.folder, command: s.command, autoOpen: s.autoOpen } satisfies Saved));
  } catch {
    // private window or blocked storage: it just is not remembered
  }
};

export const useRunStore = create<RunState>((set, get) => ({
  ...load(),
  suggestions: [],
  status: 'idle',
  id: null,
  lines: [],
  urls: [],
  failure: null,
  exitCode: null,
  reported: null,

  setCommand: command => { set({ command }); persist(get()); },
  setAutoOpen: autoOpen => { set({ autoOpen }); persist(get()); },

  setFolder: async folder => {
    set({ folder, suggestions: [] });
    persist(get());
    const found = await window.devBrowserAPI?.run.inspect(folder);
    if (!found) return;
    if (!found.ok) {
      useAppStore.getState().addToast({ type: 'warning', title: 'Cannot use that folder', message: found.error });
      return;
    }
    set(s => ({ suggestions: found.suggestions, command: s.command || found.suggestions[0]?.command || '' }));
    persist(get());
  },

  pickFolder: async () => {
    const folder = await window.devBrowserAPI?.run.pickFolder();
    if (folder) await get().setFolder(folder);
  },

  start: async () => {
    const { folder, command, status } = get();
    if (!window.devBrowserAPI || status === 'running') return;
    if (!folder) { useAppStore.getState().addToast({ type: 'info', title: 'Choose a folder first' }); return; }
    set({ lines: [], urls: [], failure: null, exitCode: null, status: 'running' });
    const res = await window.devBrowserAPI.run.start(command, folder);
    if (!res.ok) {
      set({ status: 'idle', failure: { kind: 'start', title: 'Could not start', hint: res.error, evidence: '' } });
      return;
    }
    set({ id: res.id });
  },

  stop: async () => {
    const { id } = get();
    if (id) await window.devBrowserAPI?.run.stop(id);
  },

  restart: async () => {
    await get().stop();
    for (let i = 0; i < 50 && get().status === 'running'; i++) await new Promise(r => setTimeout(r, 100));
    await get().start();
  },

  freePort: async () => {
    const owner = get().failure?.owner;
    if (!owner || !window.devBrowserAPI) return;
    const ok = await window.devBrowserAPI.run.killPid(owner.pid);
    useAppStore.getState().addToast(ok
      ? { type: 'success', title: `Stopped ${owner.name || 'process'} (pid ${owner.pid})`, message: 'Starting again.' }
      : { type: 'warning', title: 'Could not stop it', message: `Stop process ${owner.pid} yourself, then start again.` });
    if (ok) {
      await new Promise(r => setTimeout(r, 800));
      await get().start();
    }
  },

  clear: () => set({ lines: [], failure: null }),

  handle: e => {
    if (e.id !== get().id) return;
    if (e.kind === 'line') {
      const text = stripAnsi(e.text);
      set(s => {
        const lines = [...s.lines, { n: (s.lines.at(-1)?.n ?? 0) + 1, stream: e.stream, text }];
        return { lines: lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines };
      });
      const fresh = detectLocalUrls(text).filter(u => !get().urls.includes(u));
      if (fresh.length) onUrls(fresh);
      return;
    }
    const { lines } = get();
    const failure = e.stopped ? null : explainFailure(lines.map(l => l.text), e.code, e.signal);
    set({ status: e.stopped ? 'stopped' : failure ? 'crashed' : 'done', exitCode: e.code, id: null, failure });
    if (failure) void onCrash(failure);
  }
}));

/** A dev server announced where it listens: remember it, open it, and say it is back if it had crashed. */
function onUrls(fresh: string[]): void {
  const first = get().urls.length === 0;
  useRunStore.setState(s => ({ urls: [...s.urls, ...fresh] }));
  if (first && get().autoOpen) useBrowserStore.getState().newTab(fresh[0]!);
  const { reported } = get();
  if (reported && window.devBrowserAPI) {
    void window.devBrowserAPI.sentinel.reportDevServer(reported.service, false, reported.address)
      .then(() => useAppStore.getState().refreshSentinelGraph()).catch(() => undefined);
    useRunStore.setState({ reported: null });
  }
}

const get = () => useRunStore.getState();

/** The run ended badly: say why, find who holds the port if that is the reason, and tell SentinelGraph. */
async function onCrash(failure: Failure): Promise<void> {
  const app = useAppStore.getState();
  app.addToast({ type: 'error', title: failure.title, message: failure.hint });
  if (failure.port && window.devBrowserAPI) {
    const owner = await window.devBrowserAPI.run.portOwner(failure.port);
    useRunStore.setState(s => (s.failure ? { failure: { ...s.failure, owner } } : s));
  }
  const address = (get().urls[0] ? originAddress(new URL(get().urls[0]!).origin) : failure.port ? `localhost:${failure.port}` : '');
  const service = address ? app.sentinelAliases[address] : undefined;
  if (service && app.sentinelStatus === 'connected' && window.devBrowserAPI) {
    useRunStore.setState({ reported: { service, address } });
    void window.devBrowserAPI.sentinel.reportDevServer(service, true, address)
      .then(() => app.refreshSentinelGraph()).catch(() => undefined);
  }
}

/** Listen for what the running command prints, for the life of the window. */
export function startRunListener(): () => void {
  return window.devBrowserAPI?.run.onEvent(e => useRunStore.getState().handle(e)) ?? (() => undefined);
}
