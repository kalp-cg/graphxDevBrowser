import type { RunEvent } from '../shared/domain/run';
import type { BrowserCommand, EmulatedDevice, HardwareMetrics } from '../shared/ipc-channels';
import type { BrowserTab, ProfilePartition } from '../shared/domain/browser';
import type { SecurityFinding } from '../shared/domain/security';
import type { ShredResult } from '../shared/domain/privacy';
import type { ApiSendRequest, ApiSendResult } from '../shared/domain/api-client';
import type { AIDebugContext, AICodeDiff } from '../shared/domain/ai';
import type { NetworkTransaction } from '../shared/domain/network';
import type {
  InvestigationEvidence,
  ChaosKind,
  ChaosResult,
  CodebaseScanResult,
  ImpactResult,
  SandboxAction,
  SandboxState,
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
  apiClient: {
    /** Sends from the main process; never throws: a failure is a result with `ok: false` and an `error`. */
    send: (request: ApiSendRequest) => Promise<ApiSendResult>;
  };
  security: {
    getFindings: () => Promise<SecurityFinding[]>;
    clearFindings: () => Promise<void>;
  };
  sentinel: {
    configure: (baseUrl: string) => Promise<SentinelStatus>;
    status: () => Promise<SentinelStatus>;
    getGraph: () => Promise<SentinelSnapshot>;
    blastRadius: (service: string) => Promise<SentinelBlastRadius>;
    startInvestigation: (question?: string, evidence?: InvestigationEvidence[]) => Promise<{ run_id: string }>;
    restore: () => Promise<{ url: string; status: SentinelStatus } | null>;
    resolve: (url: string) => Promise<SentinelResolution>;
    currentRun: () => Promise<SentinelRun>;
    approveAction: (uid: string) => Promise<{ outcome: string; action: SentinelAction }>;
    rejectAction: (uid: string) => Promise<SentinelAction>;
    /** Opens a folder dialog and scans the chosen repository; null if cancelled. */
    scanCodebase: () => Promise<CodebaseScanResult | null>;
    /** Simulate a failure of a service in the graph. */
    breakService: (service: string, kind: ChaosKind, additive?: boolean) => Promise<ChaosResult>;
    /** The addresses each service answers on (`localhost:3000` is `app`). */
    aliases: () => Promise<Record<string, string>>;
    /** Which services the connected project's uncommitted changes touch, and what depends on them. */
    /** The 38-service test company and the exam that checks whether an agent finds what was broken in it. */
    /** Tell SentinelGraph a dev server stopped (firing) or came back, on the service that owns that address. */
    reportDevServer: (service: string, firing: boolean, address: string) => Promise<unknown>;
    sandbox: (args: SandboxAction) => Promise<SandboxState | unknown>;
    impact: (base?: string) => Promise<ImpactResult>;
    restoreHealthy: () => Promise<unknown>;
  };
  privacy: {
    triggerNuclearShred: () => Promise<ShredResult>;
  };
  run: {
    /** Run a command in a folder, like a terminal there. Output arrives through `onEvent`. */
    start: (command: string, cwd: string) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
    stop: (id: string) => Promise<void>;
    pickFolder: () => Promise<string | null>;
    inspect: (cwd: string) => Promise<{ ok: true; name: string; suggestions: { label: string; command: string }[] } | { ok: false; error: string }>;
    portOwner: (port: number) => Promise<{ pid: number; name: string } | null>;
    killPid: (pid: number) => Promise<boolean>;
    onEvent: (callback: (event: RunEvent) => void) => () => void;
  };
  browser: {
    /** Local servers that are up on this machine, with the title of the page each serves. */
    scanPorts: () => Promise<{ port: number; title: string; status: number }[]>;
    onCommand: (callback: (command: BrowserCommand, arg?: string) => void) => () => void;
    emulate: (webContentsId: number, device: EmulatedDevice | null) => Promise<{ ok: boolean; error?: string }>;
    /** Slows or cuts one page's network (`none`, `fast-3g`, `slow-3g`, `offline`). */
    /** Is anything answering at this origin? */
    probe: (origin: string) => Promise<{ up: boolean }>;
    throttle: (webContentsId: number, preset: string) => Promise<{ ok: boolean; error?: string }>;
  };
}
