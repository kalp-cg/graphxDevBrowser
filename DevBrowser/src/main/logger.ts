import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;
let file: string | null = null;

function target(): string | null {
  if (file) return file;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'devbrowser.log');
    return file;
  } catch {
    return null;
  }
}

/** One line per event in `<userData>/logs/devbrowser.log`, kept to ~4 MB (the previous file is `.1`). */
export function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${
    detail === undefined ? '' : ` ${detail instanceof Error ? detail.stack ?? detail.message : JSON.stringify(detail)}`}\n`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line.trimEnd());
  const f = target();
  if (!f) return;
  try {
    if (fs.existsSync(f) && fs.statSync(f).size > MAX_BYTES) fs.renameSync(f, `${f}.1`);
    fs.appendFileSync(f, line);
  } catch {
    // Logging must never take the app down.
  }
}

export function logDirectory(): string {
  return path.dirname(target() ?? path.join(app.getPath('userData'), 'logs', 'x'));
}
