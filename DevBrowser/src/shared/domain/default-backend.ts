/**
 * The SentinelGraph server an installer comes with, so a fresh install shows a working system map on first launch. The release
 * workflow writes `default-backend.json` (`{"url": "https://…"}`) next to the app; a build without it connects to nothing by itself.
 */
export function parseDefaultBackend(text: string): string | null {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  const url = (json as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null; // credentials do not belong in a file shipped to everyone
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
