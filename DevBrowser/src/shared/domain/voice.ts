import { z } from 'zod';

export type VoiceActivePanel = 'API_CLIENT' | 'AI_PROMPT' | 'SECURITY_AUDIT' | 'SEARCH' | 'CODE_EDITOR';

export const VoiceContextSchema = z.object({
  activePanel: z.enum(['API_CLIENT', 'AI_PROMPT', 'SECURITY_AUDIT', 'SEARCH', 'CODE_EDITOR']),
  currentCodeSelection: z.string().optional(),
  surroundingText: z.object({
    beforeText: z.string().default(''),
    selectedText: z.string().default(''),
    afterText: z.string().default('')
  }).optional(),
  detectedLanguage: z.string().default('en'),
  appType: z.string().default('developer_browser')
});
export type VoiceContext = z.infer<typeof VoiceContextSchema>;

export const VoiceTranscriptionResultSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  confidence: z.number().min(0).max(1).default(1.0),
  isFinal: z.boolean().default(true),
  durationMs: z.number().default(0),
  detectedLanguage: z.string().optional()
});
export type VoiceTranscriptionResult = z.infer<typeof VoiceTranscriptionResultSchema>;

export interface IVoiceInputProvider {
  readonly providerId: string;
  readonly providerName: string;

  initialize(config: Record<string, unknown>): Promise<void>;
  isAvailable(): Promise<boolean>;
  startListening(
    context: VoiceContext,
    onChunk: (partialResult: VoiceTranscriptionResult) => void
  ): Promise<void>;
  stopListening(): Promise<VoiceTranscriptionResult>;
  cancel(): void;
}
