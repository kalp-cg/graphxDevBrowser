/**
 * Running your project from the browser: what its output means.
 *
 * Everything here is plain text in, plain facts out, so it works for any language or tool: a Node server, a Django app, a Go binary, a
 * Gradle build. Nothing is specific to one stack except the patterns of the well-known errors, and when none match the last line that
 * looks like an error is shown as it is.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, '');

const LOCAL = '(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1?\\]|::1?)';
const URL_IN_TEXT = new RegExp(`https?://${LOCAL}:\\d{2,5}[^\\s"')\\]>]*`, 'gi');
const PORT_ONLY = /(?:listening|running|started|serving|available|ready)\b[^\n]{0,40}?\b(?:on|at)\b[^\n\d]{0,20}?(?:port\s*|:)(\d{2,5})\b/i;

/** Local addresses a dev server announces, in order, as `http://localhost:PORT`. `0.0.0.0` and IPv6 loopback are shown as localhost. */
export function detectLocalUrls(text: string): string[] {
  const found: string[] = [];
  for (const line of stripAnsi(text).split('\n')) {
    const urls = line.match(URL_IN_TEXT);
    for (const raw of urls ?? []) {
      const u = new URL(raw.replace(/\[::1?\]|::1?(?=:\d)/, 'localhost'));
      const url = `${u.protocol}//${u.hostname === '0.0.0.0' ? 'localhost' : u.hostname}:${u.port}${u.pathname === '/' ? '' : u.pathname}`;
      if (!found.includes(url)) found.push(url);
    }
    if (!urls) {
      const port = PORT_ONLY.exec(line)?.[1];
      if (port && +port > 0 && +port < 65536 && !found.includes(`http://localhost:${port}`)) found.push(`http://localhost:${port}`);
    }
  }
  return found;
}

export interface Failure {
  kind: string;
  title: string;
  hint: string;
  /** The line of output that says it. */
  evidence: string;
  /** For a port that is taken. */
  port?: number;
}

const SERVICES: Record<string, string> = { '5432': 'PostgreSQL', '3306': 'MySQL', '6379': 'Redis', '27017': 'MongoDB', '9092': 'Kafka',
  '5672': 'RabbitMQ', '9200': 'Elasticsearch', '11211': 'Memcached', '1433': 'SQL Server', '9042': 'Cassandra' };

type Rule = { kind: string; test: RegExp; make: (m: RegExpExecArray, line: string) => Omit<Failure, 'kind' | 'evidence'> };

