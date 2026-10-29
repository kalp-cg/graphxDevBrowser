import { describe, it, expect } from 'vitest';
import { validateEnvironment } from '../../src/shared/env';

describe('Environment Validation', () => {
  it('applies secure defaults when environment is minimal', () => {
    const config = validateEnvironment({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.OLLAMA_HOST).toBe('http://127.0.0.1:11434');
    expect(config.HARDWARE_RAM_BUDGET_MB).toBe(2560);
  });

  it('accepts valid production environment overrides', () => {
    const config = validateEnvironment({
      NODE_ENV: 'production',
      OLLAMA_HOST: 'http://127.0.0.1:11434',
      DEV_BROWSER_LOG_LEVEL: 'warn'
    });
    expect(config.NODE_ENV).toBe('production');
    expect(config.DEV_BROWSER_LOG_LEVEL).toBe('warn');
  });

  it('rejects invalid NODE_ENV values', () => {
    expect(() => {
      validateEnvironment({
        NODE_ENV: 'invalid-environment-value'
      });
    }).toThrow('Environment configuration validation failed');
  });
});
