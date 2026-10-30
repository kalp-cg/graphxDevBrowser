import { create } from 'zustand';
import { fallbackTitle, PROFILES, toggleBookmark, toNavigableUrl, type Bookmark } from '../../shared/domain/browser';

export { PROFILES };

export interface PageError {
  code: number;
  description: string;
  url: string;
}

export interface Tab {
  id: string;
  /** The URL the tab was created with; the <webview> src. Later navigation never changes it (it would reload). */
  initialUrl: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  profile: string;
  zoom: number;
  device: string | null;
  rotated: boolean;
  /** Network throttling preset of this page (not kept across launches: the page itself is new). */
  throttle: string;
  error: PageError | null;
}

export interface HistoryEntry {
  url: string;
  title: string;
  at: number;
}

interface BrowserState {
  tabs: Tab[];
  activeId: string;
  /** Two tabs shown side by side, or null. The active tab is always one of them. */
  split: [string, string] | null;
  closed: Tab[];
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  /** Bookmark the active page, or remove its bookmark. */
  toggleBookmarkOfActive: () => void;
  removeBookmark: (url: string) => void;
  findOpen: boolean;
  /** Bumped to ask the omnibox to take focus (Cmd+L, new tab). */
  addressFocus: number;

  newTab: (input?: string, profile?: string) => string;
  closeTab: (id: string) => void;
  reopenTab: () => void;
  activate: (id: string) => void;
  activateIndex: (n: number) => void;
  cycle: (direction: 1 | -1) => void;
  update: (id: string, patch: Partial<Tab>) => void;
  record: (url: string, title: string) => void;
  toggleSplit: () => void;
  setFindOpen: (open: boolean) => void;
  focusAddress: () => void;
}

const SESSION_KEY = 'devbrowser.session.v1';
const HISTORY_KEY = 'devbrowser.history.v1';
const BOOKMARKS_KEY = 'devbrowser.bookmarks.v1';
const MAX_HISTORY = 300;
const MAX_CLOSED = 20;

let counter = 0;
const newId = () => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function makeTab(url: string, profile: string): Tab {
  return {
    id: newId(), initialUrl: url, url, title: fallbackTitle(url), loading: url !== 'about:blank',
    canGoBack: false, canGoForward: false, profile, zoom: 1, device: null, rotated: false, throttle: 'none', error: null
  };
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: the session just isn't remembered
  }
}

