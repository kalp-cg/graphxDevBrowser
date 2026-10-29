import { describe, it, expect, beforeEach } from 'vitest';
import { PassiveSecurityAuditor } from '../../src/main/security/auditor';

describe('PassiveSecurityAuditor', () => {
  let auditor: PassiveSecurityAuditor;

  beforeEach(() => {
    auditor = new PassiveSecurityAuditor();
  });

  it('detects missing Content-Security-Policy on HTML documents', () => {
    const findings = auditor.evaluateResponse({
      url: 'http://localhost:3000/',
      method: 'GET',
      statusCode: 200,
      requestHeaders: {},
      responseHeaders: {
        'content-type': 'text/html; charset=utf-8'
      }
    });

    const cspFinding = findings.find(f => f.ruleId === 'SEC-HDR-001');
    expect(cspFinding).toBeDefined();
    expect(cspFinding?.severity).toBe('HIGH');
    expect(cspFinding?.cwe).toBe(1021);
    expect(cspFinding?.owaspCategory).toContain('Security Misconfiguration');
  });

  it('detects unsafe-inline in Content-Security-Policy', () => {
    const findings = auditor.evaluateResponse({
      url: 'http://localhost:3000/dashboard',
      method: 'GET',
      statusCode: 200,
      requestHeaders: {},
      responseHeaders: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self' 'unsafe-inline'"
      }
    });

    const cspFinding = findings.find(f => f.ruleId === 'SEC-HDR-001');
    expect(cspFinding).toBeDefined();
    expect(cspFinding?.severity).toBe('MEDIUM');
    expect(cspFinding?.title).toContain('Permissive');
  });

  it('detects missing HSTS on HTTPS endpoints', () => {
    const findings = auditor.evaluateResponse({
      url: 'https://api.internal.dev/v1/users',
      method: 'GET',
      statusCode: 200,
      requestHeaders: {},
      responseHeaders: {
        'content-type': 'application/json'
      }
    });

    const hstsFinding = findings.find(f => f.ruleId === 'SEC-HDR-002');
    expect(hstsFinding).toBeDefined();
    expect(hstsFinding?.severity).toBe('MEDIUM');
  });

  it('detects wildcard CORS combined with credentials', () => {
    const findings = auditor.evaluateResponse({
      url: 'https://api.internal.dev/auth/me',
      method: 'GET',
      statusCode: 200,
      requestHeaders: {},
      responseHeaders: {
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true'
      }
    });

    const corsFinding = findings.find(f => f.ruleId === 'SEC-HDR-003');
    expect(corsFinding).toBeDefined();
    expect(corsFinding?.severity).toBe('HIGH');
    expect(corsFinding?.cwe).toBe(942);
  });

  it('detects insecure cookies missing Secure or SameSite flags', () => {
    const findings = auditor.evaluateResponse({
      url: 'https://secure.service.dev/login',
      method: 'POST',
      statusCode: 200,
      requestHeaders: {},
      responseHeaders: {
        'set-cookie': 'session_token=xyz123; HttpOnly; Path=/'
      }
    });

    const secureFlag = findings.find(f => f.ruleId === 'SEC-CK-001');
    const sameSiteFlag = findings.find(f => f.ruleId === 'SEC-CK-003');
    expect(secureFlag).toBeDefined();
    expect(sameSiteFlag).toBeDefined();
  });

  it('detects sensitive tokens in query parameters', () => {
    const findings = auditor.evaluateResponse({
      url: 'https://api.vendor.dev/callback?token=eyJhbGciOiJIUzI1NiJ9.demo',
      method: 'GET',
      statusCode: 200,
      requestHeaders: {},
      responseHeaders: {}
    });

    const leakFinding = findings.find(f => f.ruleId === 'SEC-LEAK-001');
    expect(leakFinding).toBeDefined();
    expect(leakFinding?.severity).toBe('HIGH');
  });

  it('clears findings cleanly', () => {
    auditor.evaluateResponse({
      url: 'http://localhost:3000/',
      method: 'GET',
      statusCode: 200,
      requestHeaders: {},
      responseHeaders: { 'content-type': 'text/html' }
    });
    expect(auditor.getFindings().length).toBeGreaterThan(0);

    auditor.clearFindings();
    expect(auditor.getFindings()).toHaveLength(0);
  });
});
