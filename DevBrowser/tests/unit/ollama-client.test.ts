import { describe, it, expect } from 'vitest';
import { OllamaClient } from '../../src/main/ai/ollama-client';

describe('OllamaClient & AI Privacy Sanitization', () => {
  const client = new OllamaClient('http://127.0.0.1:11434', 'qwen2.5-coder:7b');

  it('redacts JWT bearer tokens from input contexts', () => {
    const raw = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis';
    const sanitized = client.sanitizeTokens(raw);

    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(sanitized).toContain('Bearer [REDACTED_JWT]');
  });

  it('redacts AWS Access Keys from input contexts', () => {
    const raw = 'AWS credentials: AKIAIOSFODNN7EXAMPLE used in S3 upload';
    const sanitized = client.sanitizeTokens(raw);

    expect(sanitized).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(sanitized).toContain('[REDACTED_AWS_KEY]');
  });

  it('redacts inline passwords and tokens', () => {
    const raw = 'Error: password: "super_secret_dev_pass" failed authentication';
    const sanitized = client.sanitizeTokens(raw);

    expect(sanitized).not.toContain('super_secret_dev_pass');
    expect(sanitized).toContain('password=[REDACTED]');
  });
});