// Most specific first: the first rule that matches any recent line wins.
const RULES: Rule[] = [
  { kind: 'port-in-use', test: /EADDRINUSE[^\n]*?:(\d{2,5})|address already in use[^\n]*?:(\d{2,5})|port[ :]+(\d{2,5})[^\n]*?(?:already|is) in use|Port (\d{2,5}) was already in use|bind: address already in use/i,
    make: m => {
      const port = +(m[1] ?? m[2] ?? m[3] ?? m[4] ?? 0) || undefined;
      return { title: port ? `Port ${port} is already taken` : 'The port is already taken',
        hint: 'Another process is listening there, usually an earlier run of this same server that never stopped.', port };
    } },
  { kind: 'db-refused', test: /ECONNREFUSED[^\n]*?(?:127\.0\.0\.1|localhost|::1):(\d{2,5})|connection to server at[^\n]*?port (\d{2,5})[^\n]*?refused|Can't connect to [^\n]*?:(\d{2,5})/i,
    make: m => {
      const port = m[1] ?? m[2] ?? m[3] ?? '';
      const name = SERVICES[port];
      return { title: name ? `${name} is not reachable on port ${port}` : `Nothing is answering on port ${port}`,
        hint: name ? `Start ${name} (or its container), or check the address in your environment settings.` : 'The thing this app connects to is not running, or the address is wrong.' };
    } },
  { kind: 'missing-module', test: /Cannot find module '([^']+)'|Error \[ERR_MODULE_NOT_FOUND\][^\n]*?'([^']+)'|Module not found: [^\n]*?'([^']+)'/,
    make: m => {
      const name = m[1] ?? m[2] ?? m[3] ?? '';
      const relative = name.startsWith('.') || name.startsWith('/');
      return { title: `Missing module "${name}"`,
        hint: relative ? 'A file this code imports does not exist at that path: check the spelling and the folder.'
          : `Install dependencies (npm install, or add "${name}" with your package manager).` };
    } },
  { kind: 'missing-module', test: /(?:ModuleNotFoundError|ImportError)[^\n]*?(?:No module named|cannot import name) '([^']+)'/,
    make: m => ({ title: `Python cannot find "${m[1]}"`, hint: `Activate your virtual environment and install it (pip install ${m[1]!.split('.')[0]}).` }) },
  { kind: 'missing-command', test: /(?:^|\s)([\w./-]+): (?:command )?not found|'([^']+)' is not recognized as an internal or external command|spawn ([\w./-]+) ENOENT|exec: "([^"]+)": executable file not found/m,
    make: m => {
      const cmd = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
      return { title: `The command "${cmd}" is not installed`, hint: `Install ${cmd}, or check that it is on your PATH in this folder's environment.` };
    } },
  { kind: 'missing-env', test: /Environment variable not found: (\w+)|(?:Missing|missing|Required|required)[^\n]{0,30}(?:env(?:ironment)?(?: variable)?)[^\n]{0,10}[:"' ]\s*([A-Z][A-Z0-9_]{2,})|KeyError: '([A-Z][A-Z0-9_]{3,})'/,
    make: m => ({ title: `Environment variable ${m[1] ?? m[2] ?? m[3]} is not set`, hint: 'Add it to your .env file (the .env.example shows which ones the project expects).' }) },
  { kind: 'permission', test: /EACCES[^\n]*|Permission denied[^\n]*|PermissionError[^\n]*/i,
    make: () => ({ title: 'Permission denied', hint: 'The process is not allowed to touch that file or port. Ports below 1024 need elevated rights; try another port.' }) },
  { kind: 'out-of-memory', test: /heap out of memory|OutOfMemoryError|MemoryError|fatal error: runtime: out of memory/i,
    make: () => ({ title: 'The process ran out of memory', hint: 'Raise its memory limit (for Node: NODE_OPTIONS=--max-old-space-size=4096) or look for something that grows without bound.' }) },
  { kind: 'syntax', test: /^\s*(SyntaxError|IndentationError|TabError)[^\n]*|error TS\d+:[^\n]*|error\[E\d+\][^\n]*|error: cannot find symbol|^[^\s:]+\.go:\d+:\d+: [^\n]*/m,
    make: () => ({ title: 'The code does not compile', hint: 'Fix the error shown below. The file and line are in the message.' }) },
  { kind: 'crash', test: /^Traceback \(most recent call last\):|^panic: |thread '[^']*' panicked|Exception in thread|Unhandled (?:exception|rejection)|^\s*(?:Type|Reference|Range)Error: [^\n]*|Segmentation fault/m,
    make: () => ({ title: 'The program crashed', hint: 'The last error it printed is below; the lines above it show where it came from.' }) }
];

/** Why a run ended badly, in plain words, from the tail of its output. `null` for a clean exit. */
export function explainFailure(output: string[], exitCode: number | null, signal?: string | null): Failure | null {
  if (exitCode === 0 && !signal) return null;
  const lines = output.slice(-300).map(stripAnsi);
  const tail = lines.join('\n');
  for (const rule of RULES) {
    const m = rule.test.exec(tail);
    if (m) {
      const evidence = lines.find(l => new RegExp(rule.test.source, rule.test.flags.replace('g', '')).test(l))?.trim() ?? m[0].trim();
      return { kind: rule.kind, evidence: evidence.slice(0, 300), ...rule.make(m, evidence) };
    }
  }
  if (exitCode === 137 || signal === 'SIGKILL') {
    return { kind: 'killed', title: 'The process was killed', hint: 'Usually the system ran out of memory, or something stopped it. Check memory use and the system log.', evidence: '' };
  }
  const last = [...lines].reverse().find(l => /\b(error|exception|panic|fatal|failed|cannot|unable)\b/i.test(l));
  if (last) return { kind: 'error', title: 'It stopped with an error', hint: 'This is the last error line it printed.', evidence: last.trim().slice(0, 300) };
  return { kind: 'exit', title: `It exited with code ${exitCode ?? signal ?? '?'}`, hint: 'It printed nothing that looks like an error. Run it again and read the output above.', evidence: '' };
}