/** Tabs from the last session (URL, profile, zoom), or one start page. */
function restore(): { tabs: Tab[]; activeId: string } {
  const saved = read<{ tabs: { url: string; title?: string; profile: string; zoom?: number }[]; active: number } | null>(
    SESSION_KEY, null);
  const valid = (saved?.tabs ?? []).filter(t => typeof t.url === 'string' && PROFILES.some(p => p.key === t.profile));
  const tabs = valid.length
    ? valid.map(t => ({ ...makeTab(t.url, t.profile), title: t.title || fallbackTitle(t.url), zoom: t.zoom ?? 1 }))
    : [makeTab('about:blank', PROFILES[0]!.key)];
  return { tabs, activeId: tabs[Math.min(Math.max(saved?.active ?? 0, 0), tabs.length - 1)]!.id };
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  ...restore(),
  split: null,
  closed: [],
  history: read<HistoryEntry[]>(HISTORY_KEY, []),
  bookmarks: read<Bookmark[]>(BOOKMARKS_KEY, []),
  toggleBookmarkOfActive: () => {
    const tab = get().tabs.find(t => t.id === get().activeId);
    if (!tab) return;
    const bookmarks = toggleBookmark(get().bookmarks, tab.url, tab.title);
    set({ bookmarks });
    write(BOOKMARKS_KEY, bookmarks);
  },
  removeBookmark: url => {
    const bookmarks = get().bookmarks.filter(b => b.url !== url);
    set({ bookmarks });
    write(BOOKMARKS_KEY, bookmarks);
  },
  findOpen: false,
  addressFocus: 0,

  newTab: (input, profile) => {
    const url = input ? toNavigableUrl(input) : 'about:blank';
    const tab = makeTab(url, profile ?? get().tabs.find(t => t.id === get().activeId)?.profile ?? PROFILES[0]!.key);
    set(state => ({ tabs: [...state.tabs, tab], activeId: tab.id, split: null, findOpen: false,
      addressFocus: url === 'about:blank' ? state.addressFocus + 1 : state.addressFocus }));
    return tab.id;
  },

  closeTab: id => {
    const { tabs, activeId, split, closed } = get();
    const index = tabs.findIndex(t => t.id === id);
    if (index < 0) return;
    const gone = tabs[index]!;
    const rest = tabs.filter(t => t.id !== id);
    if (!rest.length) {
      // Closing the last tab leaves a fresh start page, like a browser window that stays open.
      const blank = makeTab('about:blank', gone.profile);
      set({ tabs: [blank], activeId: blank.id, split: null, closed: [gone, ...closed].slice(0, MAX_CLOSED) });
      return;
    }
    const nextActive = id === activeId ? rest[Math.min(index, rest.length - 1)]!.id : activeId;
    set({ tabs: rest, activeId: nextActive, split: split?.includes(id) ? null : split,
      closed: [gone, ...closed].slice(0, MAX_CLOSED) });
  },

  reopenTab: () => {
    const [last, ...closed] = get().closed;
    if (!last) return;
    const tab = { ...makeTab(last.url, last.profile), title: last.title, zoom: last.zoom };
    set(state => ({ tabs: [...state.tabs, tab], activeId: tab.id, closed, split: null }));
  },

  activate: id => set(state => ({
    activeId: id,
    split: state.split && !state.split.includes(id) ? null : state.split,
    findOpen: id === state.activeId ? state.findOpen : false
  })),

  activateIndex: n => {
    const tabs = get().tabs;
    const tab = n >= 9 ? tabs[tabs.length - 1] : tabs[n - 1];
    if (tab) get().activate(tab.id);
  },

  cycle: direction => {
    const { tabs, activeId } = get();
    const i = tabs.findIndex(t => t.id === activeId);
    get().activate(tabs[(i + direction + tabs.length) % tabs.length]!.id);
  },

  update: (id, patch) => set(state => ({ tabs: state.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)) })),

  record: (url, title) => {
    if (!/^https?:/.test(url)) return;
    set(state => {
      const rest = state.history.filter(h => h.url !== url);
      return { history: [{ url, title: title || fallbackTitle(url), at: Date.now() }, ...rest].slice(0, MAX_HISTORY) };
    });
  },

  /**
   * Side by side: the current page next to the same URL in the next profile, so two roles (say, admin and
   * customer) can be compared at once. Turning it off keeps both tabs.
   */
  toggleSplit: () => {
    const { split, tabs, activeId } = get();
    if (split) {
      set({ split: null });
      return;
    }
    const active = tabs.find(t => t.id === activeId)!;
    const next = PROFILES[(PROFILES.findIndex(p => p.key === active.profile) + 1) % PROFILES.length]!;
    const twin = makeTab(active.url, next.key);
    set({ tabs: [...tabs, twin], split: [active.id, twin.id] });
  },

  setFindOpen: findOpen => set({ findOpen }),
  focusAddress: () => set(state => ({ addressFocus: state.addressFocus + 1 }))
}));

// Remember the session and history (debounced; only what's needed to restore).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useBrowserStore.subscribe(state => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    write(SESSION_KEY, {
      tabs: state.tabs.map(t => ({ url: t.url, title: t.title, profile: t.profile, zoom: t.zoom })),
      active: Math.max(0, state.tabs.findIndex(t => t.id === state.activeId))
    });
    write(HISTORY_KEY, state.history);
  }, 400);
});

export const profileName = (key: string) => PROFILES.find(p => p.key === key)?.name ?? key;
