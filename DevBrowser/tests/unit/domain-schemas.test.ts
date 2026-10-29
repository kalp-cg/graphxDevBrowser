import { describe, it, expect } from 'vitest';
import { 
  BrowserTabSchema, 
  ProfilePartitionSchema,
  NetworkTransactionSchema,
  ApiRequestDraftSchema,
  SecurityFindingSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  VoiceContextSchema,
  PrivacySettingsSchema
} from '../../src/shared/domain';

describe('Domain Schemas Runtime Validation', () => {
  it('validates a valid BrowserTabSchema and ProfilePartitionSchema', () => {
    const partition = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Default Profile',
      partitionKey: 'persist:default',
      color: '#3b82f6',
      isEphemeral: false,
      createdAt: Date.now()
    };
    expect(ProfilePartitionSchema.safeParse(partition).success).toBe(true);

    const validTab = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      partitionId: partition.id,
      url: 'http://localhost:3000',
      title: 'Dev Server',
      isLoading: false,
      canGoBack: true,
      canGoForward: false,
      isPinned: false,
      hibernation: {
        isHibernated: false,
        lastUrl: 'http://localhost:3000'
      },
      activeSplitPane: 'main'
    };

    const parsed = BrowserTabSchema.safeParse(validTab);
    expect(parsed.success).toBe(true);
  });

  it('validates ApiRequestDraftSchema', () => {
    const draft = {
      id: '550e8400-e29b-41d4-a716-446655440010',
      name: 'Get User',
      method: 'GET' as const,
      url: 'http://localhost:3000/api/user',
      headers: [],
      queryParams: [],
      body: { mode: 'none' as const },
      assertions: []
    };
    expect(ApiRequestDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('rejects invalid URL in NetworkTransactionSchema', () => {
    const invalidTransaction = {
      id: 'tx-001',
      tabId: '550e8400-e29b-41d4-a716-446655440000',
      url: 'not-a-valid-url',
      method: 'GET',
      requestHeaders: {},
      startTime: Date.now()
    };

    const parsed = NetworkTransactionSchema.safeParse(invalidTransaction);
    expect(parsed.success).toBe(false);
  });

  it('validates SecurityFindingSchema with raw evidence', () => {
    const validFinding = {
      id: '550e8400-e29b-41d4-a716-446655440002',
      ruleId: 'SEC-HDR-001',
      timestamp: Date.now(),
      severity: 'HIGH',
      title: 'Missing Content-Security-Policy',
      description: 'The target origin failed to provide a strict CSP.',
      remediation: 'Add Content-Security-Policy header.',
      evidence: {
        url: 'http://localhost:3000',
        method: 'GET',
        statusCode: 200,
        rawSnippet: 'CSP header missing'
      },
      cwe: 1021,
      owaspCategory: 'A05:2021-Security Misconfiguration',
      isIgnored: false,
      suppressionFingerprint: 'sec-hdr-001-localhost'
    };

    const parsed = SecurityFindingSchema.safeParse(validFinding);
    expect(parsed.success).toBe(true);
  });

  it('validates GraphNodeSchema and GraphEdgeSchema', () => {
    const node = {
      id: 'service:billing',
      type: 'Service',
      name: 'Billing Microservice',
      metadata: { environment: 'staging' }
    };

    const edge = {
      sourceId: 'service:api-gateway',
      targetId: 'service:billing',
      type: 'CALLS',
      metadata: { protocol: 'HTTP', averageLatencyMs: 35 }
    };

    expect(GraphNodeSchema.safeParse(node).success).toBe(true);
    expect(GraphEdgeSchema.safeParse(edge).success).toBe(true);
  });

  it('validates VoiceContextSchema with code boundaries', () => {
    const context = {
      activePanel: 'API_CLIENT',
      surroundingText: {
        beforeText: 'pm.test("Status 200", () => {',
        selectedText: '',
        afterText: '});'
      },
      detectedLanguage: 'en',
      appType: 'developer_browser'
    };

    const parsed = VoiceContextSchema.safeParse(context);
    expect(parsed.success).toBe(true);
  });

  it('enforces privacy defaults (telemetry: false)', () => {
    const parsed = PrivacySettingsSchema.parse({});
    expect(parsed.telemetryEnabled).toBe(false);
    expect(parsed.keychainEncryptionActive).toBe(true);
  });
});
