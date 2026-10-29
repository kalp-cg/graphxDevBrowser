import { z } from 'zod';

export const StorageMetadataSchema = z.object({
  schemaVersion: z.number().int().default(1),
  lastVacuumAt: z.number().optional(),
  databaseSizeBytes: z.number().int().default(0),
  totalNetworkEntries: z.number().int().default(0),
  totalSecurityFindings: z.number().int().default(0)
});
export type StorageMetadata = z.infer<typeof StorageMetadataSchema>;

export const PersistenceQuerySchema = z.object({
  limit: z.number().int().min(1).max(5000).default(100),
  offset: z.number().int().min(0).default(0),
  searchTerm: z.string().optional(),
  startDate: z.number().optional(),
  endDate: z.number().optional(),
  tabId: z.string().uuid().optional()
});
export type PersistenceQuery = z.infer<typeof PersistenceQuerySchema>;
