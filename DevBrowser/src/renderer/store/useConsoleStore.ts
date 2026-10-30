import { create } from 'zustand';
import { append, type ConsoleEntry, type ConsoleLevel } from '../../shared/domain/console';

interface ConsoleState {
  entries: ConsoleEntry[];
  next: number;
  push: (tabId: string, level: ConsoleLevel, message: string, source?: string, line?: number) => void;
  clear: (tabId?: string) => void;
}

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  next: 1,
  push: (tabId, level, message, source = '', line = 0) =>
    set(s => ({ entries: append(s.entries, { tabId, level, message, source, line, at: Date.now() }, s.next), next: s.next + 1 })),
  clear: tabId => set(s => ({ entries: tabId ? s.entries.filter(e => e.tabId !== tabId) : [] })),
}));
