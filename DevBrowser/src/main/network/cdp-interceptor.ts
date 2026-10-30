import type { WebContents } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { NetworkTransaction } from '../../shared/domain/network';
import type { PassiveSecurityAuditor } from '../security/auditor';

/** Called for every finished request, with the URL of the page that made it. */
export type TransactionListener = (transaction: NetworkTransaction, pageUrl: string) => void;

export class CDPNetworkInterceptor {
  private activeWebContents: Set<number> = new Set();
  private pendingRequests: Map<string, Partial<NetworkTransaction>> = new Map();
  /** The top-level page each tab is on, updated when a navigation starts (before its first request is made). */
  private pages: Map<number, string> = new Map();
  private securityAuditor: PassiveSecurityAuditor;
  private onTransaction: TransactionListener | undefined;

  constructor(securityAuditor: PassiveSecurityAuditor, onTransaction?: TransactionListener) {
    this.securityAuditor = securityAuditor;
    this.onTransaction = onTransaction;
  }

  public attachToWebContents(webContents: WebContents, tabId: string): void {
    if (this.activeWebContents.has(webContents.id)) return;
    this.activeWebContents.add(webContents.id);
    this.pages.set(webContents.id, webContents.getURL());
    webContents.on('did-start-navigation', details => {
      if (details.isMainFrame && !details.isSameDocument) this.pages.set(webContents.id, details.url);
    });
    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.pages.set(webContents.id, url);
    });

    try {
      if (!webContents.debugger.isAttached()) {
        webContents.debugger.attach('1.3');
      }

      webContents.debugger.sendCommand('Network.enable', {
        maxPostDataSize: 10485760 // 10MB
      });

      webContents.debugger.on('message', (_event, method, params) => {
        this.handleCDPMessage(webContents, tabId, method, params);
      });

      webContents.on('destroyed', () => {
        this.activeWebContents.delete(webContents.id);
        this.pages.delete(webContents.id);
      });
    } catch (err) {
      console.warn(`[CDPNetworkInterceptor] Could not attach to webContents ${webContents.id}:`, err);
    }
  }

  private async handleCDPMessage(
    webContents: WebContents,
    tabId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    if (method === 'Network.requestWillBeSent') {
      const p = params as {
        requestId: string;
        request: {
          url: string;
          method: string;
          headers: Record<string, string>;
          postData?: string;
        };
        wallTime: number;
      };

      this.pendingRequests.set(p.requestId, {
        id: p.requestId,
        tabId,
        url: p.request.url,
        method: p.request.method,
        requestHeaders: p.request.headers,
        requestBody: p.request.postData,
        pageUrl: this.pages.get(webContents.id) ?? webContents.getURL(),
        startTime: Math.round(p.wallTime * 1000)
      });
    } else if (method === 'Network.responseReceived') {
      const p = params as {
        requestId: string;
        response: {
          url: string;
          status: number;
          statusText: string;
          headers: Record<string, string>;
          mimeType: string;
          protocol?: string;
          timing?: NetworkTransaction['timing'];
        };
      };

      const pending = this.pendingRequests.get(p.requestId) || {
        id: p.requestId,
        tabId,
        url: p.response.url,
        method: 'GET',
        requestHeaders: {},
        pageUrl: this.pages.get(webContents.id) ?? webContents.getURL(),
        startTime: Date.now()
      };

      pending.statusCode = p.response.status;
      pending.statusText = p.response.statusText;
      pending.responseHeaders = p.response.headers;
      pending.mimeType = p.response.mimeType;
      pending.protocol = p.response.protocol;
      pending.timing = p.response.timing;

      this.pendingRequests.set(p.requestId, pending);

      // Run passive security audit on HTTP response (not on one a mock rule made up: its headers describe nothing real)
      const mocked = Object.keys(p.response.headers ?? {}).some(k => k.toLowerCase() === 'x-devbrowser-mock');
      if (!mocked) this.securityAuditor.evaluateResponse({
        url: p.response.url,
        pageUrl: pending.pageUrl,
        method: pending.method || 'GET',
        statusCode: p.response.status,
        requestHeaders: pending.requestHeaders || {},
        responseHeaders: p.response.headers
      });
    } else if (method === 'Network.loadingFinished') {
      const p = params as { requestId: string; encodedDataLength: number };
      const pending = this.pendingRequests.get(p.requestId);

      if (pending) {
        pending.endTime = Date.now();
        pending.encodedBodyLength = p.encodedDataLength;

        // Attempt to fetch body if debugger is still attached
        try {
          if (webContents.debugger.isAttached() && pending.mimeType?.includes('json')) {
            const bodyResult = await webContents.debugger.sendCommand('Network.getResponseBody', {
              requestId: p.requestId
            }) as { body: string; base64Encoded: boolean };

            pending.responseBody = bodyResult.body;
          }
        } catch {
          // Body not available or already evicted by browser
        }

        const transaction = pending as NetworkTransaction;
        this.pendingRequests.delete(p.requestId);

        // Notify the UI via IPC. A <webview> guest reports to the window that hosts it, not to itself.
        const ui = webContents.hostWebContents ?? webContents;
        if (!ui.isDestroyed()) {
          ui.send(IPC_CHANNELS.NETWORK_STREAM_TRANSACTION, transaction);
        }
        if (!webContents.isDestroyed()) {
          this.onTransaction?.(transaction, transaction.pageUrl ?? webContents.getURL());
        }
      }
    }
  }
}
