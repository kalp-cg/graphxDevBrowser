import { localOrigin, originAddress, stepWatch, type DevServerWatch } from '../../shared/domain/devserver';
import { useAppStore } from '../store/useAppStore';
import { useBrowserStore } from '../store/useBrowserStore';
import { reload } from './pages';

const INTERVAL_MS = 3000;

/**
 * Watches every tab that shows a local page. When the server behind one stops answering the tab is marked, the developer is told, and
 * SentinelGraph is told too (an alert on the service that owns that address) so the map shows the crash the moment it happens. When the
 * server comes back the tab reloads itself and the alert is resolved.
 */
export function startDevServerWatch(): () => void {
  const watches = new Map<string, DevServerWatch>();
  let busy = false;

  const tick = async () => {
    if (busy || !window.devBrowserAPI) return;
    busy = true;
    try {
      const tabs = useBrowserStore.getState().tabs;
      const origins = [...new Set(tabs.map(t => localOrigin(t.url)).filter((o): o is string => !!o))];
      await Promise.all(origins.map(async origin => {
        const { up } = await window.devBrowserAPI!.browser.probe(origin);
        const { watch, event } = stepWatch(watches.get(origin) ?? { state: 'unknown', failures: 0 }, up);
        watches.set(origin, watch);
        const state = useBrowserStore.getState();
        for (const t of state.tabs) {
          if (localOrigin(t.url) === origin && t.devServer !== watch.state) state.update(t.id, { devServer: watch.state });
        }
        if (event) announce(origin, event);
      }));
    } finally {
      busy = false;
    }
  };

  const announce = (origin: string, event: 'went-down' | 'recovered') => {
    const app = useAppStore.getState();
    const address = originAddress(origin);
    const service = app.sentinelAliases[address];
    const down = event === 'went-down';
    app.addToast({
      type: down ? 'error' : 'info',
      title: down ? `${address} stopped responding` : `${address} is back`,
      message: down
        ? service ? `${service} crashed or was stopped. SentinelGraph has been told.` : 'The dev server crashed or was stopped.'
        : 'Reloading the tab.'
    });
    if (!down) {
      for (const t of useBrowserStore.getState().tabs) if (localOrigin(t.url) === origin) reload(t.id);
    }
    if (service && app.sentinelStatus === 'connected') {
      void window.devBrowserAPI!.sentinel.reportDevServer(service, down, address)
        .then(() => app.refreshSentinelGraph())
        .catch(() => undefined);
    }
  };

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(timer);
}
