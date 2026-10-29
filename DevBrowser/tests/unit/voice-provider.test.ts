import { describe, it, expect } from 'vitest';
import type { 
  IVoiceInputProvider, 
  VoiceContext, 
  VoiceTranscriptionResult 
} from '../../src/shared/domain/voice';

// Mock Wispr Flow Provider verifying interface conformance
class MockWisprFlowProvider implements IVoiceInputProvider {
  public readonly providerId = 'wispr-flow-mock-provider';
  public readonly providerName = 'Wispr Flow Mock';

  private active = false;

  async initialize(_config: Record<string, unknown>): Promise<void> {
    this.active = false;
  }

  async isAvailable(): Promise<boolean> {
    return !this.active;
  }

  async startListening(
    _context: VoiceContext,
    onChunk: (partial: VoiceTranscriptionResult) => void
  ): Promise<void> {
    this.active = true;
    onChunk({
      id: 'chunk-1',
      text: 'Create a test asserting status is 200',
      confidence: 0.98,
      isFinal: false,
      durationMs: 400
    });
  }

  async stopListening(): Promise<VoiceTranscriptionResult> {
    this.active = false;
    return {
      id: 'final-1',
      text: 'Create a test asserting status is 200',
      confidence: 0.99,
      isFinal: true,
      durationMs: 850
    };
  }

  cancel(): void {
    this.active = false;
  }
}

describe('IVoiceInputProvider Integration Interface', () => {
  it('conforms to voice provider contract and processes Wispr Flow context', async () => {
    const provider: IVoiceInputProvider = new MockWisprFlowProvider();
    await provider.initialize({});

    const available = await provider.isAvailable();
    expect(available).toBe(true);

    const context: VoiceContext = {
      activePanel: 'API_CLIENT',
      surroundingText: {
        beforeText: 'pm.test(',
        selectedText: '',
        afterText: ');'
      },
      detectedLanguage: 'en',
      appType: 'developer_browser'
    };

    let partialReceived = false;
    await provider.startListening(context, (chunk) => {
      partialReceived = chunk.text.length > 0;
    });

    expect(partialReceived).toBe(true);

    const finalResult = await provider.stopListening();
    expect(finalResult.isFinal).toBe(true);
    expect(finalResult.text).toContain('status is 200');
  });
});
