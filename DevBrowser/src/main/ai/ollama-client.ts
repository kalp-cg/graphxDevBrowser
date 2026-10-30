import http from 'node:http';
import type { AIDebugContext, AICodeDiff } from '../../shared/domain/ai';

export interface OllamaChatOptions {
  model?: string;
  temperature?: number;
  keepAlive?: string;
}

export class OllamaClient {
  private host: string;
  private defaultModel: string;

  constructor(host = 'http://127.0.0.1:11434', defaultModel = 'qwen2.5-coder:7b') {
    this.host = host;
    this.defaultModel = defaultModel;
  }

  public async checkHealth(): Promise<{ ok: boolean; models: string[]; primaryModel: string }> {
    return new Promise((resolve) => {
      const url = new URL('/api/tags', this.host);
      const req = http.get(url, { timeout: 2000 }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            const models = (data.models || []).map((m: { name: string }) => m.name);
            const primary = models.find((m: string) => m.includes('qwen2.5-coder')) || models[0] || 'none';
            resolve({ ok: true, models, primaryModel: primary });
          } catch {
            resolve({ ok: false, models: [], primaryModel: 'none' });
          }
        });
      });

      req.on('error', () => resolve({ ok: false, models: [], primaryModel: 'none' }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, models: [], primaryModel: 'none' });
      });
    });
  }

  public async generateChat(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options?: OllamaChatOptions,
    onChunk?: (token: string) => void
  ): Promise<string> {
    const payload = JSON.stringify({
      model: options?.model || this.defaultModel,
      messages,
      stream: !!onChunk,
      options: {
        temperature: options?.temperature ?? 0.2
      },
      keep_alive: options?.keepAlive || '5m'
    });

    const parsedUrl = new URL('/api/chat', this.host);

    return new Promise((resolve, reject) => {
      const req = http.request(
        parsedUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 45000
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Ollama returned HTTP ${res.statusCode}`));
            return;
          }

          let completeResponse = '';

          res.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                const content = parsed.message?.content || '';
                completeResponse += content;
                if (onChunk && content) {
                  onChunk(content);
                }
              } catch {
                // Ignore partial JSON chunks
              }
            }
          });

          res.on('end', () => {
            resolve(completeResponse);
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama request timed out'));
      });

      req.write(payload);
      req.end();
    });
  }

  public async diagnoseContext(
    context: AIDebugContext,
    onChunk?: (chunk: string) => void
  ): Promise<{ diagnosis: string; suggestedDiff?: AICodeDiff }> {
    // Sanitize context
    const sanitizedError = this.sanitizeTokens(context.errorMessage);
    const sanitizedStack = context.stackTrace ? this.sanitizeTokens(context.stackTrace) : '';

    const systemPrompt = 
      'You are DevBrowser Local AI, an expert debugging assistant running locally. ' +
      'Diagnose the developer error concisely, state the root cause, and provide a unified git diff patch if code needs fixing.';

    const userPrompt = 
      `Error Message: ${sanitizedError}\n` +
      (sanitizedStack ? `Stack Trace:\n${sanitizedStack}\n` : '') +
      (context.failedRequestUrl ? `Failing Request: ${context.failedRequestUrl}\n` : '') +
      (context.failedResponseStatus ? `Response Status: ${context.failedResponseStatus}\n` : '') +
      (context.failedResponseBody ? `Response Body: ${context.failedResponseBody}\n` : '');

    const response = await this.generateChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { temperature: 0.2 },
      onChunk
    );

    return {
      diagnosis: response
    };
  }

  public sanitizeTokens(text: string): string {
    return text
      .replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer [REDACTED_JWT]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
      .replace(/(password|secret|token)\s*[:=]\s*["']?[^"',\s]+/gi, '$1=[REDACTED]');
  }
}
