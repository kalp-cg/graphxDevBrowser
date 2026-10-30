import { app, BrowserWindow, dialog, ipcMain, net, session } from 'electron';
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
import type { ChaosKind, InvestigationEvidence, SandboxAction } from '../../shared/domain/sentinel';
import type { ApiSendRequest } from '../../shared/domain/api-client';
import { sendApiRequest } from '../network/api-client';
import { inspectFolder, killPid, portOwner, Runner } from '../run/runner';
import { COMMON_DEV_PORTS } from '../../shared/domain/run';
import net_ from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { parseDefaultBackend } from '../../shared/domain/default-backend';

/** The command being run for the developer, if any. Stopped when the app quits. */
export let runner: Runner | null = null;

/** Is something accepting connections on this port of this machine? */
const listening = (port: number): Promise<boolean> => new Promise(resolve => {
  const socket = net_.connect({ port, host: '127.0.0.1', timeout: 300 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
});

/** The local servers that are up, with the title of the page each one serves. */
async function scanPorts(): Promise<{ port: number; title: string; status: number }[]> {
  const open = (await Promise.all(COMMON_DEV_PORTS.map(async port => ((await listening(port)) ? port : 0)))).filter(Boolean);
  return Promise.all(open.map(async port => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(1500), headers: { Accept: 'text/html' } });
      const html = (await res.text()).slice(0, 20000);
      return { port, status: res.status, title: /<title[^>]*>([^<]{0,120})<\/title>/i.exec(html)?.[1]?.trim() ?? '' };
    } catch {
      return { port, status: 0, title: '' };
    }
  }));
}

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

  runner = new Runner(e => BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IPC_CHANNELS.RUN_EVENT, e)));
  ipcMain.handle(IPC_CHANNELS.RUN_START, async (_event, args: { command: string; cwd: string }) => {
    try {
      return { ok: true as const, ...runner!.start(args.command, args.cwd) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(IPC_CHANNELS.RUN_STOP, async (_event, args: { id: string }) => runner!.stop(args.id));
  ipcMain.handle(IPC_CHANNELS.RUN_PICK_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Choose the folder to run in', properties: ['openDirectory' as const] };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return picked.canceled || !picked.filePaths[0] ? null : picked.filePaths[0];
  });
  ipcMain.handle(IPC_CHANNELS.RUN_INSPECT, async (_event, args: { cwd: string }) => {
    try {
      return { ok: true as const, ...inspectFolder(args.cwd) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(IPC_CHANNELS.RUN_PORT_OWNER, async (_event, args: { port: number }) => portOwner(Number(args.port)));
  ipcMain.handle(IPC_CHANNELS.RUN_KILL_PID, async (_event, args: { pid: number }) => killPid(Number(args.pid)));
  ipcMain.handle(IPC_CHANNELS.BROWSER_SCAN_PORTS, async () => scanPorts());

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
    if (!sentinelClient.restore()) {
      // Never connected on this machine: an installer may ship with a hosted demo backend. It is used for the session, not saved.
      let shipped: string | null = null;
      try { shipped = parseDefaultBackend(fs.readFileSync(path.join(app.getAppPath(), 'default-backend.json'), 'utf8')); } catch { /* none shipped */ }
      if (!shipped) return null;
      sentinelClient.attach(shipped);
    }
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

  // The API client sends from here, not from the page, so CORS never gets in the way of testing your own API.
  ipcMain.handle(IPC_CHANNELS.API_SEND, async (_event, args: { request: ApiSendRequest }) =>
    sendApiRequest(args.request, net.fetch as unknown as typeof fetch));

  ipcMain.handle(IPC_CHANNELS.SENTINEL_BREAK_SERVICE, async (_event, args: { service: string; kind: ChaosKind; additive?: boolean }) =>
    sentinelClient.breakService(args.service, args.kind, args.additive));

  ipcMain.handle(IPC_CHANNELS.SENTINEL_ALIASES, async () => sentinelClient.aliases());

  // Is anything answering at this origin? Any HTTP response counts (a 500 is a server with a bug, not one that is gone).
  ipcMain.handle(IPC_CHANNELS.BROWSER_PROBE, async (_event, args: { origin: string }): Promise<{ up: boolean }> => {
    try {
      const res = await fetch(args.origin, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(2000) });
      void res.body?.cancel();
      return { up: true };
    } catch {
      return { up: false };
    }
  });
  ipcMain.handle(IPC_CHANNELS.SENTINEL_REPORT_DEV_SERVER,
    async (_event, args: { service: string; firing: boolean; address: string }) =>
      sentinelClient.reportDevServer(args.service, args.firing, args.address));
  ipcMain.handle(IPC_CHANNELS.SENTINEL_SANDBOX, async (_event, args: SandboxAction) => sentinelClient.sandbox(args));
  ipcMain.handle(IPC_CHANNELS.SENTINEL_IMPACT, async (_event, args?: { base?: string }) => sentinelClient.impact(args?.base));

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
