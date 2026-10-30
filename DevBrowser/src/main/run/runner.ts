import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parsePortOwner, suggestCommands, type CommandSuggestion, type PortOwner, type RunEvent } from '../../shared/domain/run';


const MAX_COMMAND = 2000;
const KILL_AFTER_MS = 3000;

interface Active {
  child: ChildProcess;
  stopped: boolean;
}

/**
 * Runs the developer's own command (a dev server, a build, a test run) in their folder and streams what it prints. It is the same as typing
 * the command in a terminal there: nothing is sandboxed, because it is their project. `BROWSER=none` keeps tools such as create-react-app
 * from opening another browser, and colours are asked off so the output is readable.
 */
export class Runner {
  private runs = new Map<string, Active>();
  private n = 0;

  constructor(private readonly emit: (e: RunEvent) => void) {}

  start(command: string, cwd: string): { id: string } {
    command = command.trim();
    if (!command || command.length > MAX_COMMAND) throw new Error('Type a command to run');
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`${cwd} is not a folder`);
    const id = `run-${++this.n}`;
    const child = spawn(command, {
      cwd, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none', NO_COLOR: '1', FORCE_COLOR: '0', CI: '', PYTHONUNBUFFERED: '1' }
    });
    const active: Active = { child, stopped: false };
    this.runs.set(id, active);
    const pipe = (stream: 'out' | 'err', src: NodeJS.ReadableStream | null) => {
      let rest = '';
      src?.setEncoding('utf8');
      src?.on('data', (chunk: string) => {
        const parts = (rest + chunk).split(/\r?\n/);
        rest = parts.pop() ?? '';
        for (const text of parts) this.emit({ id, kind: 'line', stream, text });
      });
      src?.on('end', () => { if (rest) this.emit({ id, kind: 'line', stream, text: rest }); });
    };
    pipe('out', child.stdout);
    pipe('err', child.stderr);
    child.on('error', err => this.emit({ id, kind: 'line', stream: 'err', text: String(err.message) }));
    child.on('close', (code, signal) => {
      this.runs.delete(id);
      this.emit({ id, kind: 'exit', code, signal, stopped: active.stopped });
    });
    return { id };
  }

  /** Stop the command and everything it started (a dev server's workers, a shell's children). */
  stop(id: string): void {
    const run = this.runs.get(id);
    if (!run?.child.pid) return;
    run.stopped = true;
    killTree(run.child.pid, 'SIGTERM');
    setTimeout(() => { if (this.runs.has(id) && run.child.pid) killTree(run.child.pid, 'SIGKILL'); }, KILL_AFTER_MS).unref();
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id);
  }
}

function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => undefined);
    else process.kill(-pid, signal);   // the whole process group: it was started detached
  } catch {
    // already gone
  }
}

/** What is in a folder, as the suggestions need it. */
export function inspectFolder(cwd: string): { name: string; suggestions: CommandSuggestion[] } {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`${cwd} is not a folder`);
  const entries = readdirSync(cwd);
  let pkg = null;
  try {
    if (entries.includes('package.json')) pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    // a package.json that does not parse: suggest what else is there
  }
  return { name: path.basename(cwd), suggestions: suggestCommands({ entries, pkg }) };
}

/** Which process is listening on a port. Best effort: the tools differ by system and may be missing. */
export function portOwner(port: number): Promise<PortOwner | null> {
  return new Promise(resolve => {
    const [cmd, args] = process.platform === 'win32' ? ['netstat', ['-ano', '-p', 'TCP']] : ['lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']];
    execFile(cmd!, args as string[], { timeout: 4000 }, (_err, stdout) => resolve(parsePortOwner(process.platform, stdout ?? '', port)));
  });
}

export function killPid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/F'], () => undefined);
    else process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
