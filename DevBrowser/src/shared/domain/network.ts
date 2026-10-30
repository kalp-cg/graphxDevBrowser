import { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export const NetworkTimingSchema = z.object({
  requestTime: z.number(),
  dnsStart: z.number().optional(),
  dnsEnd: z.number().optional(),
  connectStart: z.number().optional(),
  connectEnd: z.number().optional(),
  sslStart: z.number().optional(),
  sslEnd: z.number().optional(),
  sendStart: z.number().optional(),
  sendEnd: z.number().optional(),
  receiveHeadersEnd: z.number().optional()
});
export type NetworkTiming = z.infer<typeof NetworkTimingSchema>;

export const WebSocketFrameSchema = z.object({
  id: z.string(),
  direction: z.enum(['send', 'receive']),
  opcode: z.number(),
  payloadData: z.string(),
  timestamp: z.number()
});
export type WebSocketFrame = z.infer<typeof WebSocketFrameSchema>;

export const NetworkTransactionSchema = z.object({
  id: z.string(),
  tabId: z.string().uuid(),
  url: z.string().url(),
  method: z.string(),
  statusCode: z.number().optional(),
  statusText: z.string().optional(),
  protocol: z.string().optional(), // 'http/1.1', 'h2', 'h3'
  mimeType: z.string().optional(),
  requestHeaders: z.record(z.string()),
  responseHeaders: z.record(z.string()).optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  isTruncated: z.boolean().default(false),
  encodedBodyLength: z.number().optional(),
  timing: NetworkTimingSchema.optional(),
  websocketFrames: z.array(WebSocketFrameSchema).optional(),
  /** The page (top-level URL) that was open when the request was made. */
  pageUrl: z.string().optional(),
  startTime: z.number(),
  endTime: z.number().optional(),
  error: z.string().optional()
});
export type NetworkTransaction = z.infer<typeof NetworkTransactionSchema>;

export const HarExportFilterSchema = z.object({
  redactAuthHeaders: z.boolean().default(true),
  tabId: z.string().uuid().optional(),
  searchQuery: z.string().optional(),
  statusCodes: z.array(z.number()).optional()
});
export type HarExportFilter = z.infer<typeof HarExportFilterSchema>;
