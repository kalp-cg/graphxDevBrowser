import { z } from 'zod';

export const EnvironmentConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OLLAMA_HOST: z.string().default('http://127.0.0.1:11434'),
  TIGERGRAPH_HOST: z.string().default('http://127.0.0.1:9000'),
  DEV_BROWSER_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEFAULT_AI_MODEL: z.string().default('qwen2.5-coder:7b'),
  HARDWARE_RAM_BUDGET_MB: z.number().int().default(2560) // 2.5 GB max app budget on 16GB M4
});

export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;

export function validateEnvironment(env: Record<string, unknown> = process.env): EnvironmentConfig {
  const result = EnvironmentConfigSchema.safeParse(env);
  if (!result.success) {
    console.error('Invalid Dev Browser Environment Variables:', result.error.format());
    throw new Error('Environment configuration validation failed');
  }
  return result.data;
}
