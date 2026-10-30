import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { DevBrowserAPI } from './api';
import type { AIDebugContext } from '../shared/domain/ai';
import type { NetworkTransaction } from '../shared/domain/network';
import type { InvestigationEvidence } from '../shared/domain/sentinel';

const devBrowserAPI: DevBrowserAPI = {
  system: {
    getHardwareMetrics: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_HARDWARE_METRICS),
    checkOllamaStatus: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_CHECK_OLLAMA_STATUS),
    checkTigerGraphStatus: (config?: { endpoint?: string; secret?: string; graphName?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_CHECK_TIGERGRAPH_STATUS, config),
    executeTigerGraphQuery: (args: { endpoint: string; queryPath: string; method?: 'GET' | 'POST'; secret?: string; body?: unknown }) =>
      ipcRenderer.invoke(IPC_CHANNELS.TIGERGRAPH_EXECUTE_QUERY, args)
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
  security: {
    getFindings: () => ipcRenderer.invoke(IPC_CHANNELS.SECURITY_GET_FINDINGS),
    clearFindings: () => ipcRenderer.invoke(IPC_CHANNELS.SECURITY_CLEAR_FINDINGS)
  },
  sentinel: {
    configure: (baseUrl: string, adminToken: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_CONFIGURE, { baseUrl, adminToken }),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_STATUS),
    getGraph: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_GET_GRAPH),
    blastRadius: (service: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_BLAST_RADIUS, { service }),
    startInvestigation: (question?: string, evidence?: InvestigationEvidence[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_START_INVESTIGATION, { question, evidence }),
    restore: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_RESTORE),
    resolve: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_RESOLVE, { url }),
    currentRun: () => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_CURRENT_RUN),
    approveAction: (uid: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_APPROVE_ACTION, { uid }),
    rejectAction: (uid: string) => ipcRenderer.invoke(IPC_CHANNELS.SENTINEL_REJECT_ACTION, { uid })
  },
  privacy: {
    triggerNuclearShred: () => ipcRenderer.invoke(IPC_CHANNELS.PRIVACY_TRIGGER_NUCLEAR_SHRED)
  }
};

contextBridge.exposeInMainWorld('devBrowserAPI', devBrowserAPI);
