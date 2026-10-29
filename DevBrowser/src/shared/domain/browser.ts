import { z } from 'zod';

export type SplitLayoutMode = 'single' | 'split-vertical' | 'split-horizontal' | 'grid-2x2';

export const ProfilePartitionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  partitionKey: z.string().min(1),
  color: z.string(),
  isEphemeral: z.boolean().default(false),
  createdAt: z.number()
});
export type ProfilePartition = z.infer<typeof ProfilePartitionSchema>;

export const TabHibernationStateSchema = z.object({
  isHibernated: z.boolean(),
  hibernatedAt: z.number().optional(),
  serializedScrollOffset: z.object({ x: z.number(), y: z.number() }).optional(),
  lastUrl: z.string().url()
});
export type TabHibernationState = z.infer<typeof TabHibernationStateSchema>;

export const BrowserTabSchema = z.object({
  id: z.string().uuid(),
  partitionId: z.string().uuid(),
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string().optional(),
  isLoading: z.boolean().default(false),
  canGoBack: z.boolean().default(false),
  canGoForward: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  hibernation: TabHibernationStateSchema,
  activeSplitPane: z.enum(['left', 'right', 'top', 'bottom', 'main']).default('main')
});
export type BrowserTab = z.infer<typeof BrowserTabSchema>;

export const WorkspaceSessionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  tabs: z.array(BrowserTabSchema),
  activeTabId: z.string().uuid().nullable(),
  layoutMode: z.enum(['single', 'split-vertical', 'split-horizontal', 'grid-2x2']).default('single'),
  activeEnvironmentId: z.string().uuid().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type WorkspaceSession = z.infer<typeof WorkspaceSessionSchema>;
