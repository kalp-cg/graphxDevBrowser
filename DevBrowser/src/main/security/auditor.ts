import type { SecurityFinding, SecuritySeverity } from '../../shared/domain/security';
import { siteOf } from '../../shared/domain/browser';

export interface AuditContext {
  url: string;
  /** The page that was open when this response arrived. */
  pageUrl?: string;
  method: string;
  statusCode?: number;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export class PassiveSecurityAuditor {
  private findings: Map<string, SecurityFinding> = new Map();

  public evaluateResponse(ctx: AuditContext): SecurityFinding[] {
    const newFindings: SecurityFinding[] = [];
    if (!ctx.responseHeaders) return newFindings;

    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(ctx.responseHeaders)) {
      lowerHeaders[k.toLowerCase()] = v;
    }

    const isHtmlDocument = lowerHeaders['content-type']?.includes('text/html') ||
      ctx.url.endsWith('/') ||
      (!ctx.url.includes('.') && !lowerHeaders['content-type']?.includes('json'));

    // Rule 1: SEC-HDR-001 - Missing Content-Security-Policy
    if (isHtmlDocument) {
      const csp = lowerHeaders['content-security-policy'];
      if (!csp) {
        newFindings.push(this.createFinding({
          ruleId: 'SEC-HDR-001',
          severity: 'HIGH',
          title: 'Missing Content-Security-Policy (CSP)',
          description: 'The target origin failed to provide a Content-Security-Policy header, leaving the application exposed to Cross-Site Scripting (XSS).',
          remediation: "Add 'Content-Security-Policy: default-src \\'self\\'' to response headers.",
          url: ctx.url,
        pageUrl: ctx.pageUrl,
          method: ctx.method,
          statusCode: ctx.statusCode,
          rawSnippet: 'Header "Content-Security-Policy" is absent in HTTP response',
          cwe: 1021,
          owaspCategory: 'A05:2021-Security Misconfiguration'
        }));
      } else if (csp.includes('unsafe-inline') || csp.includes('unsafe-eval')) {
        newFindings.push(this.createFinding({
          ruleId: 'SEC-HDR-001',
          severity: 'MEDIUM',
          title: 'Permissive Content-Security-Policy (unsafe-inline / unsafe-eval)',
          description: 'The Content-Security-Policy allows unsafe inline scripts or eval, weakening XSS mitigation.',
          remediation: "Remove 'unsafe-inline' and 'unsafe-eval' from your CSP and use nonces or sha256 hashes.",
          url: ctx.url,
        pageUrl: ctx.pageUrl,
          method: ctx.method,
          statusCode: ctx.statusCode,
          rawSnippet: `Content-Security-Policy: ${csp}`,
          cwe: 1021,
          owaspCategory: 'A05:2021-Security Misconfiguration'
        }));
      }
    }

    // Rule 2: SEC-HDR-002 - Missing Strict-Transport-Security (HSTS) on HTTPS
    if (ctx.url.startsWith('https://')) {
      const hsts = lowerHeaders['strict-transport-security'];
      if (!hsts) {
        newFindings.push(this.createFinding({
          ruleId: 'SEC-HDR-002',
          severity: 'MEDIUM',
          title: 'Missing Strict-Transport-Security (HSTS)',
          description: 'HTTPS response lacks the Strict-Transport-Security header, allowing potential SSL-stripping man-in-the-middle attacks.',
          remediation: "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains; preload'",
          url: ctx.url,
        pageUrl: ctx.pageUrl,
          method: ctx.method,
          statusCode: ctx.statusCode,
          rawSnippet: 'Header "Strict-Transport-Security" is absent',
          cwe: 319,
          owaspCategory: 'A05:2021-Security Misconfiguration'
        }));
      }
    }

    // Rule 3: SEC-HDR-003 - Permissive CORS Configuration
    const allowOrigin = lowerHeaders['access-control-allow-origin'];
    const allowCredentials = lowerHeaders['access-control-allow-credentials'];
    if (allowOrigin === '*' && allowCredentials === 'true') {
      newFindings.push(this.createFinding({
        ruleId: 'SEC-HDR-003',
        severity: 'HIGH',
        title: 'Permissive Wildcard CORS with Credentials',
        description: 'The server returned Access-Control-Allow-Origin: * alongside Access-Control-Allow-Credentials: true, exposing authenticated responses to any origin.',
        remediation: 'Specify explicit trusted origins in Access-Control-Allow-Origin when credentials are supported.',
        url: ctx.url,
        pageUrl: ctx.pageUrl,
        method: ctx.method,
        statusCode: ctx.statusCode,
        rawSnippet: 'Access-Control-Allow-Origin: *\nAccess-Control-Allow-Credentials: true',
        cwe: 942,
        owaspCategory: 'A01:2021-Broken Access Control'
      }));
    }

    // Rule 4: SEC-CK-001 & SEC-CK-003 - Insecure Cookie Directives
    const setCookie = lowerHeaders['set-cookie'];
    if (setCookie) {
      const cookieLower = setCookie.toLowerCase();
      if (!cookieLower.includes('secure') && ctx.url.startsWith('https://')) {
        newFindings.push(this.createFinding({
          ruleId: 'SEC-CK-001',
          severity: 'HIGH',
          title: 'Cookie Missing Secure Directive on HTTPS',
          description: 'A Set-Cookie directive was transmitted over HTTPS without the Secure flag, allowing plaintext transmission over insecure redirects.',
          remediation: 'Append the "; Secure" attribute to all cookies issued over HTTPS.',
          url: ctx.url,
        pageUrl: ctx.pageUrl,
          method: ctx.method,
          statusCode: ctx.statusCode,
          rawSnippet: `Set-Cookie: ${setCookie}`,
          cwe: 614,
          owaspCategory: 'A05:2021-Security Misconfiguration'
        }));
      }

      if (!cookieLower.includes('samesite')) {
        newFindings.push(this.createFinding({
          ruleId: 'SEC-CK-003',
          severity: 'MEDIUM',
          title: 'Cookie Missing SameSite Directive',
          description: 'A cookie was created without an explicit SameSite attribute, making it subject to browser default laxness and cross-site request forgery risks.',
          remediation: 'Configure cookies with "; SameSite=Lax" or "; SameSite=Strict".',
          url: ctx.url,
        pageUrl: ctx.pageUrl,
          method: ctx.method,
          statusCode: ctx.statusCode,
          rawSnippet: `Set-Cookie: ${setCookie}`,
          cwe: 1275,
          owaspCategory: 'A01:2021-Broken Access Control'
        }));
      }
    }

    // Rule 5: SEC-LEAK-001 - Sensitive Token in URL Query Parameter
    if (/[?&](token|api_?key|secret|password|jwt)=/i.test(ctx.url)) {
      newFindings.push(this.createFinding({
        ruleId: 'SEC-LEAK-001',
        severity: 'HIGH',
        title: 'Sensitive Credential Exposed in URL Query Parameter',
        description: 'An authentication token or secret was detected in the URL query string. URLs are logged in web server logs, proxy caches, and Referer headers.',
        remediation: 'Transmit authentication tokens in HTTP request headers (e.g. Authorization: Bearer <token>) or in the request body.',
        url: ctx.url,
        pageUrl: ctx.pageUrl,
        method: ctx.method,
        statusCode: ctx.statusCode,
        rawSnippet: `URL: ${ctx.url}`,
        cwe: 598,
        owaspCategory: 'A04:2021-Insecure Design'
      }));
    }

    // Rule 6: SEC-LEAK-002 - Server Technology Version Disclosure
    const serverHeader = lowerHeaders['server'] || lowerHeaders['x-powered-by'];
    if (serverHeader && /[0-9]+\.[0-9]+/i.test(serverHeader)) {
      newFindings.push(this.createFinding({
        ruleId: 'SEC-LEAK-002',
        severity: 'LOW',
        title: 'Server Exact Version Disclosed',
        description: 'The server header reveals exact software versions (e.g. Apache/2.4.41), assisting automated attacker reconnaissance.',
        remediation: 'Suppress or genericize the Server and X-Powered-By response headers in web server configuration.',
        url: ctx.url,
        pageUrl: ctx.pageUrl,
        method: ctx.method,
        statusCode: ctx.statusCode,
        rawSnippet: `Server Header: ${serverHeader}`,
        cwe: 200,
        owaspCategory: 'A05:2021-Security Misconfiguration'
      }));
    }

    for (const f of newFindings) {
      this.findings.set(f.suppressionFingerprint, f);
    }

    return Array.from(this.findings.values());
  }

