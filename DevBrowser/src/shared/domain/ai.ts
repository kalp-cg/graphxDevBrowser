import { z } from 'zod';

export const AIModelConfigSchema = z.object({
  name: z.string(),
  provider: z.enum(['ollama-local', 'byok-cloud']),
  contextWindow: z.number().default(16384),
  temperature: z.number().min(0).max(1).default(0.2),
  keepAlive: z.string().default('5m')
});
export type AIModelConfig = z.infer<typeof AIModelConfigSchema>;

export const AIDebugContextSchema = z.object({
  errorMessage: z.string(),
  stackTrace: z.string().optional(),
  failedRequestUrl: z.string().optional(),
  failedRequestBody: z.string().optional(),
  failedResponseStatus: z.number().optional(),
  failedResponseBody: z.string().optional(),
  consoleLogs: z.array(z.string()).default([]),
  detectedFramework: z.string().optional()
});
export type AIDebugContext = z.infer<typeof AIDebugContextSchema>;

export const AICodeDiffSchema = z.object({
  filePath: z.string().optional(),
  originalSnippet: z.string(),
  replacementSnippet: z.string(),
  unifiedDiff: z.string(),
  explanation: z.string()
});
export type AICodeDiff = z.infer<typeof AICodeDiffSchema>;

export const AITestGenerationRequestSchema = z.object({
  testFramework: z.enum(['playwright', 'jest', 'cypress']),
  interactionSteps: z.array(z.string()),
  targetUrl: z.string().url(),
  assertionsExpected: z.array(z.string())
});
export type AITestGenerationRequest = z.infer<typeof AITestGenerationRequestSchema>;

export interface IAIAssistantProvider {
  readonly providerId: string;
  readonly providerName: string;

  checkAvailability(): Promise<{ available: boolean; installedModels: string[] }>;
  diagnoseError(context: AIDebugContext, onChunk?: (chunk: string) => void): Promise<{ diagnosis: string; suggestedDiff?: AICodeDiff }>;
  generateTest(request: AITestGenerationRequest): Promise<{ testCode: string; framework: string }>;
  cancelCurrentTask(): void;
}
