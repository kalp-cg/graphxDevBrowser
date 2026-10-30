import { create } from 'zustand';
import type { NetworkTransaction } from '../../shared/domain/network';
import {
  buildSendRequest, draftFromTransaction, evaluateAssertions, looksSecret,
  type ApiRequestDraft, type ApiSendResult, type ApiVariable, type AssertionResult
} from '../../shared/domain/api-client';
import type { SecurityFinding } from '../../shared/domain/security';
import type { IGraphNode, IGraphEdge, BlastRadiusResult } from '../../shared/domain/graph';
import {
  summarizeRun,
  toBlastRadius,
  toDevBrowserGraph,
  toEvidence,
  type RunSummary,
  type ChaosKind,
  type ImpactResult,
  type SentinelResolution,
  type SentinelSnapshot
} from '../../shared/domain/sentinel';
import type { HardwareMetrics } from '../../shared/ipc-channels';
import { useBrowserStore } from './useBrowserStore';

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

  // The tool panel docked beside the page ('browser' = closed). Tabs live in useBrowserStore.
  lastPanel: NavigationView;
  togglePanel: () => void;
  panelMaximized: boolean;
  setPanelMaximized: (maximized: boolean) => void;
  /** The active tab's URL, kept in sync by the browser (evidence for investigations, AI context). */
  currentUrl: string;
  setCurrentUrl: (url: string) => void;

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
  /** `{{name}}` substitutions. Values of credential-looking names are kept in memory only. */
  apiVariables: ApiVariable[];
  savedRequests: ApiRequestDraft[];
  /** Requests sent this session, newest first. */
  apiHistory: ApiHistoryEntry[];
  apiResult: ApiSendResult | null;
  apiAssertionResults: AssertionResult[];
  isApiSending: boolean;
  setActiveRequest: (req: ApiRequestDraft) => void;
  setApiVariables: (vars: ApiVariable[]) => void;
  sendActiveRequest: () => Promise<void>;
  saveActiveRequest: () => void;
  deleteSavedRequest: (id: string) => void;
  loadFromNetworkTransaction: (tx: NetworkTransaction) => void;

  /** Panels show the open website only; History shows everything captured before. */
  securityHistory: boolean;
  networkHistory: boolean;
  setSecurityHistory: (history: boolean) => void;
  setNetworkHistory: (history: boolean) => void;

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
  /** The live graph as SentinelGraph serves it (services plus deploys, alerts, incidents, people). */
  sentinelSnapshot: SentinelSnapshot | null;
  connectSentinel: (baseUrl: string) => Promise<void>;
  /** Pick a repository and map its services into the graph. */
  connectCodebase: () => Promise<void>;
  /** Demo: break a service (bad deploy, crash or degrade) so there is something to investigate. */
  breakService: (service: string, kind: ChaosKind) => Promise<void>;
  /** Which services my uncommitted changes touch, and what depends on them. */
  sentinelImpact: ImpactResult | null;
  /** Address -> service, from the last scan: matches what you browse to the map. */
  sentinelAliases: Record<string, string>;
  checkImpact: () => Promise<void>;
  clearImpact: () => void;
  /** Demo: back to a healthy system. */
  restoreHealthy: () => Promise<void>;
  restoreSentinel: () => Promise<void>;
  refreshSentinelGraph: () => Promise<void>;
  startSentinelInvestigation: (question?: string, tx?: NetworkTransaction) => Promise<void>;
  sentinelRun: RunSummary;
  pollSentinelRun: () => Promise<void>;
  decideSentinelAction: (uid: string, approve: boolean) => Promise<void>;
  resolveSentinelUrl: (url: string) => Promise<SentinelResolution | null>;

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

export interface ApiHistoryEntry {
  id: string;
  at: number;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  error?: string;
  draft: ApiRequestDraft;
}

const API_VARS_KEY = 'devbrowser.api.variables.v1';
const API_SAVED_KEY = 'devbrowser.api.saved.v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the session still works
  }
}

