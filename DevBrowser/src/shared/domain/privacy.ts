import { z } from 'zod';

export const PrivacySettingsSchema = z.object({
  telemetryEnabled: z.boolean().default(false), // STRICT DEFAULT: FALSE
  crashReportingEnabled: z.boolean().default(false),
  keychainEncryptionActive: z.boolean().default(true),
  autoPurgeHistoryDays: z.number().int().min(0).default(30), // 0 = never
  maxCachedRequestBodyBytes: z.number().int().default(10485760), // 10MB
  maskAuthHeadersInHar: z.boolean().default(true)
});
export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>;

export const NuclearShredOptionsSchema = z.object({
  purgeSqliteDatabases: z.boolean().default(true),
  purgeKeychainCredentials: z.boolean().default(true),
  purgeSessionPartitions: z.boolean().default(true),
  purgeNetworkCache: z.boolean().default(true),
  purgeOllamaModelCache: z.boolean().default(false)
});
export type NuclearShredOptions = z.infer<typeof NuclearShredOptionsSchema>;

export const ShredResultSchema = z.object({
  success: z.boolean(),
  purgedItemsCount: z.number(),
  timestamp: z.number(),
  details: z.array(z.string())
});
export type ShredResult = z.infer<typeof ShredResultSchema>;
