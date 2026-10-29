import { z } from 'zod';

export type SecuritySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export const SecurityEvidenceSchema = z.object({
  url: z.string(),
  method: z.string(),
  statusCode: z.number().optional(),
  requestHeaders: z.record(z.string()).optional(),
  responseHeaders: z.record(z.string()).optional(),
  rawSnippet: z.string().optional(),
  cookieName: z.string().optional(),
  lineOffset: z.number().optional()
});
export type SecurityEvidence = z.infer<typeof SecurityEvidenceSchema>;

export const SecurityFindingSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string(),
  timestamp: z.number(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
  title: z.string(),
  description: z.string(),
  remediation: z.string(),
  evidence: SecurityEvidenceSchema,
  cwe: z.number(),
  owaspCategory: z.string(),
  isIgnored: z.boolean().default(false),
  suppressionFingerprint: z.string()
});
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;

export interface ISecurityRule {
  readonly id: string;
  readonly name: string;
  readonly severity: SecuritySeverity;
  readonly cwe: number;
  readonly owaspCategory: string;
  readonly description: string;
  readonly remediation: string;

  evaluate(context: {
    url: string;
    method: string;
    statusCode: number;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    cookies?: Array<{ name: string; value: string; raw: string }>;
  }): SecurityFinding | null;
}
