/** A page's console, as one list across tabs. */
export type ConsoleLevel = 'log' | 'warning' | 'error';

export interface ConsoleEntry {
  id: number;
  tabId: string;
  level: ConsoleLevel;
  message: string;
  source: string;
  line: number;
  at: number;
  /** How many identical messages in a row this stands for. */
  count: number;
}

/** Chromium's console levels: 0 verbose, 1 info/log, 2 warning, 3 error. */
export const levelOf = (n: number): ConsoleLevel => (n >= 3 ? 'error' : n === 2 ? 'warning' : 'log');

export const MAX_ENTRIES = 1000;

/** Add a message to the list: the same message again right after itself raises a counter instead of filling the list. */
export function append(list: ConsoleEntry[], e: Omit<ConsoleEntry, 'id' | 'count'>, nextId: number): ConsoleEntry[] {
  const last = list.at(-1);
  if (last && last.tabId === e.tabId && last.level === e.level && last.message === e.message && last.source === e.source && last.line === e.line) {
    return [...list.slice(0, -1), { ...last, count: last.count + 1, at: e.at }];
  }
  const next = [...list, { ...e, id: nextId, count: 1 }];
  return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
}

export interface ConsoleFilter {
  level: 'all' | 'error' | 'warning';
  tabId: string | null;
  text: string;
}

export function visible(list: ConsoleEntry[], f: ConsoleFilter): ConsoleEntry[] {
  const q = f.text.trim().toLowerCase();
  return list.filter(e =>
    (f.level === 'all' || e.level === f.level) &&
    (!f.tabId || e.tabId === f.tabId) &&
    (!q || e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)));
}

export const asText = (list: ConsoleEntry[]): string =>
  list.map(e => `[${new Date(e.at).toISOString()}] ${e.level.toUpperCase()} ${e.message}${e.source ? `  (${e.source}:${e.line})` : ''}${e.count > 1 ? `  x${e.count}` : ''}`).join('\n');
