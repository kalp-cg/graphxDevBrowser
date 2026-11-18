import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';

export const LOCAL_SENTINEL_URL = 'http://127.0.0.1:8100';
const READY_TIMEOUT_MS = 45_000;

let child: ChildProcess | null = null;

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function pythonIn(backendDir: string): string | null {
  const candidates = process.platform === 'win32'
    ? [path.join(backendDir, '.venv', 'Scripts', 'python.exe')]
    : [path.join(backendDir, '.venv', 'bin', 'python')];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

/**
 * DevBrowser and SentinelGraph are one product: when the app runs from a checkout (`npm run dev`), it starts the
 * SentinelGraph server from `../backend` itself, on loopback only, and stops it on quit. A server that is already
 * running on the port is used as is. Returns the URL to connect to, or null when there is no server to start
 * (an installed build, or a checkout without `backend/.venv`: run ./scripts/sentinelgraph.sh once to create it).
 */
export async function startLocalSentinel(appPath: string): Promise<string | null> {
  if (await healthy(LOCAL_SENTINEL_URL)) {
    log('info', `SentinelGraph already running at ${LOCAL_SENTINEL_URL}`);
    return LOCAL_SENTINEL_URL;
  }
  const backendDir = path.resolve(appPath, '..', 'backend');
  const python = pythonIn(backendDir);
  if (!python) {
    log('info', `no SentinelGraph to start (${backendDir}/.venv not found)`);
    return null;
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  // First launch: load the sample company so the map is not empty. A graph that already has services
  // (your own codebase, connected earlier) is left alone.
  await new Promise<void>(resolve => execFile(python, ['-m', 'sentinel.seed', '--if-empty'], { cwd: backendDir, env, timeout: 60_000 },
    (err, stdout, stderr) => {
      log(err ? 'warn' : 'info', `SentinelGraph seed: ${(stdout || stderr || String(err ?? '')).trim().slice(0, 300)}`);
      resolve();
    }));

  child = spawn(python, ['-m', 'uvicorn', 'sentinel.api.main:app', '--host', '127.0.0.1', '--port', '8100'],
    { cwd: backendDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (d: Buffer) => log('info', `[sentinelgraph] ${d.toString().trim()}`));
  child.stderr?.on('data', (d: Buffer) => log('info', `[sentinelgraph] ${d.toString().trim()}`));
  child.on('exit', code => { log('warn', `SentinelGraph server exited (${code})`); child = null; });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline && child) {
    if (await healthy(LOCAL_SENTINEL_URL)) {
      log('info', `SentinelGraph started at ${LOCAL_SENTINEL_URL}`);
      return LOCAL_SENTINEL_URL;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  log('error', 'SentinelGraph did not start in time');
  stopLocalSentinel();
  return null;
}

export function stopLocalSentinel(): void {
  child?.kill('SIGTERM');
  child = null;
}
