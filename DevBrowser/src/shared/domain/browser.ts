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

/** A browsing container: its own cookies, storage and cache (an Electron session partition). */
export interface Profile {
  key: string;
  name: string;
}

export const PROFILES: Profile[] = [
  { key: 'persist:dev-default', name: 'Default' },
  { key: 'persist:dev-admin', name: 'Admin' },
  { key: 'persist:dev-customer', name: 'Customer' }
];

/** Where the omnibox sends text that is not an address. */
export const SEARCH_URL = 'https://www.google.com/search?q=';

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|[\w-]+\.(?:local|test|localhost)|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i;

/**
 * Omnibox text -> a URL to load. Addresses keep their scheme; local and LAN hosts get http (dev servers rarely
 * serve TLS); anything with a dot and no spaces gets https; everything else is a search.
 */
export function toNavigableUrl(input: string): string {
  const text = input.trim();
  if (!text) return 'about:blank';
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text) || /^(about|data|file|view-source):/i.test(text)) return text;
  if (/^\d+$/.test(text)) return `http://localhost:${text}`; // "3000" -> the dev server on that port
  if (LOCAL_HOST.test(text)) return `http://${text}`;
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`;
  return SEARCH_URL + encodeURIComponent(text);
}

/** What the omnibox shows when it isn't being edited: no scheme, no trailing slash on a bare host. */
export function displayUrl(url: string): string {
  if (!url || url === 'about:blank') return '';
  return url.replace(/^https?:\/\//, '').replace(/^([^/?#]+)\/$/, '$1');
}

export type SiteSecurity = 'secure' | 'insecure' | 'local' | 'internal';

export function siteSecurity(url: string): SiteSecurity {
  if (url.startsWith('https://')) return 'secure';
  if (!url.startsWith('http://')) return 'internal';
  try {
    return LOCAL_HOST.test(new URL(url).host) ? 'local' : 'insecure';
  } catch {
    return 'insecure';
  }
}

/** A tab's label before the page reports a title: its host, or "New Tab". */
export function fallbackTitle(url: string): string {
  if (!url || url === 'about:blank') return 'New Tab';
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Device emulation presets (CSS pixels), as in Chrome DevTools' device toolbar. */
export interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  userAgent?: string;
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export const DEVICES: DevicePreset[] = [
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, scale: 2, mobile: true, userAgent: IPHONE_UA },
  { id: 'iphone-15', name: 'iPhone 15', width: 393, height: 852, scale: 3, mobile: true, userAgent: IPHONE_UA },
  { id: 'pixel-8', name: 'Pixel 8', width: 412, height: 915, scale: 2.625, mobile: true, userAgent: ANDROID_UA },
  { id: 'ipad-air', name: 'iPad Air', width: 820, height: 1180, scale: 2, mobile: true, userAgent: IPAD_UA },
  { id: 'laptop', name: 'Laptop', width: 1280, height: 800, scale: 2, mobile: false },
  { id: 'desktop', name: 'Desktop HD', width: 1920, height: 1080, scale: 1, mobile: false }
];

export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** The next zoom level up or down from `current`, Chrome's steps. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_LEVELS.find(z => z > current + 0.001) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;
  return [...ZOOM_LEVELS].reverse().find(z => z < current - 0.001) ?? ZOOM_LEVELS[0]!;
}

/** The website of a page URL (`http://localhost:7400`), or '' for pages that are not on the web (new tab, about:blank). */
export function siteOf(url: string | undefined): string {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

/** What belongs to the page being viewed: items captured while that website was open. Nothing on a non-web page. */
export function forSite<T extends { pageUrl?: string }>(items: T[], currentUrl: string): T[] {
  const site = siteOf(currentUrl);
  return site ? items.filter(i => siteOf(i.pageUrl) === site) : [];
}

/** DevTools' network presets: throughput in kilobits per second, latency in milliseconds. */
export const THROTTLES = [
  { id: 'none', label: 'No throttling', offline: false, down: -1, up: -1, latency: 0 },
  { id: 'fast-3g', label: 'Fast 3G', offline: false, down: 1600, up: 750, latency: 562.5 },
  { id: 'slow-3g', label: 'Slow 3G', offline: false, down: 400, up: 400, latency: 2000 },
  { id: 'offline', label: 'Offline', offline: true, down: 0, up: 0, latency: 0 }
] as const;
export type ThrottleId = (typeof THROTTLES)[number]['id'];

/** The Chrome DevTools Protocol `Network.emulateNetworkConditions` parameters for a preset (bytes per second). */
export function throttleConditions(id: string): { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number } {
  const t = THROTTLES.find(p => p.id === id) ?? THROTTLES[0];
  const bytes = (kbps: number) => (kbps < 0 ? -1 : Math.round((kbps * 1000) / 8));
  return { offline: t.offline, latency: t.latency, downloadThroughput: bytes(t.down), uploadThroughput: bytes(t.up) };
}

export interface Bookmark {
  url: string;
  title: string;
  at: number;
}

const bookmarkKey = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '');

export const MAX_BOOKMARKS = 200;

/** A page can be bookmarked; web pages only, and the address ignores a trailing slash and the #fragment. */
export function canBookmark(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function isBookmarked(list: Bookmark[], url: string): boolean {
  return list.some(b => bookmarkKey(b.url) === bookmarkKey(url));
}

/** Adds the page at the top, or removes it if it is already there. */
export function toggleBookmark(list: Bookmark[], url: string, title: string, at = Date.now()): Bookmark[] {
  if (!canBookmark(url)) return list;
  if (isBookmarked(list, url)) return list.filter(b => bookmarkKey(b.url) !== bookmarkKey(url));
  return [{ url, title: title.trim() || fallbackTitle(url), at }, ...list].slice(0, MAX_BOOKMARKS);
}
