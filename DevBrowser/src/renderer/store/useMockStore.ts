import { create } from 'zustand';
import { MAX_RULES, MockRuleSchema, type MockHit, type MockRule } from '../../shared/domain/mock';

const KEY = 'devbrowser.mocks';
const MAX_LOG = 60;

/** Rules are kept across launches; the master switch is not: a forgotten mock must not silently answer for the backend tomorrow. */
function load(): MockRule[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(r => MockRuleSchema.safeParse(r)).filter(r => r.success).map(r => r.data!).slice(0, MAX_RULES) : [];
  } catch {
    return [];
  }
}
const save = (rules: MockRule[]) => { try { localStorage.setItem(KEY, JSON.stringify(rules)); } catch { /* storage full or blocked: rules last for the session */ } };

interface MockStoreState {
  enabled: boolean;
  rules: MockRule[];
  /** What rules did recently, newest first. */
  log: MockHit[];
  hits: Record<string, number>;
  /** The Mocks pane is shown in the Network panel. */
  paneOpen: boolean;
  /** A rule being edited in the pane (a new one from "Mock this response…", or an existing one). */
  editing: MockRule | null;
  setEnabled: (enabled: boolean) => void;
  /** New rules go first: the first matching rule wins. */
  add: (...rules: MockRule[]) => void;
  update: (rule: MockRule) => void;
  remove: (id: string) => void;
  clear: () => void;
  hit: (hit: MockHit) => void;
  setPane: (open: boolean) => void;
  edit: (rule: MockRule | null) => void;
}

export const activeCount = (s: Pick<MockStoreState, 'enabled' | 'rules'>): number => (s.enabled ? s.rules.filter(r => r.enabled).length : 0);

export const useMockStore = create<MockStoreState>((set) => ({
  enabled: false,
  rules: load(),
  log: [],
  hits: {},
  paneOpen: false,
  editing: null,
  setEnabled: enabled => set({ enabled }),
  add: (...rules) => set(s => { const next = [...rules, ...s.rules].slice(0, MAX_RULES); save(next); return { rules: next, enabled: true }; }),
  update: rule => set(s => { const next = s.rules.map(r => (r.id === rule.id ? rule : r)); save(next); return { rules: next }; }),
  remove: id => set(s => { const next = s.rules.filter(r => r.id !== id); save(next); return { rules: next }; }),
  clear: () => set(() => { save([]); return { rules: [], hits: {}, log: [] }; }),
  hit: h => set(s => ({ log: [h, ...s.log].slice(0, MAX_LOG), hits: { ...s.hits, [h.ruleId]: (s.hits[h.ruleId] ?? 0) + 1 } })),
  setPane: paneOpen => set({ paneOpen }),
  edit: editing => set(editing ? { editing, paneOpen: true } : { editing: null })
}));

/** Keeps the main process's rules equal to the store's, and feeds what rules did back into the store. Returns its cleanup. */
export function startMockSync(): () => void {
  const api = window.devBrowserAPI;
  if (!api) return () => undefined;
  const push = () => {
    const { enabled, rules } = useMockStore.getState();
    void api.network.setMocks({ enabled, rules }).catch(console.error);
  };
  push();
  const unsubscribe = useMockStore.subscribe((s, prev) => { if (s.enabled !== prev.enabled || s.rules !== prev.rules) push(); });
  const stopHits = api.network.onMockHit(hit => useMockStore.getState().hit(hit));
  return () => { unsubscribe(); stopHits(); };
}
