export const IPC_CHANNELS = {
  // System & Window
  SYSTEM_GET_HARDWARE_METRICS: 'devbrowser:system:getHardwareMetrics',
  SYSTEM_CHECK_OLLAMA_STATUS: 'devbrowser:system:checkOllamaStatus',
  SYSTEM_CHECK_TIGERGRAPH_STATUS: 'devbrowser:system:checkTigerGraphStatus',
  TIGERGRAPH_EXECUTE_QUERY: 'devbrowser:tigergraph:executeQuery',

  // Browser Tabs & Partitions
  TABS_CREATE: 'devbrowser:tabs:create',
  TABS_CLOSE: 'devbrowser:tabs:close',
  TABS_NAVIGATE: 'devbrowser:tabs:navigate',
  TABS_LIST: 'devbrowser:tabs:list',

  // Network & CDP
  NETWORK_STREAM_TRANSACTION: 'devbrowser:network:streamTransaction',
  NETWORK_CLEAR_TRANSACTIONS: 'devbrowser:network:clearTransactions',

  // API Client
  API_CLIENT_SEND_REQUEST: 'devbrowser:apiClient:sendRequest',

  // Security
  SECURITY_GET_FINDINGS: 'devbrowser:security:getFindings',
  SECURITY_CLEAR_FINDINGS: 'devbrowser:security:clearFindings',

  // Local AI
  AI_EXECUTE_DIAGNOSIS: 'devbrowser:ai:executeDiagnosis',

  // SentinelGraph (TigerGraph dependency graph + incident agent)
  SENTINEL_CONFIGURE: 'devbrowser:sentinel:configure',
  SENTINEL_STATUS: 'devbrowser:sentinel:status',
  SENTINEL_GET_GRAPH: 'devbrowser:sentinel:getGraph',
  SENTINEL_BLAST_RADIUS: 'devbrowser:sentinel:blastRadius',
  SENTINEL_START_INVESTIGATION: 'devbrowser:sentinel:startInvestigation',
  SENTINEL_RESTORE: 'devbrowser:sentinel:restore',
  SENTINEL_RESOLVE: 'devbrowser:sentinel:resolve',
  SENTINEL_CURRENT_RUN: 'devbrowser:sentinel:currentRun',
  SENTINEL_APPROVE_ACTION: 'devbrowser:sentinel:approveAction',
  SENTINEL_REJECT_ACTION: 'devbrowser:sentinel:rejectAction',

  // Privacy & Shred
  PRIVACY_TRIGGER_NUCLEAR_SHRED: 'devbrowser:privacy:triggerNuclearShred'
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

export interface HardwareMetrics {
  totalUnifiedMemoryBytes: number;
  freeUnifiedMemoryBytes: number;
  appMemoryUsageBytes: number;
  cpuArchitecture: string;
  isAppleSilicon: boolean;
}