export function newApiRequest(): ApiRequestDraft {
  return { id: `req-${Date.now()}`, name: '', method: 'GET', url: '{{baseUrl}}/', headers: [], queryParams: [],
    body: { mode: 'none' }, assertions: [] };
}

export const useAppStore = create<AppState>((set, get) => {
  const initialTheme: ThemeMode = (localStorage.getItem('devbrowser_theme') as ThemeMode) || 'dark';
  document.documentElement.setAttribute('data-theme', initialTheme);

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
    setActiveView: (activeView) => set(state => ({
      activeView,
      lastPanel: activeView === 'browser' ? state.lastPanel : activeView,
      panelMaximized: activeView === 'browser' ? false : state.panelMaximized
    })),
    sidebarCollapsed: false,
    toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),

    lastPanel: 'network',
    togglePanel: () => {
      const { activeView, lastPanel } = get();
      set(activeView === 'browser' ? { activeView: lastPanel } : { activeView: 'browser', panelMaximized: false });
    },
    panelMaximized: false,
    setPanelMaximized: (panelMaximized) => set({ panelMaximized }),
    currentUrl: 'about:blank',
    setCurrentUrl: (currentUrl) => set({ currentUrl }),

    // Resizable Panel
    resizablePanelHeight: 320,
    setResizablePanelHeight: (resizablePanelHeight) => set({ resizablePanelHeight }),

    // Network
    transactions: [],
    selectedTransactionId: null,
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

    // API client: requests are really sent (from the main process); variables and saved requests persist on this machine.
    activeRequest: newApiRequest(),
    apiVariables: readJson<ApiVariable[]>(API_VARS_KEY, [{ key: 'baseUrl', value: 'http://localhost:3000' }]),
    savedRequests: readJson<ApiRequestDraft[]>(API_SAVED_KEY, []),
    apiHistory: [],
    apiResult: null,
    apiAssertionResults: [],
    isApiSending: false,
    setActiveRequest: (activeRequest) => set({ activeRequest }),
    setApiVariables: (apiVariables) => {
      set({ apiVariables });
      writeJson(API_VARS_KEY, apiVariables.filter(v => !looksSecret(v.key)));
    },
    sendActiveRequest: async () => {
      if (!window.devBrowserAPI || get().isApiSending) return;
      const draft = get().activeRequest;
      const { request, missing } = buildSendRequest(draft, get().apiVariables);
      if (!draft.url.trim()) return void get().addToast({ type: 'warning', title: 'Enter an address first' });
      if (missing.length) {
        return void get().addToast({ type: 'warning', title: 'Undefined variable',
          message: `${missing.map(m => `{{${m}}}`).join(', ')}: add ${missing.length === 1 ? 'it' : 'them'} under Variables.` });
      }
      set({ isApiSending: true, apiResult: null, apiAssertionResults: [] });
      const result = await window.devBrowserAPI.apiClient.send(request);
      const entry: ApiHistoryEntry = { id: `h-${Date.now()}`, at: Date.now(), method: request.method, url: request.url,
        status: result.status, durationMs: result.durationMs, error: result.error, draft };
      set(state => ({ isApiSending: false, apiResult: result, apiHistory: [entry, ...state.apiHistory].slice(0, 25),
        apiAssertionResults: evaluateAssertions(draft.assertions, result) }));
    },
    saveActiveRequest: () => {
      const draft = get().activeRequest;
      let redacted = false;
      const headers = draft.headers.map(h => {
        if (looksSecret(h.key) && h.value && !h.value.includes('{{')) {
          redacted = true;
          return { ...h, value: '' };
        }
        return h;
      });
      const saved = { ...draft, headers, name: draft.name.trim() || `${draft.method} ${draft.url}` };
      const rest = get().savedRequests.filter(r => r.id !== saved.id);
      const savedRequests = [saved, ...rest].slice(0, 100);
      set({ savedRequests });
      writeJson(API_SAVED_KEY, savedRequests);
      get().addToast({ type: 'success', title: 'Request saved',
        message: redacted ? 'Credentials in headers were not saved. Use a {{variable}} for them.' : saved.name });
    },
    deleteSavedRequest: (id) => {
      const savedRequests = get().savedRequests.filter(r => r.id !== id);
      set({ savedRequests });
      writeJson(API_SAVED_KEY, savedRequests);
    },
    loadFromNetworkTransaction: (tx) => {
      set({ activeRequest: draftFromTransaction(tx), apiResult: null, apiAssertionResults: [], activeView: 'apiClient' });
      get().addToast({ type: 'success', title: 'Opened in the API client', message: `${tx.method} ${tx.url}` });
    },

    securityHistory: false,
    networkHistory: false,
    setSecurityHistory: (securityHistory) => set({ securityHistory }),
    setNetworkHistory: (networkHistory) => set({ networkHistory }),

    // Security Auditor
    findings: [],
    selectedFindingId: null,
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
    graphNodes: [],
    graphEdges: [],
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
    sentinelUrl: 'http://localhost:8100',
    sentinelStatus: 'disconnected',
    sentinelMessage: 'Not connected',
    sentinelSnapshot: null,
    connectSentinel: async (baseUrl) => {
      if (!window.devBrowserAPI) return;
      set({ sentinelUrl: baseUrl, sentinelStatus: 'connecting' });
      const status = await window.devBrowserAPI.sentinel.configure(baseUrl);
      set({ sentinelStatus: status.ok ? 'connected' : 'disconnected', sentinelMessage: status.message });
      get().addToast({
        type: status.ok ? 'success' : 'warning',
        title: status.ok ? 'SentinelGraph Connected' : 'SentinelGraph Connection Notice',
        message: status.message
      });
      if (status.ok) await get().refreshSentinelGraph();
    },
    connectCodebase: async () => {
      if (!window.devBrowserAPI || get().sentinelStatus !== 'connected') {
        get().addToast({ type: 'warning', title: 'Connect SentinelGraph first',
          message: 'Settings → SentinelGraph, then connect your codebase.' });
        return;
      }
      try {
        const r = await window.devBrowserAPI.sentinel.scanCodebase();
        if (!r) return; // dialog cancelled
        get().addToast({ type: 'success', title: `Mapped ${r.repo}`,
          message: `${r.services} services, ${r.databases} databases, ${r.dependencies} dependencies, ${r.teams} teams (from ${r.source}).${r.replaced ? ' Replaced the previous map.' : ''}` });
        await get().refreshSentinelGraph();
      } catch (err) {
        get().addToast({ type: 'warning', title: 'Could not scan the codebase',
          message: err instanceof Error ? err.message : String(err) });
      }
    },
    sentinelImpact: null,
    sentinelAliases: {},
    clearImpact: () => set({ sentinelImpact: null }),
    checkImpact: async () => {
      if (!window.devBrowserAPI || get().sentinelStatus !== 'connected') return;
      try {
        const impact = await window.devBrowserAPI.sentinel.impact();
        set({ sentinelImpact: impact, selectedNodeId: null });
        if (!impact.changed.length) {
          get().addToast({ type: 'info', title: 'Nothing to check', message: impact.files ? 'The changed files belong to no mapped service.' : 'No uncommitted changes in the connected project.' });
        }
      } catch (err) {
        get().addToast({ type: 'warning', title: 'Could not check your changes', message: err instanceof Error ? err.message.replace(/^SentinelGraph [A-Z]+ \S+: HTTP \d+ /, '') : String(err) });
      }
    },
    breakService: async (service, kind) => {
      if (!window.devBrowserAPI || get().sentinelStatus !== 'connected') return;
      // Something is already broken: add to it, so several failures can be tried together.
      const additive = (get().sentinelSnapshot?.nodes ?? []).some(n => (n.type === 'Service' || n.type === 'Database') && n.status && n.status !== 'healthy');
      try {
        const r = await window.devBrowserAPI.sentinel.breakService(service, kind, additive);
        const who = r.alerting_services.length ? ` ${r.alerting_services.join(', ')} ${r.alerting_services.length === 1 ? 'is' : 'are'} alerting.` : '';
        get().addToast({ type: 'warning', title: `${service} is ${kind === 'degrade' ? 'degraded' : 'down'}`, message: `${who} Press Investigate.`.trim() });
        set({ sentinelRun: summarizeRun(null) });
        await get().refreshSentinelGraph();
      } catch (err) {
        get().addToast({ type: 'warning', title: `Could not break ${service}`, message: err instanceof Error ? err.message : String(err) });
      }
    },
    restoreHealthy: async () => {
      if (!window.devBrowserAPI || get().sentinelStatus !== 'connected') return;
      try {
        await window.devBrowserAPI.sentinel.restoreHealthy();
        set({ sentinelRun: summarizeRun(null) });
        get().addToast({ type: 'success', title: 'System restored', message: 'Every service is healthy again.' });
        await get().refreshSentinelGraph();
      } catch (err) {
        get().addToast({ type: 'warning', title: 'Could not restore', message: err instanceof Error ? err.message : String(err) });
      }
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
        const snapshot = await window.devBrowserAPI.sentinel.getGraph();
        window.devBrowserAPI.sentinel.aliases().then(sentinelAliases => set({ sentinelAliases })).catch(() => undefined);
        const { nodes, edges } = toDevBrowserGraph(snapshot);
        set(state => ({
          sentinelSnapshot: snapshot,
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
            message: run.rootCauses.length > 1 ? `${run.rootCauses.length} separate failures: ${run.rootCauses.join(', ')}. ${run.proposed.length} action(s) await approval.` : run.rootCause ? `Root cause: ${run.rootCause}. ${run.proposed.length} action(s) await approval.`
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
      if (get().sentinelStatus === 'connected' && window.devBrowserAPI && node && (node.type !== 'Database' || node.id.startsWith('svc:'))) {
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
      // Blast radius is a traversal of the real graph; there is no offline estimate worth showing.
      set({ blastRadius: null });
      get().addToast({ type: 'info', title: 'SentinelGraph not connected',
        message: 'Connect in Settings to compute the blast radius in the dependency graph.' });
    },

    // AI
    aiMessages: [
      {
        id: 'msg-1',
        sender: 'assistant',
        text: 'The local assistant is ready. It runs on this machine through Ollama: what you type and what you select stays here.',
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

      let reason = '';
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
        console.warn('[AI] local inference failed:', err);
        reason = err instanceof Error ? err.message : String(err);
      }

      // No canned answers: if the model cannot run, say so and say how to fix it.
      const host = get().ollamaHost;
      const model = get().selectedAiModel;
      set(state => ({
        aiMessages: [...state.aiMessages, {
          id: `ai-${Date.now()}`,
          sender: 'assistant',
          text: `I could not reach a local model, so I have not analysed anything.\n\n` +
            `Start Ollama (\`ollama serve\`) and install the model (\`ollama pull ${model}\`), then ask again. ` +
            `DevBrowser looks for it at the address in Settings, AI (${host} by default).` + (reason ? `\n\nDetail: ${reason}` : ''),
          timestamp: Date.now()
        }],
        isAiGenerating: false
      }));
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
      try {
        const result = window.devBrowserAPI ? await window.devBrowserAPI.privacy.triggerNuclearShred() : null;
        useBrowserStore.setState({ history: [], closed: [] });
        set({ transactions: [], findings: [], apiResult: null, apiAssertionResults: [], apiHistory: [], selectedTransactionId: null });
        get().addToast({
          type: 'success',
          title: 'Browsing data cleared',
          message: result ? `${result.purgedItemsCount} profiles signed out and cleared; history, credentials and captured traffic removed.`
            : 'History and captured traffic removed.'
        });
      } catch (err) {
        get().addToast({ type: 'error', title: 'Could not clear browsing data',
          message: err instanceof Error ? err.message : String(err) });
      }
    }
  };
});
