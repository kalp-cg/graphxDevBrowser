import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvironment } from '../shared/env';
import { PartitionManager } from './session/partition-manager';
import { configureSecurityDirectives } from './security/cdp-security';
import { registerIpcHandlers } from './bridge/ipc-handlers';
import { OllamaClient } from './ai/ollama-client';
import { CredentialVault } from './crypto/vault';
import { PassiveSecurityAuditor } from './security/auditor';
import { CDPNetworkInterceptor } from './network/cdp-interceptor';
import { SentinelGraphClient } from './integrations/sentinel-client';
import { toTrafficRecord } from '../shared/domain/sentinel';
import { IPC_CHANNELS, type BrowserCommand, type EmulatedDevice } from '../shared/ipc-channels';
import { emulateDevice, installAppMenu, setupGuest } from './browser/chrome';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A separate profile directory (tests, or a second instance next to your everyday one).
if (process.env.DEVBROWSER_USER_DATA) app.setPath('userData', process.env.DEVBROWSER_USER_DATA);

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let partitionManager: PartitionManager | null = null;
let ollamaClient: OllamaClient | null = null;
let credentialVault: CredentialVault | null = null;
let securityAuditor: PassiveSecurityAuditor | null = null;
let cdpInterceptor: CDPNetworkInterceptor | null = null;
let sentinelClient: SentinelGraphClient | null = null;

async function createWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 640,
    minHeight: 700,
    title: 'Dev Browser',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a', // Slate 900
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true
    }
  });

  // Pages run in <webview>s with no access to Node or the app's preload, whatever the markup asks for.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (params.src && !/^(https?:|about:|data:|view-source:)/i.test(params.src)) event.preventDefault();
  });

  // Every page gets network interception (its API calls also feed SentinelGraph) and browser behaviour.
  // Only pages are intercepted: the app's own UI is not a page the developer is debugging.
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    cdpInterceptor?.attachToWebContents(guest, `webview-${guest.id}`);
    setupGuest(guest, sendCommand);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function sendCommand(command: BrowserCommand, arg?: string): void {
  mainWindow?.webContents.send(IPC_CHANNELS.BROWSER_COMMAND, command, arg);
}

app.whenReady().then(async () => {
  const envConfig = validateEnvironment();
  console.log(`[DevBrowser] Launching with environment: ${envConfig.NODE_ENV}`);

  partitionManager = new PartitionManager();
  ollamaClient = new OllamaClient(envConfig.OLLAMA_HOST, envConfig.DEFAULT_AI_MODEL);
  credentialVault = new CredentialVault();
  securityAuditor = new PassiveSecurityAuditor();
  // The SentinelGraph connection survives restarts; only the address is saved.
  const connectionFile = path.join(app.getPath('userData'), 'sentinelgraph.json');
  sentinelClient = new SentinelGraphClient(undefined, {
    load: () => {
      try {
        return JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
      } catch {
        return null;
      }
    },
    save: conn => fs.writeFileSync(connectionFile, JSON.stringify(conn), { mode: 0o600 })
  });
  const client = sentinelClient;
  cdpInterceptor = new CDPNetworkInterceptor(securityAuditor, (tx, pageUrl) => {
    // Only pages browsed in a <webview> describe the user's system; the app's own UI does not.
    if (mainWindow && pageUrl !== mainWindow.webContents.getURL()) {
      const rec = toTrafficRecord(tx, pageUrl);
      if (rec) client.record(rec);
    }
  });

  configureSecurityDirectives();
  installAppMenu(sendCommand, () => mainWindow?.webContents.toggleDevTools());
  ipcMain.handle(IPC_CHANNELS.BROWSER_EMULATE,
    async (_event, args: { webContentsId: number; device: EmulatedDevice | null }) => {
      const guest = webContents.fromId(args.webContentsId);
      // Only pages hosted by this window can be emulated.
      if (!guest || guest.hostWebContents !== mainWindow?.webContents) return { ok: false, error: 'not a page of this window' };
      try {
        await emulateDevice(guest, args.device);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  registerIpcHandlers(partitionManager, ollamaClient, credentialVault, securityAuditor, sentinelClient);

  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  console.log('[DevBrowser] Shutting down gracefully...');
  sentinelClient?.dispose();
});
