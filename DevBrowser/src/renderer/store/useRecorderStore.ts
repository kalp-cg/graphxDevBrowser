import { create } from 'zustand';
import type { Recording, Verdict } from '../../shared/domain/recording';

export type StepResult = 'pending' | 'ok' | 'missed' | 'skipped';

export interface ReplayState {
  status: 'idle' | 'running' | 'done' | 'cancelled';
  recordingId: string | null;
  tabId: string | null;
  /** Index into the replay plan of the step being performed. */
  index: number;
  results: StepResult[];
  verdict: Verdict | null;
  note: string;
}

export const IDLE_REPLAY: ReplayState = { status: 'idle', recordingId: null, tabId: null, index: 0, results: [], verdict: null, note: '' };
export const MAX_RECORDINGS = 20;

interface RecorderState {
  status: 'idle' | 'recording';
  tabId: string | null;
  startedAt: number;
  /** What has been captured so far, for the live counters. */
  live: { actions: number; requests: number; errors: number };
  /** Recordings made or opened in this session (a file is the way to keep one). */
  recordings: Recording[];
  selectedId: string | null;
  replay: ReplayState;
  set: (patch: Partial<Omit<RecorderState, 'set' | 'add' | 'remove'>>) => void;
  add: (r: Recording) => void;
  remove: (id: string) => void;
}

export const useRecorderStore = create<RecorderState>((set) => ({
  status: 'idle', tabId: null, startedAt: 0, live: { actions: 0, requests: 0, errors: 0 },
  recordings: [], selectedId: null, replay: IDLE_REPLAY,
  set: patch => set(patch),
  add: r => set(s => ({ recordings: [r, ...s.recordings.filter(x => x.id !== r.id)].slice(0, MAX_RECORDINGS), selectedId: r.id })),
  remove: id => set(s => ({ recordings: s.recordings.filter(r => r.id !== id), selectedId: s.selectedId === id ? null : s.selectedId }))
}));
