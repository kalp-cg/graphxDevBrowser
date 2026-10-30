import { app, BrowserWindow, ipcMain, nativeImage, shell, webContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvironment } from '../shared/env';
import { PartitionManager } from './session/partition-manager';
import { configureSecurityDirectives } from './security/cdp-security';
import { registerIpcHandlers, runner } from './bridge/ipc-handlers';
import { OllamaClient } from './ai/ollama-client';
import { CredentialVault } from './crypto/vault';
import { PassiveSecurityAuditor } from './security/auditor';
import { CDPNetworkInterceptor } from './network/cdp-interceptor';
import { MockEngine } from './network/mock-engine';
import { MOCK_HEADER, MockStateSchema } from '../shared/domain/mock';
import { SentinelGraphClient } from './integrations/sentinel-client';
import { toTrafficRecord } from '../shared/domain/sentinel';
import { IPC_CHANNELS, type BrowserCommand, type EmulatedDevice } from '../shared/ipc-channels';
import { emulateDevice, installAppMenu, setupGuest, throttleNetwork } from './browser/chrome';
import { log } from './logger';
import { loadWindowState, trackWindowState } from './window-state';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The name in the menu bar, the About panel and the dock, also when run from source.
app.setName('DevBrowser');
app.setAboutPanelOptions({
  applicationName: 'DevBrowser',
  applicationVersion: app.getVersion(),
  copyright: 'Copyright © 2026 SentinelGraph. MIT licence.',
  website: 'https://github.com/MahirPatel2005/graphxDevBrowser'
});

process.on('uncaughtException', err => log('error', 'uncaught exception', err));
process.on('unhandledRejection', reason => log('error', 'unhandled rejection', reason));

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
const mockEngine = new MockEngine();
let sentinelClient: SentinelGraphClient | null = null;

async function createWindow(): Promise<BrowserWindow> {
  const state = loadWindowState({ width: 1440, height: 960 });
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 640,
    minHeight: 500,
    title: 'DevBrowser',
    icon: path.join(__dirname, '../build/icon.png'),
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

  if (state.maximized) mainWindow.maximize();
  trackWindowState(mainWindow);

  // The app's own window never navigates: links in it open in the system browser, nothing replaces the interface.
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('error', `interface process gone: ${details.reason}`);
    if (details.reason !== 'clean-exit') mainWindow?.reload(); // recover without losing the window
  });
  mainWindow.on('unresponsive', () => log('warn', 'interface is not responding'));

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
    mockEngine.attach(guest);
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
  const envConfig = validateEnvironment({ ...process.env, NODE_ENV: process.env.NODE_ENV ?? (app.isPackaged ? 'production' : undefined) });
  // From source, the Dock would show Electron's own icon; an installed build already has ours, and this is harmless there.
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(path.join(__dirname, '../build/icon.png'));
    if (icon.isEmpty()) log('warn', 'dock icon not found');
    else app.dock?.setIcon(icon);
  }
  log('info', `DevBrowser ${app.getVersion()} starting (${envConfig.NODE_ENV}, ${process.platform} ${process.arch}, electron ${process.versions.electron})`);

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
    // A response a mock rule made up says nothing about the real system.
    const mocked = Object.keys(tx.responseHeaders ?? {}).some(k => k.toLowerCase() === MOCK_HEADER);
    if (!mocked && mainWindow && pageUrl !== mainWindow.webContents.getURL()) {
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
  ipcMain.handle(IPC_CHANNELS.BROWSER_THROTTLE,
    async (_event, args: { webContentsId: number; preset: string }) => {
      const guest = webContents.fromId(args.webContentsId);
      if (!guest || guest.hostWebContents !== mainWindow?.webContents) return { ok: false, error: 'not a page of this window' };
      try {
        await throttleNetwork(guest, args.preset);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  ipcMain.handle(IPC_CHANNELS.NETWORK_MOCK_SET, (event, raw: unknown) => {
    if (event.sender !== mainWindow?.webContents) return { ok: false, active: 0, error: 'not the app window' };
    const parsed = MockStateSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, active: 0, error: parsed.error.issues[0]?.message ?? 'invalid rules' };
    return { ok: true, active: mockEngine.setState(parsed.data) };
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

app.on('child-process-gone', (_event, details) => log('error', `${details.type} process gone: ${details.reason}`));

app.on('before-quit', () => {
  log('info', 'shutting down');
  sentinelClient?.dispose();
  runner?.stopAll();   // a dev server started from here must not outlive the app
});
