import React, { useEffect } from 'react';
import { TopNavBar } from './components/layout/TopNavBar';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { BrowserView } from './components/views/BrowserView';
import { NetworkView } from './components/views/NetworkView';
import { ApiClientView } from './components/views/ApiClientView';
import { SecurityView } from './components/views/SecurityView';
import { DependencyView } from './components/views/DependencyView';
import { AIAssistantView } from './components/views/AIAssistantView';
import { SettingsView } from './components/views/SettingsView';
import { CommandPalette } from './components/common/CommandPalette';
import { ShortcutsModal } from './components/common/ShortcutsModal';
import { ToastContainer } from './components/common/ToastContainer';
import { useAppStore } from './store/useAppStore';

export const App: React.FC = () => {
  const activeView = useAppStore(s => s.activeView);
  const setActiveView = useAppStore(s => s.setActiveView);
  const setCommandPaletteOpen = useAppStore(s => s.setCommandPaletteOpen);
  const setShortcutsModalOpen = useAppStore(s => s.setShortcutsModalOpen);
  const setHardwareMetrics = useAppStore(s => s.setHardwareMetrics);
  const checkOllama = useAppStore(s => s.checkOllama);
  const createNewTab = useAppStore(s => s.createNewTab);
  const closeTab = useAppStore(s => s.closeTab);
  const activeTabId = useAppStore(s => s.activeTabId);

  useEffect(() => {
    let unsubscribeNetwork: (() => void) | undefined;
    let metricsInterval: NodeJS.Timeout | undefined;

    // 1. Initial IPC checks & subscriptions
    if (window.devBrowserAPI) {
      window.devBrowserAPI.system.getHardwareMetrics().then(setHardwareMetrics).catch(console.error);
      checkOllama();

      // Auto-connect to SentinelGraph from saved URL
      const { sentinelUrl, sentinelStatus, connectSentinel } = useAppStore.getState();
      if (sentinelUrl && sentinelStatus === 'disconnected') {
        connectSentinel(sentinelUrl, '').catch(console.error);
      }

      // Poll hardware metrics every 8 seconds
      metricsInterval = setInterval(() => {
        window.devBrowserAPI?.system.getHardwareMetrics().then(setHardwareMetrics).catch(console.error);
      }, 8000);

      // Subscribe to live CDP network stream
      unsubscribeNetwork = window.devBrowserAPI.network.onStreamTransaction((tx) => {
        useAppStore.getState().addTransaction(tx);

        // Fetch refreshed security audit findings
        window.devBrowserAPI?.security.getFindings().then(findings => {
          if (findings && findings.length > 0) {
            useAppStore.getState().setFindings(findings);
          }
        }).catch(console.error);
      });
    }

    // 2. Global Keyboard Shortcuts Listener
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;

      // Cmd+K: Command Palette
      if (cmdKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // ?: Shortcuts Modal (when not typing in an input)
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setShortcutsModalOpen(true);
        return;
      }

      // Cmd+,: Open Settings
      if (cmdKey && e.key === ',') {
        e.preventDefault();
        setActiveView('settings');
        return;
      }

      // Cmd+T: New Tab
      if (cmdKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        createNewTab();
        return;
      }

      // Cmd+W: Close Tab
      if (cmdKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeTab(activeTabId);
        return;
      }

      // View Switching: Cmd+1 through Cmd+6
      if (cmdKey && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault();
        const viewMap: Record<string, typeof activeView> = {
          '1': 'browser',
          '2': 'network',
          '3': 'apiClient',
          '4': 'security',
          '5': 'dependencies',
          '6': 'ai'
        };
        const nextView = viewMap[e.key];
        if (nextView) setActiveView(nextView);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      if (metricsInterval) clearInterval(metricsInterval);
      if (unsubscribeNetwork) unsubscribeNetwork();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTabId, checkOllama, closeTab, createNewTab, setActiveView, setCommandPaletteOpen, setHardwareMetrics, setShortcutsModalOpen]);

  const renderActiveView = () => {
    switch (activeView) {
      case 'browser':
        return <BrowserView />;
      case 'network':
        return <NetworkView />;
      case 'apiClient':
        return <ApiClientView />;
      case 'security':
        return <SecurityView />;
      case 'dependencies':
        return <DependencyView />;
      case 'ai':
        return <AIAssistantView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <BrowserView />;
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      overflow: 'hidden'
    }}>
      {/* Top Application Bar & Tabs */}
      <TopNavBar />

      {/* Main Center Area: Left Sidebar + Center View */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden'
      }}>
        <Sidebar />
        <main style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative'
        }}>
          {renderActiveView()}
        </main>
      </div>

      {/* Bottom Hardware Telemetry & Provider Status Bar */}
      <StatusBar />

      {/* Overlays & Modals */}
      <CommandPalette />
      <ShortcutsModal />
      <ToastContainer />
    </div>
  );
};

export default App;
