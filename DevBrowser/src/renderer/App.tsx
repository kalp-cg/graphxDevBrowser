import React, { Suspense, lazy, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { ToolDock } from './components/layout/ToolDock';
import { TabStrip } from './components/browser/TabStrip';
import { Toolbar } from './components/browser/Toolbar';
import { BrowserArea } from './components/browser/BrowserArea';
import { CommandPalette } from './components/common/CommandPalette';
import { ShortcutsModal } from './components/common/ShortcutsModal';
import { ToastContainer } from './components/common/ToastContainer';
import { useAppStore } from './store/useAppStore';
import { useBrowserStore } from './store/useBrowserStore';
import { FULL_PAGE_VIEWS, useNarrow } from './useNarrow';
import { startDevServerWatch } from './browser/devServerWatch';
import { startRunListener } from './store/useRunStore';
import { startMockSync } from './store/useMockStore';
import { emulate, goBack, goForward, reload, toggleDevTools, zoom } from './browser/pages';
import { DEVICES, SEARCH_URL } from '../shared/domain/browser';
import type { BrowserCommand } from '../shared/ipc-channels';

// Each tool is its own chunk, loaded when first opened (the graph library alone is a third of the bundle).
const view = (load: () => Promise<Record<string, React.ComponentType>>, name: string) =>
  lazy(() => load().then(m => ({ default: m[name]! })));
const RunView = view(() => import('./components/views/RunView'), 'RunView');
const ConsoleView = view(() => import('./components/views/ConsoleView'), 'ConsoleView');
const NetworkView = view(() => import('./components/views/NetworkView'), 'NetworkView');
const ApiClientView = view(() => import('./components/views/ApiClientView'), 'ApiClientView');
const SecurityView = view(() => import('./components/views/SecurityView'), 'SecurityView');
const RecorderView = view(() => import('./components/views/RecorderView'), 'RecorderView');
const DependencyView = view(() => import('./components/views/DependencyView'), 'DependencyView');
const AIAssistantView = view(() => import('./components/views/AIAssistantView'), 'AIAssistantView');
const SettingsView = view(() => import('./components/views/SettingsView'), 'SettingsView');

/** Menu shortcuts, page popups and context-menu actions, all routed here from the main process. */
function runCommand(command: BrowserCommand, arg?: string): void {
  const browser = useBrowserStore.getState();
  const app = useAppStore.getState();
  const active = browser.tabs.find(t => t.id === browser.activeId);
  switch (command) {
    case 'new-tab': browser.newTab(); break;
    case 'open-tab': if (arg) browser.newTab(arg); break;
    case 'search': if (arg) browser.newTab(SEARCH_URL + encodeURIComponent(arg)); break;
    case 'close-tab': browser.closeTab(browser.activeId); break;
    case 'reopen-tab': browser.reopenTab(); break;
    case 'bookmark': browser.toggleBookmarkOfActive(); break;
    case 'select-tab': browser.activateIndex(Number(arg)); break;
    case 'next-tab': browser.cycle(1); break;
    case 'prev-tab': browser.cycle(-1); break;
    case 'focus-address': browser.focusAddress(); break;
    case 'reload': reload(); break;
    case 'hard-reload': reload(undefined, true); break;
    case 'back': goBack(); break;
    case 'forward': goForward(); break;
    case 'find': browser.setFindOpen(true); break;
    case 'zoom-in': zoom(1); break;
    case 'zoom-out': zoom(-1); break;
    case 'zoom-reset': zoom(0); break;
    case 'toggle-device':
      if (active) void emulate(active.id, active.device ? null : DEVICES[1]!.id);
      break;
    case 'toggle-split': browser.toggleSplit(); break;
    case 'toggle-panel': app.togglePanel(); break;
    case 'page-devtools': toggleDevTools(); break;
    case 'command-palette': app.setCommandPaletteOpen(true); break;
  }
}

const PANELS: Record<string, React.ComponentType> = {
  run: RunView,
  console: ConsoleView,
  network: NetworkView,
  apiClient: ApiClientView,
  security: SecurityView,
  recorder: RecorderView,
  dependencies: DependencyView,
  ai: AIAssistantView,
  settings: SettingsView
};

export const App: React.FC = () => {
  const activeView = useAppStore(s => s.activeView);
  const panelMaximized = useAppStore(s => s.panelMaximized);
  const Panel = PANELS[activeView];
  const narrow = useNarrow();

  useEffect(() => {
    const app = useAppStore.getState();
    let unsubscribeNetwork: (() => void) | undefined;
    let unsubscribeCommands: (() => void) | undefined;
    let metricsInterval: ReturnType<typeof setInterval> | undefined;
    let stopWatch: (() => void) | undefined;
    let stopRun: (() => void) | undefined;
    let stopMocks: (() => void) | undefined;

    if (window.devBrowserAPI) {
      window.devBrowserAPI.system.getHardwareMetrics().then(app.setHardwareMetrics).catch(console.error);
      app.checkOllama();
      // Reconnect to SentinelGraph if it was configured on an earlier launch (token stays in the main process)
      app.restoreSentinel().catch(console.error);
      metricsInterval = setInterval(() => {
        window.devBrowserAPI?.system.getHardwareMetrics().then(useAppStore.getState().setHardwareMetrics).catch(console.error);
      }, 8000);

      unsubscribeNetwork = window.devBrowserAPI.network.onStreamTransaction(tx => {
        useAppStore.getState().addTransaction(tx);
        window.devBrowserAPI?.security.getFindings().then(findings => {
          if (findings.length > 0) useAppStore.getState().setFindings(findings);
        }).catch(console.error);
      });
      unsubscribeCommands = window.devBrowserAPI.browser.onCommand(runCommand);
      stopWatch = startDevServerWatch();
      stopRun = startRunListener();
      stopMocks = startMockSync();
    }

    // Shortcuts that are not in the app menu (the menu handles the rest, even while a page has focus).
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['input', 'textarea', 'select'].includes(target.tagName.toLowerCase()) || target.isContentEditable;
      const cmd = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      if (cmd && e.key === ',') {
        e.preventDefault();
        useAppStore.getState().setActiveView('settings');
      } else if (e.key === '?' && !typing) {
        e.preventDefault();
        useAppStore.getState().setShortcutsModalOpen(true);
      } else if (e.key === 'Escape' && useBrowserStore.getState().findOpen) {
        useBrowserStore.getState().setFindOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (metricsInterval) clearInterval(metricsInterval);
      unsubscribeNetwork?.();
      unsubscribeCommands?.();
      stopWatch?.();
      stopRun?.();
      stopMocks?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden',
      background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <TabStrip />
      <Toolbar />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <BrowserArea hidden={!!Panel && (panelMaximized || narrow || FULL_PAGE_VIEWS.has(activeView))} />
          {Panel && (
            <ToolDock>
              <Suspense fallback={<div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>}>
                <Panel />
              </Suspense>
            </ToolDock>
          )}
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <ShortcutsModal />
      <ToastContainer />
    </div>
  );
};

// The active tab's URL is what investigations and the AI assistant call "the current page".
useBrowserStore.subscribe(state => {
  const url = state.tabs.find(t => t.id === state.activeId)?.url ?? 'about:blank';
  if (useAppStore.getState().currentUrl !== url) useAppStore.getState().setCurrentUrl(url);
});

export default App;
