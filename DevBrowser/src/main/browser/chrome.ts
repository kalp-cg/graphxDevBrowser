import { throttleConditions } from '../../shared/domain/browser';
import { clipboard, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';
import type { BrowserCommand, EmulatedDevice } from '../../shared/ipc-channels';

/** Sends a command to the renderer, which owns the tabs. */
export type CommandSink = (command: BrowserCommand, arg?: string) => void;

/**
 * The application menu. Its accelerators are how browser shortcuts work: a keydown listener in the UI never
 * sees keys typed while a page has focus, but the menu does. Every item routes to the renderer.
 */
export function installAppMenu(send: CommandSink, toggleAppDevTools: () => void): void {
  const cmd = (label: string, command: BrowserCommand, accelerator?: string, arg?: string): MenuItemConstructorOptions =>
    ({ id: arg ? `${command}-${arg}` : command, label, accelerator, click: () => send(command, arg) });
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        cmd('New Tab', 'new-tab', 'CmdOrCtrl+T'),
        cmd('Reopen Closed Tab', 'reopen-tab', 'CmdOrCtrl+Shift+T'),
        cmd('Bookmark This Page', 'bookmark', 'CmdOrCtrl+D'),
        cmd('Open Location', 'focus-address', 'CmdOrCtrl+L'),
        { type: 'separator' },
        cmd('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
        ...(mac ? [] : [{ role: 'quit' } as MenuItemConstructorOptions])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        cmd('Reload', 'reload', 'CmdOrCtrl+R'),
        cmd('Hard Reload', 'hard-reload', 'CmdOrCtrl+Shift+R'),
        cmd('Find in Page', 'find', 'CmdOrCtrl+F'),
        { type: 'separator' },
        cmd('Zoom In', 'zoom-in', 'CmdOrCtrl+='),
        cmd('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
        cmd('Actual Size', 'zoom-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        cmd('Device Mode', 'toggle-device', 'CmdOrCtrl+Shift+M'),
        cmd('Split View', 'toggle-split', 'CmdOrCtrl+Shift+S'),
        cmd('Toggle Tool Panel', 'toggle-panel', 'CmdOrCtrl+\\'),
        { type: 'separator' },
        cmd('Developer Tools', 'page-devtools', mac ? 'Alt+Command+I' : 'Ctrl+Shift+I'),
        { label: 'DevBrowser Developer Tools', accelerator: mac ? 'Alt+Shift+Command+I' : 'Ctrl+Alt+Shift+I',
          click: toggleAppDevTools },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'History',
      submenu: [
        cmd('Back', 'back', 'CmdOrCtrl+['),
        cmd('Forward', 'forward', 'CmdOrCtrl+]')
      ]
    },
    {
      label: 'Window',
      submenu: [
        cmd('Next Tab', 'next-tab', 'Ctrl+Tab'),
        cmd('Previous Tab', 'prev-tab', 'Ctrl+Shift+Tab'),
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) =>
          cmd(i === 8 ? 'Last Tab' : `Tab ${i + 1}`, 'select-tab', `CmdOrCtrl+${i + 1}`, String(i + 1))),
        { type: 'separator' },
        cmd('Command Palette', 'command-palette', 'CmdOrCtrl+K'),
        { role: 'minimize' },
        ...(mac ? [{ role: 'front' } as MenuItemConstructorOptions] : [])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Permissions a page may have without asking. There is no prompt UI yet, so everything else is refused. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock']);
const hardenedSessions = new WeakSet<Electron.Session>();

/** Browser behaviour for a page in a <webview>: popups become tabs, a context menu, safe permissions. */
export function setupGuest(guest: WebContents, send: CommandSink): void {
  if (!hardenedSessions.has(guest.session)) {
    hardenedSessions.add(guest.session);
    guest.session.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
    guest.session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  }

  // window.open and target=_blank open as tabs in this window, never as bare Electron windows.
  guest.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^about:blank$/.test(url)) send('open-tab', url);
    return { action: 'deny' };
  });

  guest.on('context-menu', (_event, p) => {
    const items: MenuItemConstructorOptions[] = [];
    if (p.linkURL) {
      items.push({ label: 'Open Link in New Tab', click: () => send('open-tab', p.linkURL) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Open Image in New Tab', click: () => send('open-tab', p.srcURL) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy },
        { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' }, { type: 'separator' });
    } else if (p.selectionText.trim()) {
      const text = p.selectionText.trim();
      items.push({ role: 'copy' },
        { label: `Search for "${text.length > 24 ? `${text.slice(0, 24)}...` : text}"`, click: () => send('search', text) },
        { type: 'separator' });
    }
    items.push(
      { label: 'Back', enabled: guest.navigationHistory.canGoBack(), click: () => guest.navigationHistory.goBack() },
      { label: 'Forward', enabled: guest.navigationHistory.canGoForward(), click: () => guest.navigationHistory.goForward() },
      { label: 'Reload', click: () => guest.reload() },
      { type: 'separator' },
      { label: 'View Page Source', click: () => send('open-tab', `view-source:${guest.getURL()}`) },
      { label: 'Inspect Element', click: () => guest.inspectElement(p.x, p.y) }
    );
    Menu.buildFromTemplate(items).popup();
  });
}

/**
 * Device emulation: the renderer sizes the page's <webview> to the device (so the page really lays out at
 * that width, and paints correctly), and this adds what sizing can't: the device's user agent and touch input.
 * Emulation.setDeviceMetricsOverride is deliberately not used: inside a <webview> it changes the layout the
 * page reports but not what the compositor paints, so the page shows the desktop layout clipped. Nor is
 * Emulation.setEmitTouchEventsForMouse: it leaks into the host window's input, and clicks on the app's own
 * controls stop completing (both seen on Electron 33).
 */
/** Slows or cuts a page's network the way DevTools' throttling does. Lasts until changed or the page is closed. */
export async function throttleNetwork(guest: WebContents, presetId: string): Promise<void> {
  const dbg = guest.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Network.enable');
  await dbg.sendCommand('Network.emulateNetworkConditions', throttleConditions(presetId));
}

export async function emulateDevice(guest: WebContents, device: EmulatedDevice | null): Promise<void> {
  const dbg = guest.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const touch = !!device?.mobile;
  await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await dbg.sendCommand('Emulation.setUserAgentOverride', {
    userAgent: device?.userAgent ?? guest.session.getUserAgent()
  });
}
