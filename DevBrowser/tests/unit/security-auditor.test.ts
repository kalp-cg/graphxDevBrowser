import { describe, it, expect, beforeEach } from 'vitest';
import { PassiveSecurityAuditor } from '../../src/main/security/auditor';
import { forSite, siteOf } from '../../src/shared/domain/browser';

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

  it('remembers which page a finding was found on, so a panel can show only the open website', () => {
    const html = { 'content-type': 'text/html' };
    const audit = (url: string, pageUrl: string) =>
      auditor.evaluateResponse({ url, pageUrl, method: 'GET', statusCode: 200, requestHeaders: {}, responseHeaders: html });
    audit('http://localhost:7400/', 'http://localhost:7400/');
    audit('https://www.google.com/gen_204', 'https://www.google.com/search?q=x');
    // The same resource embedded by two sites is a finding for each, not one that hides from the second.
    audit('https://cdn.example.com/lib.js/', 'http://localhost:7400/');
    audit('https://cdn.example.com/lib.js/', 'https://www.google.com/search?q=x');
    const all = auditor.getFindings().filter(f => f.ruleId === 'SEC-HDR-001');
    expect(all).toHaveLength(4);
    expect(forSite(all, 'http://localhost:7400/cart').map(f => f.evidence.url).sort())
      .toEqual(['http://localhost:7400/', 'https://cdn.example.com/lib.js/']);
    expect(forSite(all, 'https://www.google.com/').length).toBe(2);
    expect(forSite(all, 'about:blank')).toEqual([]);
    expect(forSite(all, 'http://localhost:9999/')).toEqual([]);
  });

  it('treats ports and schemes as different websites', () => {
    expect(siteOf('http://localhost:7400/a?b#c')).toBe('http://localhost:7400');
    expect(siteOf('https://example.com')).toBe('https://example.com');
    expect(siteOf('http://localhost:7401/')).not.toBe(siteOf('http://localhost:7400/'));
    expect(siteOf('about:blank')).toBe('');
    expect(siteOf(undefined)).toBe('');
  });
});
