import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type BrowserCommand, type EmulatedDevice } from '../shared/ipc-channels';
import type { DevBrowserAPI } from './api';
import type { RunEvent } from '../shared/domain/run';
import type { AIDebugContext } from '../shared/domain/ai';
import type { NetworkTransaction } from '../shared/domain/network';
import type { MockHit, MockState } from '../shared/domain/mock';
import type { InvestigationEvidence } from '../shared/domain/sentinel';
import type { ApiSendRequest } from '../shared/domain/api-client';

const devBrowserAPI: DevBrowserAPI = {
  system: {
    getHardwareMetrics: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_HARDWARE_METRICS),
    checkOllamaStatus: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_CHECK_OLLAMA_STATUS)
  },
  tabs: {
    createTab: (url: string, partitionKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TABS_CREATE, { url, partitionKey }),
    closeTab: (tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TABS_CLOSE, { tabId }),
    navigate: (tabId: string, url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TABS_NAVIGATE, { tabId, url }),
    getPartitions: () =>
      ipcRenderer.invoke(IPC_CHANNELS.TABS_LIST)
  },
  network: {
    setMocks: (state: MockState) => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_MOCK_SET, state),
    onMockHit: (callback: (hit: MockHit) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, hit: MockHit) => callback(hit);
      ipcRenderer.on(IPC_CHANNELS.NETWORK_MOCK_HIT, listener);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.NETWORK_MOCK_HIT, listener); };
    },
    onStreamTransaction: (callback: (tx: NetworkTransaction) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, tx: NetworkTransaction) => callback(tx);
      ipcRenderer.on(IPC_CHANNELS.NETWORK_STREAM_TRANSACTION, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.NETWORK_STREAM_TRANSACTION, listener);
      };
    }
  },
  ai: {
    executeDiagnosis: (context: AIDebugContext) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_EXECUTE_DIAGNOSIS, { context })
  },
  apiClient: {
    send: (request: ApiSendRequest) => ipcRenderer.invoke(IPC_CHANNELS.API_SEND, { request })
  },
  security: {
    getFindings: () => ipcRenderer.invoke(IPC_CHANNELS.SECURITY_GET_FINDINGS),
    clearFindings: () => ipcRenderer.invoke(IPC_CHANNELS.SECURITY_CLEAR_FINDINGS)
  },
  sentinel: {
    configure: (baseUrl: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_CONFIGURE, { baseUrl }),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_STATUS),
    getGraph: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_GET_GRAPH),
    blastRadius: (service: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_BLAST_RADIUS, { service }),
    startInvestigation: (question?: string, evidence?: InvestigationEvidence[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_START_INVESTIGATION, { question, evidence }),
    restore: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_RESTORE),
    resolve: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_RESOLVE, { url }),
    currentRun: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_CURRENT_RUN),
    approveAction: (uid: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_APPROVE_ACTION, { uid }),
    rejectAction: (uid: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_REJECT_ACTION, { uid }),
    scanCodebase: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_SCAN_CODEBASE),
    breakService: (service: string, kind: string, additive?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_BREAK_SERVICE, { service, kind, additive }),
    aliases: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_ALIASES),
    reportDevServer: (service: string, firing: boolean, address: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_REPORT_DEV_SERVER, { service, firing, address }),
    sandbox: (args: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_SANDBOX, args),
    impact: (base?: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_IMPACT, { base }),
    restoreHealthy: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_RESTORE_HEALTHY)
  },
  privacy: {
    triggerNuclearShred: () => ipcRenderer.invoke(IPC_CHANNELS.PRIVACY_TRIGGER_NUCLEAR_SHRED)
  },
  run: {
    start: (command: string, cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.RUN_START, { command, cwd }),
    stop: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.RUN_STOP, { id }),
    pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.RUN_PICK_FOLDER),
    inspect: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.RUN_INSPECT, { cwd }),
    portOwner: (port: number) => ipcRenderer.invoke(IPC_CHANNELS.RUN_PORT_OWNER, { port }),
    killPid: (pid: number) => ipcRenderer.invoke(IPC_CHANNELS.RUN_KILL_PID, { pid }),
    onEvent: (callback: (event: RunEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, e: RunEvent) => callback(e);
      ipcRenderer.on(IPC_CHANNELS.RUN_EVENT, listener);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.RUN_EVENT, listener); };
    }
  },
  browser: {
    scanPorts: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SCAN_PORTS),
    onCommand: (callback: (command: BrowserCommand, arg?: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, command: BrowserCommand, arg?: string) => callback(command, arg);
      ipcRenderer.on(IPC_CHANNELS.BROWSER_COMMAND, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_COMMAND, listener);
      };
    },
    emulate: (webContentsId: number, device: EmulatedDevice | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_EMULATE, { webContentsId, device }),
    probe: (origin: string) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_PROBE, { origin }),
    throttle: (webContentsId: number, preset: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_THROTTLE, { webContentsId, preset })
  }
};

contextBridge.exposeInMainWorld('devBrowserAPI', devBrowserAPI);
