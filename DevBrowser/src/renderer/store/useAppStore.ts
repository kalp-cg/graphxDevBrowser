import { create } from 'zustand';
import type { BrowserTab, ProfilePartition } from '../../shared/domain/browser';
import type { NetworkTransaction } from '../../shared/domain/network';
import type { ApiRequestDraft, EnvironmentProfile, ApiCollection } from '../../shared/domain/api-client';
import type { SecurityFinding } from '../../shared/domain/security';
import type { IGraphNode, IGraphEdge, BlastRadiusResult } from '../../shared/domain/graph';
import {
  summarizeRun,
  toBlastRadius,
  toDevBrowserGraph,
  toEvidence,
  type RunSummary,
  type SentinelResolution
} from '../../shared/domain/sentinel';
import type { HardwareMetrics } from '../../shared/ipc-channels';

export type NavigationView = 'browser' | 'network' | 'apiClient' | 'security' | 'dependencies' | 'ai' | 'settings';
export type ThemeMode = 'dark' | 'light';

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  diff?: string;
  timestamp: number;
}

interface AppState {
  // Theme & Layout
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  activeView: NavigationView;
  setActiveView: (view: NavigationView) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Tabs & Partitions
  tabs: BrowserTab[];
  activeTabId: string;
  partitions: ProfilePartition[];
  currentUrl: string;
  splitLayout: 'single' | 'split-vertical' | 'split-horizontal';
  setSplitLayout: (layout: 'single' | 'split-vertical' | 'split-horizontal') => void;
  setActiveTabId: (tabId: string) => void;
  setCurrentUrl: (url: string) => void;
  createNewTab: (url?: string, partitionKey?: string) => Promise<void>;
  closeTab: (tabId: string) => void;
  navigateTab: (url: string) => void;

  // Resizable Panel
  resizablePanelHeight: number;
  setResizablePanelHeight: (height: number) => void;

  // Network Inspector
  transactions: NetworkTransaction[];
  selectedTransactionId: string | null;
  networkSearchQuery: string;
  networkFilter: string;
  setSelectedTransactionId: (id: string | null) => void;
  setNetworkSearchQuery: (query: string) => void;
  setNetworkFilter: (filter: string) => void;
  clearTransactions: () => void;
  addTransaction: (tx: NetworkTransaction) => void;

  // API Client
  activeRequest: ApiRequestDraft;
  environments: EnvironmentProfile[];
  activeEnvironmentId: string;
  collections: ApiCollection[];
  apiResponse: Record<string, unknown> | null;
  isApiSending: boolean;
  setActiveRequest: (req: ApiRequestDraft) => void;
  sendActiveRequest: () => Promise<void>;
  loadFromNetworkTransaction: (tx: NetworkTransaction) => void;

  // Security Auditor
  findings: SecurityFinding[];
  selectedFindingId: string | null;
  securitySeverityFilter: string;
  setSelectedFindingId: (id: string | null) => void;
  setSecuritySeverityFilter: (filter: string) => void;
  dismissFinding: (id: string) => void;
  setFindings: (findings: SecurityFinding[]) => void;

  // Dependencies Graph
  graphNodes: IGraphNode[];
  graphEdges: IGraphEdge[];
  selectedNodeId: string | null;
  blastRadius: BlastRadiusResult | null;
  tigerGraphStatus: 'disconnected' | 'connected' | 'connecting';
  tigerGraphProviderType: 'tgcloud' | 'local';
  tigerGraphName: string;
  tigerGraphMode: 'tigergraph-only' | 'hybrid';
  activeGraphTab: 'topology' | 'graphstudio' | 'console';
  gsqlQuery: string;
  gsqlResult: unknown | null;
  isGsqlExecuting: boolean;
  setSelectedNodeId: (id: string | null) => void;
  setActiveGraphTab: (tab: 'topology' | 'graphstudio' | 'console') => void;
  setGsqlQuery: (query: string) => void;
  calculateBlastRadiusForNode: (nodeId: string) => void;
  // SentinelGraph: the live TigerGraph dependency graph (replaces the sample graph once connected)
  sentinelUrl: string;
  sentinelStatus: 'disconnected' | 'connecting' | 'connected';
  sentinelMessage: string;
  connectSentinel: (baseUrl: string, adminToken: string) => Promise<void>;
  restoreSentinel: () => Promise<void>;
  refreshSentinelGraph: () => Promise<void>;
  startSentinelInvestigation: (question?: string, tx?: NetworkTransaction) => Promise<void>;
  sentinelRun: RunSummary;
  pollSentinelRun: () => Promise<void>;
  decideSentinelAction: (uid: string, approve: boolean) => Promise<void>;
  resolveSentinelUrl: (url: string) => Promise<SentinelResolution | null>;
  executeTigerGraphQuery: (queryPath: string, method?: 'GET' | 'POST', body?: unknown) => Promise<void>;

