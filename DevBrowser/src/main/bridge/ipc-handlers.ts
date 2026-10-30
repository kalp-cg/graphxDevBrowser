import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import os from 'node:os';
import { IPC_CHANNELS, type HardwareMetrics } from '../../shared/ipc-channels';
import type { PartitionManager } from '../session/partition-manager';
import { PROFILES, type BrowserTab } from '../../shared/domain/browser';
import type { SecurityFinding } from '../../shared/domain/security';
import type { ShredResult } from '../../shared/domain/privacy';
import type { AIDebugContext } from '../../shared/domain/ai';
import { OllamaClient } from '../ai/ollama-client';
import { CredentialVault } from '../crypto/vault';
import { PassiveSecurityAuditor } from '../security/auditor';
import type { SentinelGraphClient } from '../integrations/sentinel-client';
import type { ChaosKind, InvestigationEvidence } from '../../shared/domain/sentinel';

const BROWSING_PARTITIONS = PROFILES.map(p => p.key);

let handlersRegistered = false;

export function registerIpcHandlers(
  partitionManager: PartitionManager,
  ollamaClient: OllamaClient,
  credentialVault: CredentialVault,
  securityAuditor: PassiveSecurityAuditor,
  sentinelClient: SentinelGraphClient
): void {
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  // 1. Hardware metrics
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_HARDWARE_METRICS, async (): Promise<HardwareMetrics> => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    // Every process of the app: main, UI renderer, GPU and each page. workingSetSize is in KB.
    const processMem = app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize * 1024, 0);

    return {
      totalUnifiedMemoryBytes: totalMem,
      freeUnifiedMemoryBytes: freeMem,
      appMemoryUsageBytes: processMem,
      cpuArchitecture: os.arch(),
      isAppleSilicon: os.arch() === 'arm64' && os.platform() === 'darwin'
    };
  });

  // 2. Ollama live health check
  ipcMain.handle(IPC_CHANNELS.SYSTEM_CHECK_OLLAMA_STATUS, async () => {
    const health = await ollamaClient.checkHealth();
    return {
      ok: health.ok,
      model: health.primaryModel,
      message: health.ok 
        ? `Connected to local daemon with ${health.models.length} model(s)` 
        : 'Ollama daemon not reachable on http://127.0.0.1:11434'
    };
  });

  // 3. TigerGraph live REST++ health probe (Supports TGCloud HTTPS and Self-Hosted HTTP)
  ipcMain.handle(IPC_CHANNELS.SYSTEM_CHECK_TIGERGRAPH_STATUS, async (_event, args?: { endpoint?: string; secret?: string; graphName?: string }) => {
    let rawEndpoint = (args?.endpoint || 'http://127.0.0.1:9000').trim().replace(/\/$/, '');
    if (!rawEndpoint.startsWith('http://') && !rawEndpoint.startsWith('https://')) {
      rawEndpoint = `https://${rawEndpoint}`;
    }
    const isTgCloud = rawEndpoint.includes('tgcloud.io');
    const secret = args?.secret?.trim();

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*'
      };
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }

      let res: Response | null = null;
      try {
        res = await fetch(`${rawEndpoint}/restpp/echo`, {
          signal: AbortSignal.timeout(4000),
          headers
        });
      } catch {
        // fallback to /echo
      }

      if (!res || res.status === 404) {
        try {
          res = await fetch(`${rawEndpoint}/echo`, {
            signal: AbortSignal.timeout(4000),
            headers
          });
        } catch {
          // network error
        }
      }

      if (res && res.status === 200) {
        return {
          ok: true,
          statusCode: 200,
          providerType: isTgCloud ? 'tgcloud' : 'self-hosted',
          message: isTgCloud 
            ? `Connected to TigerGraph Cloud (${new URL(rawEndpoint).hostname})`
            : 'TigerGraph REST++ is online and ready (HTTP 200 OK)'
        };
      } else if (res && res.status === 502) {
        return {
          ok: false,
          statusCode: 502,
          message: 'HTTP 502 Bad Gateway: NGINX is online, but RESTPP/GSE engines are warming up or waiting for license (gadmin license set).'
        };
      } else if (res && (res.status === 401 || res.status === 403)) {
        return {
          ok: false,
          statusCode: res.status,
          message: `HTTP ${res.status} Authentication Failed. Check your TGCloud API Token or Secret.`
        };
      } else if (res) {
        return {
          ok: false,
          statusCode: res.status,
          message: `TigerGraph returned HTTP ${res.status} ${res.statusText}`
        };
      } else {
        return {
          ok: false,
          message: 'Could not reach TigerGraph endpoint. Verify host URL.'
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('aborted') || msg.includes('timeout')) {
        return { ok: false, message: 'Connection timed out after 4000ms. Check endpoint URL or network access.' };
      }
      return { ok: false, message: `Connection error: ${msg}. Verify host URL.` };
    }
  });

  // 4. TigerGraph query execution (REST++ / GSQL)
  ipcMain.handle(IPC_CHANNELS.TIGERGRAPH_EXECUTE_QUERY, async (_event, args: {
    endpoint: string;
    queryPath: string;
    method?: 'GET' | 'POST';
    secret?: string;
    body?: unknown;
  }) => {
    let rawEndpoint = (args.endpoint || 'http://127.0.0.1:9000').trim().replace(/\/$/, '');
    if (!rawEndpoint.startsWith('http://') && !rawEndpoint.startsWith('https://')) {
      rawEndpoint = `https://${rawEndpoint}`;
    }
    const cleanPath = args.queryPath.startsWith('/') ? args.queryPath : `/${args.queryPath}`;
    const targetUrl = `${rawEndpoint}${cleanPath}`;
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*'
      };
      if (args.secret?.trim()) {
        headers['Authorization'] = `Bearer ${args.secret.trim()}`;
      }
      if (args.body && args.method === 'POST') {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(targetUrl, {
        method: args.method || 'GET',
        headers,
        body: args.body && args.method === 'POST' ? JSON.stringify(args.body) : undefined,
        signal: AbortSignal.timeout(8000)
      });

      const durationMs = Date.now() - startTime;
      const text = await res.text();
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(text);
      } catch {
        parsedData = text;
      }

      return {
        ok: res.ok,
        status: res.status,
        durationMs,
        data: parsedData,
        error: !res.ok ? `HTTP ${res.status}: ${res.statusText}` : undefined
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 0,
        durationMs,
        data: null,
        error: `Query error: ${msg}`
      };
    }
  });

  // 5. SentinelGraph: the TigerGraph-backed dependency graph.
  ipcMain.handle(IPC_CHANNELS.SENTINEL_CONFIGURE, async (_event, args: { baseUrl: string }) => {
    sentinelClient.configure(args.baseUrl);
    return sentinelClient.status();
  });

  ipcMain.handle(IPC_CHANNELS.SENTINEL_STATUS, async () => sentinelClient.status());

  ipcMain.handle(IPC_CHANNELS.SENTINEL_GET_GRAPH, async () => {
    await sentinelClient.flush(); // include what was just captured
    return sentinelClient.getGraph();
  });

  ipcMain.handle(IPC_CHANNELS.SENTINEL_BLAST_RADIUS, async (_event, args: { service: string }) =>
    sentinelClient.blastRadius(args.service));

  ipcMain.handle(IPC_CHANNELS.SENTINEL_START_INVESTIGATION,
    async (_event, args?: { question?: string; evidence?: InvestigationEvidence[] }) => {
      await sentinelClient.flush(); // the graph should include what led up to the failure
      return sentinelClient.startInvestigation(args?.question, args?.evidence ?? []);
    });

  // Reconnect with the saved connection: the URL comes back, the token never leaves the main process.
  ipcMain.handle(IPC_CHANNELS.SENTINEL_RESTORE, async () => {
    if (!sentinelClient.restore()) return null;
    return { url: sentinelClient.url, status: await sentinelClient.status() };
  });

  ipcMain.handle(IPC_CHANNELS.SENTINEL_RESOLVE, async (_event, args: { url: string }) =>
    sentinelClient.resolve(args.url));

  // The folder is chosen in a native dialog, so the renderer never supplies an arbitrary path to read.
  ipcMain.handle(IPC_CHANNELS.SENTINEL_SCAN_CODEBASE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Choose your codebase', properties: ['openDirectory' as const] };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return null;
    return sentinelClient.scanCodebase(picked.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.SENTINEL_BREAK_SERVICE, async (_event, args: { service: string; kind: ChaosKind }) =>
    sentinelClient.breakService(args.service, args.kind));

  ipcMain.handle(IPC_CHANNELS.SENTINEL_RESTORE_HEALTHY, async () => sentinelClient.restoreHealthy());

  ipcMain.handle(IPC_CHANNELS.SENTINEL_CURRENT_RUN, async () => sentinelClient.currentRun());

  ipcMain.handle(IPC_CHANNELS.SENTINEL_APPROVE_ACTION, async (_event, args: { uid: string }) =>
    sentinelClient.approveAction(args.uid));

  ipcMain.handle(IPC_CHANNELS.SENTINEL_REJECT_ACTION, async (_event, args: { uid: string }) =>
    sentinelClient.rejectAction(args.uid));

  // 3. AI Execution & Diagnosis
  ipcMain.handle(IPC_CHANNELS.AI_EXECUTE_DIAGNOSIS, async (_event, args: { context: AIDebugContext }) => {
    try {
      return await ollamaClient.diagnoseContext(args.context);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown AI error';
      return {
        diagnosis: `Local AI Error: ${msg}. Make sure Ollama is running ('ollama serve').`
      };
    }
  });

  // 4. Tab management
  ipcMain.handle(IPC_CHANNELS.TABS_CREATE, async (_event, args: { url: string; partitionKey?: string }): Promise<BrowserTab> => {
    const partition = partitionManager.getPartition(args.partitionKey || 'persist:dev-default') || partitionManager.getPartitions()[0]!;

    return {
      id: crypto.randomUUID(),
      partitionId: partition.id,
      url: args.url || 'http://localhost:3000',
      title: 'New Tab',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isPinned: false,
      hibernation: {
        isHibernated: false,
        lastUrl: args.url || 'http://localhost:3000'
      },
      activeSplitPane: 'main'
    };
  });

  ipcMain.handle(IPC_CHANNELS.TABS_LIST, async () => {
    return partitionManager.getPartitions();
  });

  ipcMain.handle(IPC_CHANNELS.TABS_CLOSE, async () => {
    return;
  });

  ipcMain.handle(IPC_CHANNELS.TABS_NAVIGATE, async () => {
    return;
  });

  // 5. Passive Security findings
  ipcMain.handle(IPC_CHANNELS.SECURITY_GET_FINDINGS, async (): Promise<SecurityFinding[]> => {
    return securityAuditor.getFindings();
  });

  ipcMain.handle(IPC_CHANNELS.SECURITY_CLEAR_FINDINGS, async () => {
    securityAuditor.clearFindings();
  });

  // 6. Clear browsing data: every profile's cookies, storage and cache, plus saved credentials and findings.
  ipcMain.handle(IPC_CHANNELS.PRIVACY_TRIGGER_NUCLEAR_SHRED, async (): Promise<ShredResult> => {
    const details: string[] = [];
    for (const key of BROWSING_PARTITIONS) {
      const ses = session.fromPartition(key);
      await ses.clearStorageData();
      await ses.clearCache();
      details.push(`${key}: cookies, storage and cache cleared`);
    }
    credentialVault.clearAllSecrets();
    securityAuditor.clearFindings();
    details.push('Saved credentials cleared', 'Security findings cleared');
    return { success: true, purgedItemsCount: BROWSING_PARTITIONS.length, timestamp: Date.now(), details };
  });
}