  public getFindings(): SecurityFinding[] {
    return Array.from(this.findings.values());
  }

  public clearFindings(): void {
    this.findings.clear();
  }

  private createFinding(opts: {
    ruleId: string;
    severity: SecuritySeverity;
    title: string;
    description: string;
    remediation: string;
    url: string;
    pageUrl?: string;
    method: string;
    statusCode?: number;
    rawSnippet?: string;
    cwe: number;
    owaspCategory: string;
  }): SecurityFinding {
    // One finding per rule, resource and website being browsed: the same resource seen from two sites is two findings.
    const fingerprint = `${opts.ruleId}-${new URL(opts.url).origin}-${siteOf(opts.pageUrl)}`;
    return {
      id: crypto.randomUUID(),
      ruleId: opts.ruleId,
      timestamp: Date.now(),
      severity: opts.severity,
      title: opts.title,
      description: opts.description,
      remediation: opts.remediation,
      evidence: {
        url: opts.url,
        method: opts.method,
        statusCode: opts.statusCode,
        rawSnippet: opts.rawSnippet
      },
      cwe: opts.cwe,
      owaspCategory: opts.owaspCategory,
      pageUrl: opts.pageUrl,
      isIgnored: false,
      suppressionFingerprint: fingerprint
    };
  }
}
