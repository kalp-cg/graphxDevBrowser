import type { HardwareMetrics } from '../shared/ipc-channels';
import type { BrowserTab, ProfilePartition } from '../shared/domain/browser';
import type { SecurityFinding } from '../shared/domain/security';
import type { ShredResult } from '../shared/domain/privacy';
import type { AIDebugContext, AICodeDiff } from '../shared/domain/ai';
import type { NetworkTransaction } from '../shared/domain/network';
import type {
  InvestigationEvidence,
  SentinelAction,
  SentinelBlastRadius,
  SentinelResolution,
  SentinelRun,
  SentinelSnapshot,
  SentinelStatus
} from '../shared/domain/sentinel';

export interface DevBrowserAPI {
  system: {
    getHardwareMetrics: () => Promise<HardwareMetrics>;
    checkOllamaStatus: () => Promise<{ ok: boolean; model: string; message?: string }>;
    checkTigerGraphStatus: (config?: { endpoint?: string; secret?: string; graphName?: string }) => Promise<{ ok: boolean; message: string; statusCode?: number; providerType?: string }>;
    executeTigerGraphQuery: (args: { endpoint: string; queryPath: string; method?: 'GET' | 'POST'; secret?: string; body?: unknown }) => Promise<{ ok: boolean; data: unknown; status: number; durationMs: number; error?: string }>;
  };
  tabs: {
    createTab: (url: string, partitionKey?: string) => Promise<BrowserTab>;
    closeTab: (tabId: string) => Promise<void>;
    navigate: (tabId: string, url: string) => Promise<void>;
    getPartitions: () => Promise<ProfilePartition[]>;
  };
  network: {
    onStreamTransaction: (callback: (tx: NetworkTransaction) => void) => () => void;
  };
  ai: {
    executeDiagnosis: (context: AIDebugContext) => Promise<{ diagnosis: string; suggestedDiff?: AICodeDiff }>;
  };
  security: {
    getFindings: () => Promise<SecurityFinding[]>;
    clearFindings: () => Promise<void>;
  };
  sentinel: {
    configure: (baseUrl: string, adminToken: string) => Promise<SentinelStatus>;
    status: () => Promise<SentinelStatus>;
    getGraph: () => Promise<SentinelSnapshot>;
    blastRadius: (service: string) => Promise<SentinelBlastRadius>;
    startInvestigation: (question?: string, evidence?: InvestigationEvidence[]) => Promise<{ run_id: string }>;
    restore: () => Promise<{ url: string; status: SentinelStatus } | null>;
    resolve: (url: string) => Promise<SentinelResolution>;
    currentRun: () => Promise<SentinelRun>;
    approveAction: (uid: string) => Promise<{ outcome: string; action: SentinelAction }>;
    rejectAction: (uid: string) => Promise<SentinelAction>;
  };
  privacy: {
    triggerNuclearShred: () => Promise<ShredResult>;
  };
}