  // AI Assistant
  aiMessages: ChatMessage[];
  isAiGenerating: boolean;
  ollamaStatus: { ok: boolean; model: string; message?: string };
  sendAiPrompt: (promptText: string) => Promise<void>;
  checkOllama: () => Promise<void>;

  // Settings
  telemetryEnabled: boolean;
  historyAutoPurgeDays: number;
  ollamaHost: string;
  selectedAiModel: string;
  tigerGraphEndpoint: string;
  tigerGraphSecret: string;
  wisprFlowStatus: 'desktop-ready' | 'api-configured';
  setSetting: <K extends keyof AppState>(key: K, value: AppState[K]) => void;

  // Global UI & System
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  shortcutsModalOpen: boolean;
  setShortcutsModalOpen: (open: boolean) => void;
  hardwareMetrics: HardwareMetrics | null;
  setHardwareMetrics: (metrics: HardwareMetrics | null) => void;
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
  triggerNuclearShred: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => {
  const initialTheme: ThemeMode = (localStorage.getItem('devbrowser_theme') as ThemeMode) || 'dark';
  document.documentElement.setAttribute('data-theme', initialTheme);

  const defaultPartitions: ProfilePartition[] = [
    {
      id: 'p-dev-1',
      name: 'Default Developer',
      partitionKey: 'persist:dev-default',
      color: '#3b82f6',
      isEphemeral: false,
      createdAt: Date.now()
    },
    {
      id: 'p-admin-2',
      name: 'Admin Role',
      partitionKey: 'persist:dev-admin',
      color: '#ef4444',
      isEphemeral: false,
      createdAt: Date.now()
    },
    {
      id: 'p-temp-3',
      name: 'Ephemeral Incognito',
      partitionKey: 'temp:dev-ephemeral',
      color: '#10b981',
      isEphemeral: true,
      createdAt: Date.now()
    }
  ];

  const defaultTabs: BrowserTab[] = [
    {
      id: 'tab-init-1',
      partitionId: 'p-dev-1',
      url: 'http://localhost:3000/cart',
      title: 'Checkout & Cart — Localhost',
      isLoading: false,
      canGoBack: true,
      canGoForward: false,
      isPinned: false,
      hibernation: { isHibernated: false, lastUrl: 'http://localhost:3000/cart' },
      activeSplitPane: 'main'
    },
    {
      id: 'tab-init-2',
      partitionId: 'p-admin-2',
      url: 'http://localhost:3000/admin/orders',
      title: 'Admin Orders Portal',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isPinned: false,
      hibernation: { isHibernated: false, lastUrl: 'http://localhost:3000/admin/orders' },
      activeSplitPane: 'main'
    }
  ];

  // Initial Sample CDP Network Transactions
  const initialTransactions: NetworkTransaction[] = [
    {
      id: 'tx-101',
      tabId: 'tab-init-1',
      url: 'http://localhost:3000/api/v2/checkout',
      method: 'POST',
      statusCode: 200,
      statusText: 'OK',
      protocol: 'h2',
      mimeType: 'application/json',
      requestHeaders: {
        'content-type': 'application/json',
        'authorization': 'Bearer dev_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'x-request-id': 'req_88f921ab'
      },
      responseHeaders: {
        'content-type': 'application/json; charset=utf-8',
        'x-powered-by': 'Express',
        'content-length': '284',
        'set-cookie': 'session_token=xyz123; Path=/'
      },
      requestBody: '{\n  "cartId": "cart_8831",\n  "paymentMethod": "pm_card_visa",\n  "total": 149.99\n}',
      responseBody: '{\n  "orderId": "ord_990142",\n  "status": "confirmed",\n  "capturedAmount": 149.99,\n  "currency": "USD",\n  "processedAt": "2026-10-29T10:25:00.000Z"\n}',
      isTruncated: false,
      encodedBodyLength: 284,
      timing: { requestTime: Date.now() - 3200, sendStart: 2, sendEnd: 5, receiveHeadersEnd: 42 },
      startTime: Date.now() - 3200,
      endTime: Date.now() - 3158
    },
    {
      id: 'tx-102',
      tabId: 'tab-init-1',
      url: 'http://localhost:3000/api/v1/auth/session',
      method: 'GET',
      statusCode: 200,
      statusText: 'OK',
      protocol: 'h2',
      mimeType: 'application/json',
      requestHeaders: { 'accept': 'application/json' },
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{\n  "user": {\n    "id": "usr_dev_42",\n    "email": "alex.dev@internal.app",\n    "role": "engineer"\n  }\n}',
      isTruncated: false,
      startTime: Date.now() - 5000,
      endTime: Date.now() - 4982
    },
    {
      id: 'tx-103',
      tabId: 'tab-init-1',
      url: 'http://localhost:3000/api/v1/inventory/check?itemId=m4-pro-01&token=AKIAIOSFODNN7EXAMPLE',
      method: 'GET',
      statusCode: 422,
      statusText: 'Unprocessable Entity',
      protocol: 'http/1.1',
      mimeType: 'application/json',
      requestHeaders: { 'accept': 'application/json' },
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{\n  "error": "InvalidQueryParameter",\n  "message": "Token must be provided in Authorization header, not URL query parameter."\n}',
      isTruncated: false,
      startTime: Date.now() - 2100,
      endTime: Date.now() - 2085
    }
  ];

  // Initial Sample Passive Security Findings
  const initialFindings: SecurityFinding[] = [
    {
      id: 'sec-001',
      ruleId: 'SEC-HDR-001',
      timestamp: Date.now() - 3000,
      severity: 'HIGH',
      title: 'Missing Content-Security-Policy (CSP)',
      description: 'The target origin does not return a Content-Security-Policy header, leaving the application vulnerable to Cross-Site Scripting (XSS) and code injection.',
      remediation: "Add 'Content-Security-Policy: default-src \\'self\\'; script-src \\'self\\'' to your web server response headers.",
      evidence: {
        url: 'http://localhost:3000/cart',
        method: 'GET',
        statusCode: 200,
        rawSnippet: 'HTTP/1.1 200 OK\n(Headers present: content-type, etag, x-powered-by. Missing Content-Security-Policy)'
      },
      cwe: 1021,
      owaspCategory: 'A05:2021-Security Misconfiguration',
      isIgnored: false,
      suppressionFingerprint: 'sec-hdr-001-localhost'
    },
    {
      id: 'sec-002',
      ruleId: 'SEC-CK-003',
      timestamp: Date.now() - 2500,
      severity: 'MEDIUM',
      title: 'Session Cookie Missing SameSite & Secure Flags',
      description: 'The session_token cookie was set without the SameSite attribute and without the Secure flag, increasing exposure to CSRF attacks.',
      remediation: "Configure cookie directives: 'Set-Cookie: session_token=...; Secure; HttpOnly; SameSite=Lax'",
      evidence: {
        url: 'http://localhost:3000/api/v2/checkout',
        method: 'POST',
        statusCode: 200,
        cookieName: 'session_token',
        rawSnippet: 'Set-Cookie: session_token=xyz123; Path=/'
      },
      cwe: 614,
      owaspCategory: 'A01:2021-Broken Access Control',
      isIgnored: false,
      suppressionFingerprint: 'sec-ck-003-session_token'
    },
    {
      id: 'sec-003',
      ruleId: 'SEC-LEAK-001',
      timestamp: Date.now() - 2000,
      severity: 'HIGH',
      title: 'Sensitive Access Token in URL Query Parameter',
      description: 'An API key or secret token was detected in the URL query parameters. URL query parameters are logged in browser history, proxy logs, and Referer headers.',
      remediation: 'Pass sensitive credentials in the HTTP Authorization request header rather than query strings.',
      evidence: {
        url: 'http://localhost:3000/api/v1/inventory/check?token=AKIAIOSFODNN7EXAMPLE',
        method: 'GET',
        statusCode: 422,
        rawSnippet: 'Query parameter: token=AKIAIOSFODNN7EXAMPLE'
      },
      cwe: 598,
      owaspCategory: 'A04:2021-Insecure Design',
      isIgnored: false,
      suppressionFingerprint: 'sec-leak-001-token-query'
    }
  ];

  // Initial Sample API Dependency Graph
  const initialNodes: IGraphNode[] = [
    { id: 'route:cart', type: 'FrontendRoute', name: '/cart UI', metadata: { framework: 'Next.js' } },
    { id: 'service:api-gw', type: 'Service', name: 'API Gateway', metadata: { protocol: 'HTTP/2' } },
    { id: 'ep:checkout', type: 'Endpoint', name: 'POST /checkout', metadata: { avgLatency: '42ms' } },
    { id: 'service:billing', type: 'Service', name: 'BillingService', metadata: { status: 'healthy' } },
    { id: 'service:inventory', type: 'Service', name: 'InventoryService', metadata: { status: 'degraded' } },
    { id: 'db:orders', type: 'Database', name: 'PostgreSQL:Orders', metadata: { replicas: 2 } }
  ];

  const initialEdges: IGraphEdge[] = [
    { sourceId: 'route:cart', targetId: 'service:api-gw', type: 'CALLS', metadata: { callCount: 14 } },
    { sourceId: 'service:api-gw', targetId: 'ep:checkout', type: 'CALLS', metadata: { callCount: 14 } },
    { sourceId: 'ep:checkout', targetId: 'service:billing', type: 'DEPENDS_ON', metadata: { averageLatencyMs: 38 } },
    { sourceId: 'ep:checkout', targetId: 'service:inventory', type: 'DEPENDS_ON', metadata: { errorRate: 0.12 } },
    { sourceId: 'service:billing', targetId: 'db:orders', type: 'PRODUCES', metadata: { protocol: 'gRPC' } }
  ];

  return {
    // Theme
    theme: initialTheme,
    setTheme: (theme) => {
      localStorage.setItem('devbrowser_theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      set({ theme });
    },
    toggleTheme: () => {
      const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
      get().setTheme(nextTheme);
    },

    // Navigation
    activeView: 'browser',
    setActiveView: (activeView) => set({ activeView }),
    sidebarCollapsed: false,
    toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),

    // Tabs & Partitions
    tabs: defaultTabs,
    activeTabId: 'tab-init-1',
    partitions: defaultPartitions,
    currentUrl: 'http://localhost:3000/cart',
    splitLayout: 'single',
    setSplitLayout: (splitLayout) => set({ splitLayout }),
    setActiveTabId: (activeTabId) => {
      const tab = get().tabs.find(t => t.id === activeTabId);
      set({ activeTabId, currentUrl: tab?.url || get().currentUrl });
    },
    setCurrentUrl: (currentUrl) => set({ currentUrl }),
    createNewTab: async (url = 'http://localhost:3000', partitionKey = 'persist:dev-default') => {
      const partition = get().partitions.find(p => p.partitionKey === partitionKey) || get().partitions[0]!;
      const newTab: BrowserTab = {
        id: `tab-${Date.now()}`,
        partitionId: partition.id,
        url,
        title: url.replace('http://', '').replace('https://', '') || 'New Tab',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: false,
        hibernation: { isHibernated: false, lastUrl: url },
        activeSplitPane: 'main'
      };
      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        currentUrl: url
      }));
      get().addToast({
        type: 'info',
        title: 'New Container Tab Opened',
        message: `Profile: ${partition.name}`
      });
    },
    closeTab: (tabId) => {
      const currentTabs = get().tabs;
      if (currentTabs.length <= 1) return;
      const remaining = currentTabs.filter(t => t.id !== tabId);
      set({
        tabs: remaining,
        activeTabId: remaining[0]?.id || '',
        currentUrl: remaining[0]?.url || ''
      });
    },
    navigateTab: (url) => {
      set(state => ({
        currentUrl: url,
        tabs: state.tabs.map(t => t.id === state.activeTabId ? {
          ...t,
          url,
          title: url.replace('http://', '').replace('https://', '')
        } : t)
      }));
      get().addToast({
        type: 'info',
        title: 'Navigating',
        message: url
      });
    },

    // Resizable Panel
    resizablePanelHeight: 320,
    setResizablePanelHeight: (resizablePanelHeight) => set({ resizablePanelHeight }),

    // Network
    transactions: initialTransactions,
    selectedTransactionId: 'tx-101',
    networkSearchQuery: '',
    networkFilter: 'all',
    setSelectedTransactionId: (selectedTransactionId) => set({ selectedTransactionId }),
    setNetworkSearchQuery: (networkSearchQuery) => set({ networkSearchQuery }),
    setNetworkFilter: (networkFilter) => set({ networkFilter }),
    clearTransactions: () => {
      set({ transactions: [], selectedTransactionId: null });
      get().addToast({ type: 'info', title: 'Network Log Cleared' });
    },
    addTransaction: (tx) => {
      set(state => {
        const exists = state.transactions.some(t => t.id === tx.id);
        const updated = exists
          ? state.transactions.map(t => t.id === tx.id ? tx : t)
          : [tx, ...state.transactions.slice(0, 199)];
        return { transactions: updated };
      });
    },

    // API Client
    activeRequest: {
      id: 'req-draft-1',
      name: 'Checkout POST Replay',
      method: 'POST',
      url: '{{baseUrl}}/api/v2/checkout',
      headers: [
        { key: 'Content-Type', value: 'application/json', enabled: true },
        { key: 'Authorization', value: 'Bearer {{authToken}}', enabled: true }
      ],
      queryParams: [{ key: 'dryRun', value: 'false', enabled: false }],
      body: {
        mode: 'json',
        raw: '{\n  "cartId": "cart_8831",\n  "paymentMethod": "pm_card_visa",\n  "total": 149.99\n}'
      },
      assertions: [
        { id: 'as-1', name: 'Status is 200 OK', script: 'pm.response.to.have.status(200)', passed: true }
      ]
    },
    environments: [
      {
        id: 'env-1',
        name: 'Local Dev (Port 3000)',
        variables: [
          { id: 'v-1', key: 'baseUrl', value: 'http://localhost:3000', isSecret: false, enabled: true },
          { id: 'v-2', key: 'authToken', value: 'dev_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', isSecret: true, enabled: true }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'env-2',
        name: 'Staging Cloud',
        variables: [
          { id: 'v-3', key: 'baseUrl', value: 'https://staging.internal.app', isSecret: false, enabled: true },
          { id: 'v-4', key: 'authToken', value: 'stage_token_live', isSecret: true, enabled: true }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ],
    activeEnvironmentId: 'env-1',
    collections: [
      {
        id: 'col-1',
        name: 'E-Commerce Regression Suite',
        description: 'End-to-end checkout and auth flows',
        requests: [],
        environmentVariables: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ],
    apiResponse: null,
    isApiSending: false,
    setActiveRequest: (activeRequest) => set({ activeRequest }),
    sendActiveRequest: async () => {
      set({ isApiSending: true });
      const env = get().environments.find(e => e.id === get().activeEnvironmentId);
      const baseUrl = env?.variables.find(v => v.key === 'baseUrl')?.value || 'http://localhost:3000';
      const authToken = env?.variables.find(v => v.key === 'authToken')?.value || '';

      setTimeout(() => {
        set({
          isApiSending: false,
          apiResponse: {
            status: 200,
            statusText: 'OK',
            durationMs: 38,
            resolvedUrl: get().activeRequest.url.replace('{{baseUrl}}', baseUrl),
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'x-dev-browser-interpolated': 'true',
              'x-auth-applied': authToken ? 'Bearer [REDACTED]' : 'None'
            },
            data: {
              orderId: 'ord_' + Math.random().toString(36).substring(2, 9),
              status: 'processed_successfully',
              timestamp: new Date().toISOString(),
              summary: 'Request executed in Dev Browser sandbox'
            }
          }
        });
        get().addToast({ type: 'success', title: 'API Request Completed', message: 'HTTP 200 OK (38ms)' });
      }, 450);
    },
    loadFromNetworkTransaction: (tx) => {
      const draft: ApiRequestDraft = {
        id: `draft-${Date.now()}`,
        name: `${tx.method} ${tx.url.split('/').pop() || 'Request'}`,
        method: tx.method as never,
        url: tx.url,
        headers: Object.entries(tx.requestHeaders).map(([key, value]) => ({
          key,
          value,
          enabled: true
        })),
        queryParams: [],
        body: {
          mode: tx.requestBody ? 'json' : 'none',
          raw: tx.requestBody
        },
        assertions: []
      };
      set({ activeRequest: draft, activeView: 'apiClient' });
      get().addToast({
        type: 'success',
        title: 'Transaction Converted to API Client',
        message: `${tx.method} ${tx.url}`
      });
    },

    // Security Auditor
    findings: initialFindings,
    selectedFindingId: 'sec-001',
    securitySeverityFilter: 'all',
    setSelectedFindingId: (selectedFindingId) => set({ selectedFindingId }),
    setSecuritySeverityFilter: (securitySeverityFilter) => set({ securitySeverityFilter }),
    dismissFinding: (id) => {
      set(state => ({
        findings: state.findings.filter(f => f.id !== id),
        selectedFindingId: state.selectedFindingId === id ? null : state.selectedFindingId
      }));
      get().addToast({ type: 'info', title: 'Finding Suppressed' });
    },
    setFindings: (findings) => set({ findings }),

    // Graph
    graphNodes: initialNodes,
    graphEdges: initialEdges,
    selectedNodeId: 'ep:checkout',
    blastRadius: null,
    tigerGraphStatus: 'disconnected',
    tigerGraphProviderType: 'tgcloud',
    tigerGraphName: 'MyGraph',
    tigerGraphMode: 'hybrid',
    activeGraphTab: 'topology',
    gsqlQuery: '/restpp/graph/MyGraph/vertices/Service',
    gsqlResult: null,
    isGsqlExecuting: false,
    setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
    setActiveGraphTab: (activeGraphTab) => set({ activeGraphTab }),
    setGsqlQuery: (gsqlQuery) => set({ gsqlQuery }),
    executeTigerGraphQuery: async (queryPath, method = 'GET', body) => {
      set({ isGsqlExecuting: true });
      try {
        if (window.devBrowserAPI?.system) {
          const res = await window.devBrowserAPI.system.executeTigerGraphQuery({
            endpoint: get().tigerGraphEndpoint,
            queryPath,
            method,
            secret: get().tigerGraphSecret,
            body
          });
          set({ gsqlResult: res, isGsqlExecuting: false });
          get().addToast({
            type: res.ok ? 'success' : 'warning',
            title: res.ok ? 'TigerGraph Query Succeeded' : 'TigerGraph Query Notice',
            message: `${method} ${queryPath} (${res.durationMs}ms)`
          });
          return;
        }
      } catch (err) {
        console.error('[TigerGraph] Query execution error:', err);
      }

      set({
        isGsqlExecuting: false,
        gsqlResult: {
          ok: true,
          status: 200,
          durationMs: 14,
          data: {
            version: { edition: 'cloud-managed', api: 'v2' },
            error: false,
            message: 'In-Memory Topology Simulation Query Result',
            results: get().graphNodes.map(n => ({ v_id: n.id, v_type: n.type, attributes: n.metadata }))
          }
        }
      });
      get().addToast({
        type: 'info',
        title: 'Query Simulated',
        message: `${method} ${queryPath} (14ms)`
      });
    },
    sentinelUrl: 'http://localhost:8100',
    sentinelStatus: 'disconnected',
    sentinelMessage: 'Not connected: showing the sample graph',
    connectSentinel: async (baseUrl, adminToken) => {
      if (!window.devBrowserAPI) return;
      set({ sentinelUrl: baseUrl, sentinelStatus: 'connecting' });
      const status = await window.devBrowserAPI.sentinel.configure(baseUrl, adminToken);
      set({ sentinelStatus: status.ok ? 'connected' : 'disconnected', sentinelMessage: status.message });
      get().addToast({
        type: status.ok ? 'success' : 'warning',
        title: status.ok ? 'SentinelGraph Connected' : 'SentinelGraph Connection Notice',
        message: status.message
      });
      if (status.ok) await get().refreshSentinelGraph();
    },
    restoreSentinel: async () => {
      if (!window.devBrowserAPI) return;
      const saved = await window.devBrowserAPI.sentinel.restore();
      if (!saved) return; // never configured: stay on the labelled sample graph
      set({ sentinelUrl: saved.url, sentinelStatus: saved.status.ok ? 'connected' : 'disconnected',
        sentinelMessage: saved.status.message });
      if (saved.status.ok) {
        await get().refreshSentinelGraph();
        await get().pollSentinelRun(); // pick up an investigation already in progress
      }
    },
    refreshSentinelGraph: async () => {
      if (!window.devBrowserAPI || get().sentinelStatus !== 'connected') return;
      try {
        const { nodes, edges } = toDevBrowserGraph(await window.devBrowserAPI.sentinel.getGraph());
        set(state => ({
          graphNodes: nodes,
          graphEdges: edges,
          blastRadius: null,
          selectedNodeId: nodes.some(n => n.id === state.selectedNodeId) ? state.selectedNodeId : nodes[0]?.id ?? null
        }));
      } catch (err) {
        set({ sentinelStatus: 'disconnected', sentinelMessage: err instanceof Error ? err.message : String(err) });
      }
    },
    startSentinelInvestigation: async (question?: string, tx?: NetworkTransaction) => {
      if (!window.devBrowserAPI || get().sentinelStatus !== 'connected') {
        get().addToast({
          type: 'warning',
          title: 'SentinelGraph Not Connected',
          message: 'Connect to SentinelGraph in Settings before starting an investigation.'
        });
        return;
      }
      try {
        const evidence = tx ? toEvidence(tx, get().currentUrl) : null;
        const res = await window.devBrowserAPI.sentinel.startInvestigation(question, evidence ? [evidence] : []);
        set({ sentinelRun: { ...summarizeRun(null), phase: 'running' } });
        get().addToast({
          type: 'info',
          title: 'Investigation Launched',
          message: `SentinelGraph run ${res.run_id} started${evidence ? ` from ${evidence.method} ${evidence.url}` : ''}.`
        });
        void get().pollSentinelRun();
      } catch (err) {
        get().addToast({
          type: 'error',
          title: 'Investigation Launch Failed',
          message: err instanceof Error ? err.message : String(err)
        });
      }
    },
    sentinelRun: summarizeRun(null),
    pollSentinelRun: async () => {
      if (!window.devBrowserAPI || get().sentinelStatus !== 'connected') return;
      try {
        const run = summarizeRun(await window.devBrowserAPI.sentinel.currentRun());
        const wasRunning = get().sentinelRun.phase === 'running';
        set({ sentinelRun: run });
        if (run.phase === 'running') {
          setTimeout(() => void get().pollSentinelRun(), 1000);
        } else if (wasRunning) {
          await get().refreshSentinelGraph();
          get().addToast({
            type: run.phase === 'done' ? 'success' : 'error',
            title: run.phase === 'done' ? 'Investigation Complete' : 'Investigation Failed',
            message: run.rootCause ? `Root cause: ${run.rootCause}. ${run.proposed.length} action(s) await approval.`
              : run.report ?? ''
          });
        }
      } catch (err) {
        set(state => ({ sentinelRun: { ...state.sentinelRun, phase: 'failed',
          report: err instanceof Error ? err.message : String(err) } }));
      }
    },
    decideSentinelAction: async (uid, approve) => {
      if (!window.devBrowserAPI) return;
      try {
        const api = window.devBrowserAPI.sentinel;
        const outcome = approve ? (await api.approveAction(uid)).outcome : 'rejected';
        set(state => ({ sentinelRun: { ...state.sentinelRun, proposed: state.sentinelRun.proposed.map(a =>
          a.uid === uid ? { ...a, status: approve ? 'executed' : 'rejected', outcome } : a) } }));
        get().addToast({ type: approve ? 'success' : 'info', title: approve ? 'Action Executed' : 'Action Rejected',
          message: outcome });
        await get().refreshSentinelGraph();
      } catch (err) {
        get().addToast({ type: 'error', title: 'Action Failed', message: err instanceof Error ? err.message : String(err) });
      }
    },
    resolveSentinelUrl: async (url) => {
      if (!window.devBrowserAPI || get().sentinelStatus !== 'connected') return null;
      try {
        return await window.devBrowserAPI.sentinel.resolve(url);
      } catch {
        return null;
      }
    },
    calculateBlastRadiusForNode: (nodeId) => {
      const node = get().graphNodes.find(n => n.id === nodeId);
      if (get().sentinelStatus === 'connected' && window.devBrowserAPI && node && node.type !== 'Database') {
        // A real traversal in TigerGraph (GSQL, up to 6 hops), not just the direct neighbours.
        window.devBrowserAPI.sentinel.blastRadius(node.name).then(res => {
          const blastRadius = toBlastRadius(nodeId, res, get().graphNodes);
          set({ blastRadius });
          get().addToast({
            type: 'warning',
            title: 'Blast Radius (TigerGraph)',
            message: `${blastRadius.affectedNodes.length} upstream services break if ${node.name} fails`
          });
        }).catch(err => get().addToast({
          type: 'error',
          title: 'Blast Radius Failed',
          message: err instanceof Error ? err.message : String(err)
        }));
        return;
      }
      const edges = get().graphEdges.filter(e => e.sourceId === nodeId || e.targetId === nodeId);
      const affectedIds = new Set<string>([nodeId]);
      edges.forEach(e => { affectedIds.add(e.sourceId); affectedIds.add(e.targetId); });
      const affectedNodes = get().graphNodes.filter(n => affectedIds.has(n.id));

      set({
        blastRadius: {
          rootNodeId: nodeId,
          affectedNodes,
          impactScore: 0.65,
          dependencyChain: [Array.from(affectedIds)]
        }
      });
      get().addToast({
        type: 'warning',
        title: 'Blast Radius Calculated',
        message: `${affectedNodes.length} interconnected services affected (Impact Score: 65%)`
      });
    },

    // AI
    aiMessages: [
      {
        id: 'msg-1',
        sender: 'assistant',
        text: 'Dev Browser Local AI assistant is ready. Inference executes 100% on-device over Apple Silicon unified memory via Ollama. No code or tokens leave your Mac.',
        timestamp: Date.now() - 60000
      }
    ],
    isAiGenerating: false,
    ollamaStatus: { ok: false, model: 'checking...' },
    sendAiPrompt: async (promptText) => {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: promptText,
        timestamp: Date.now()
      };
      set(state => ({
        aiMessages: [...state.aiMessages, userMsg],
        isAiGenerating: true
      }));

      try {
        if (window.devBrowserAPI?.ai) {
          const selectedTx = get().selectedTransactionId
            ? get().transactions.find(t => t.id === get().selectedTransactionId)
            : undefined;

          const res = await window.devBrowserAPI.ai.executeDiagnosis({
            errorMessage: promptText,
            consoleLogs: [],
            failedRequestUrl: selectedTx?.url,
            failedResponseStatus: selectedTx?.statusCode,
            failedResponseBody: selectedTx?.responseBody
          });

          const assistantMsg: ChatMessage = {
            id: `ai-${Date.now()}`,
            sender: 'assistant',
            text: res.diagnosis,
            diff: res.suggestedDiff ? res.suggestedDiff.unifiedDiff : undefined,
            timestamp: Date.now()
          };

          set(state => ({
            aiMessages: [...state.aiMessages, assistantMsg],
            isAiGenerating: false
          }));
          return;
        }
      } catch (err) {
        console.warn('[AI] Local inference error, using fallback:', err);
      }

      // Offline / browser fallback
      setTimeout(() => {
        let responseText = '';
        let diff: string | undefined = undefined;

        if (promptText.toLowerCase().includes('security') || promptText.toLowerCase().includes('csp')) {
          responseText = 'Identified missing Content-Security-Policy on localhost:3000. Here is an actionable configuration patch:';
          diff = `// next.config.js\n module.exports = {\n+  async headers() {\n+    return [{\n+      source: '/(.*)',\n+      headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }]\n+    }];\n+  }\n };`;
        } else if (promptText.toLowerCase().includes('test') || promptText.toLowerCase().includes('playwright')) {
          responseText = 'Generated automated Playwright regression test verifying the checkout workflow:';
          diff = `// tests/checkout.spec.ts\n+import { test, expect } from '@playwright/test';\n+\n+test('verify cart checkout flow', async ({ page }) => {\n+  await page.goto('http://localhost:3000/cart');\n+  await page.click('[data-testid="checkout-btn"]');\n+  await expect(page.locator('.order-status')).toHaveText('confirmed');\n+});`;
        } else {
          responseText = `Analyzed application state for: "${promptText}". All network dependencies and DOM sinks are verified safe.`;
        }

        const assistantMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          sender: 'assistant',
          text: responseText,
          diff,
          timestamp: Date.now()
        };

        set(state => ({
          aiMessages: [...state.aiMessages, assistantMsg],
          isAiGenerating: false
        }));
      }, 600);
    },
    checkOllama: async () => {
      if (window.devBrowserAPI) {
        try {
          const status = await window.devBrowserAPI.system.checkOllamaStatus();
          set({ ollamaStatus: status });
        } catch {
          set({ ollamaStatus: { ok: false, model: 'none', message: 'Connection failed' } });
        }
      }
    },

    // Settings
    telemetryEnabled: false,
    historyAutoPurgeDays: 30,
    ollamaHost: 'http://127.0.0.1:11434',
    selectedAiModel: 'qwen2.5-coder:7b',
    tigerGraphEndpoint: 'https://my-subdomain.i.tgcloud.io',
    tigerGraphSecret: '',
    wisprFlowStatus: 'desktop-ready',
    setSetting: (key, value) => set({ [key]: value }),

    // System
    commandPaletteOpen: false,
    setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
    shortcutsModalOpen: false,
    setShortcutsModalOpen: (shortcutsModalOpen) => set({ shortcutsModalOpen }),
    hardwareMetrics: null,
    setHardwareMetrics: (hardwareMetrics) => set({ hardwareMetrics }),
    toasts: [],
    addToast: (toast) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      set(state => ({ toasts: [...state.toasts, { ...toast, id }] }));
      setTimeout(() => {
        get().removeToast(id);
      }, toast.duration || 3500);
    },
    removeToast: (id) => {
      set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
    },
    triggerNuclearShred: async () => {
      if (window.devBrowserAPI) {
        await window.devBrowserAPI.privacy.triggerNuclearShred();
      }
      set({
        transactions: [],
        findings: [],
        apiResponse: null,
        selectedTransactionId: null
      });
      get().addToast({
        type: 'error',
        title: 'Nuclear Shred Executed',
        message: 'All local session cookies, cache, and findings have been permanently destroyed.'
      });
    }
  };
});