export interface CommandSuggestion {
  label: string;
  command: string;
}

export interface FolderFacts {
  /** File and folder names directly inside the folder. */
  entries: string[];
  /** Parsed `package.json`, when there is one. */
  pkg?: { scripts?: Record<string, string> } | null;
}

/** What to run in a folder, from what is in it. Best guess first; the developer can always type their own. */
export function suggestCommands(f: FolderFacts): CommandSuggestion[] {
  const has = (n: string) => f.entries.includes(n);
  const out: CommandSuggestion[] = [];
  const add = (label: string, command: string) => { if (!out.some(o => o.command === command)) out.push({ label, command }); };
  if (f.pkg?.scripts) {
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
    const run = (s: string) => (pm === 'yarn' ? `yarn ${s}` : pm === 'npm' && s === 'start' ? 'npm start' : `${pm} run ${s}`);
    for (const s of ['dev', 'start', 'serve', 'develop', 'watch']) if (f.pkg.scripts[s]) add(`${pm} ${s}`, run(s));
    if (f.pkg.scripts.build) add(`${pm} build`, run('build'));
    if (f.pkg.scripts.test) add(`${pm} test`, run('test'));
  }
  if (has('manage.py')) add('Django', 'python manage.py runserver');
  if (has('docker-compose.yml') || has('docker-compose.yaml') || has('compose.yml') || has('compose.yaml')) add('Docker Compose', 'docker compose up');
  if (has('artisan')) add('Laravel', 'php artisan serve');
  if (has('bin') && has('Gemfile') && has('config.ru')) add('Rails', 'bin/rails server');
  if (has('go.mod')) add('Go', 'go run .');
  if (has('Cargo.toml')) add('Rust', 'cargo run');
  if (has('gradlew')) add('Gradle', './gradlew bootRun');
  else if (has('pom.xml')) add('Maven', 'mvn spring-boot:run');
  if (has('Package.swift')) add('Swift', 'swift run');
  if (f.entries.some(e => e.endsWith('.csproj') || e.endsWith('.sln'))) add('.NET', 'dotnet run');
  if (has('mix.exs')) add('Elixir', 'mix phx.server');
  for (const main of ['app.py', 'main.py', 'server.py']) if (has(main)) add(`Python ${main}`, `python ${main}`);
  if (has('Makefile')) add('make', 'make');
  return out;
}

/** What a running command reports, in order: each line it prints, then how it ended. */
export type RunEvent =
  | { id: string; kind: 'line'; stream: 'out' | 'err'; text: string }
  | { id: string; kind: 'exit'; code: number | null; signal: string | null; stopped: boolean };

export interface PortOwner {
  pid: number;
  name: string;
}

/** Who is listening on `port`, from the output of `lsof -nP -iTCP:PORT -sTCP:LISTEN -Fpc` (macOS, Linux) or `netstat -ano` (Windows). */
export function parsePortOwner(platform: string, output: string, port: number): PortOwner | null {
  if (platform === 'win32') {
    for (const line of output.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols[0] === 'TCP' && cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${port}`) && /^\d+$/.test(cols[4] ?? '')) {
        return { pid: +cols[4]!, name: '' };
      }
    }
    return null;
  }
  let pid = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = +line.slice(1);
    else if (line.startsWith('c') && pid) return { pid, name: line.slice(1).trim() };
  }
  return null;
}

/** The commands people reach for first, for the "Running on your machine" list. */
export const COMMON_DEV_PORTS = [3000, 3001, 3002, 3333, 4000, 4173, 4200, 4321, 5000, 5001, 5173, 5174, 5500, 6006, 7400, 8000, 8001,
  8080, 8081, 8088, 8100, 8200, 8888, 9000, 1313, 2368, 3030, 4567, 5050, 5555, 7000, 8787];
