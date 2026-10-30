import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { detectLocalUrls, explainFailure, parsePortOwner, stripAnsi, suggestCommands } from '../../src/shared/domain/run';

describe('reading a dev server\'s output', () => {
  it('strips colours', () => {
    expect(stripAnsi('\u001b[32m  ➜  Local:   http://localhost:5173/\u001b[39m')).toBe('  ➜  Local:   http://localhost:5173/');
  });

  it('finds the address a dev server announces, whatever tool printed it', () => {
    expect(detectLocalUrls('\u001b[1m  ➜  Local:\u001b[22m   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m')).toEqual(['http://localhost:5173']);
    expect(detectLocalUrls('ready - started server on 0.0.0.0:3000, url: http://localhost:3000')).toEqual(['http://localhost:3000']);
    expect(detectLocalUrls('Listening on http://127.0.0.1:8000/api')).toEqual(['http://127.0.0.1:8000/api']);
    expect(detectLocalUrls('Serving at http://0.0.0.0:8080')).toEqual(['http://localhost:8080']);
    expect(detectLocalUrls('Server listening on port 4000')).toEqual(['http://localhost:4000']);
    expect(detectLocalUrls('Started Application in 3.2 seconds, Tomcat started on port 8080')).toEqual(['http://localhost:8080']);
    expect(detectLocalUrls('Network: http://192.168.1.5:3000')).toEqual([]);          // other machines' addresses are not "local"
    expect(detectLocalUrls('see https://example.com:443/docs')).toEqual([]);
    expect(detectLocalUrls('http://localhost:3000\nhttp://localhost:3000\nhttp://localhost:3001')).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });
});

describe('explaining why a run ended', () => {
  const why = (text: string, code = 1) => explainFailure(text.split('\n'), code);

  it('says nothing about a clean exit', () => {
    expect(explainFailure(['done'], 0)).toBeNull();
  });

  it('names the port that is taken, in every language', () => {
    expect(why('Error: listen EADDRINUSE: address already in use :::3000')).toMatchObject({ kind: 'port-in-use', port: 3000 });
    expect(why('OSError: [Errno 98] Address already in use: (\'127.0.0.1\', 8000)\nport 8000 is already in use')).toMatchObject({ kind: 'port-in-use', port: 8000 });
    expect(why('Web server failed to start. Port 8080 was already in use.')).toMatchObject({ kind: 'port-in-use', port: 8080 });
    expect(why('listen tcp :9090: bind: address already in use')).toMatchObject({ kind: 'port-in-use' });
  });

  it('knows what a refused connection to a common service means', () => {
    const f = why('Error: connect ECONNREFUSED 127.0.0.1:5432');
    expect(f).toMatchObject({ kind: 'db-refused', title: 'PostgreSQL is not reachable on port 5432' });
    expect(why('redis.exceptions.ConnectionError: Error connect ECONNREFUSED localhost:6379')?.title).toMatch(/Redis/);
    expect(why('ECONNREFUSED 127.0.0.1:7777')?.title).toBe('Nothing is answering on port 7777');
  });

  it('tells a missing package from a wrong path, and a missing command', () => {
    expect(why("Error: Cannot find module 'express'")).toMatchObject({ kind: 'missing-module', title: 'Missing module "express"' });
    expect(why("Error: Cannot find module './routes/user'")?.hint).toMatch(/does not exist at that path/);
    expect(why("ModuleNotFoundError: No module named 'flask'")?.hint).toMatch(/pip install flask/);
    expect(why('sh: nodemon: command not found', 127)).toMatchObject({ kind: 'missing-command', title: 'The command "nodemon" is not installed' });
    expect(why("'vite' is not recognized as an internal or external command")?.kind).toBe('missing-command');
    expect(why('Error: spawn pnpm ENOENT')?.kind).toBe('missing-command');
  });

  it('points at the missing environment variable', () => {
    expect(why('Error: Environment variable not found: DATABASE_URL.')).toMatchObject({ kind: 'missing-env', title: 'Environment variable DATABASE_URL is not set' });
    expect(why("KeyError: 'SECRET_KEY'")?.kind).toBe('missing-env');
  });

  it('recognises compile errors, crashes and memory, and keeps the line that says it', () => {
    expect(why('src/a.ts(3,1): error TS2304: Cannot find name \'x\'.')?.kind).toBe('syntax');
    expect(why('error[E0382]: borrow of moved value: `v`')?.kind).toBe('syntax');
    expect(why('Traceback (most recent call last):\n  File "app.py", line 3\nValueError: bad')).toMatchObject({ kind: 'crash' });
    expect(why('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory')?.kind).toBe('out-of-memory');
    expect(why('thread \'main\' panicked at src/main.rs:4:5')?.evidence).toMatch(/panicked/);
  });

  it('falls back to the last error-looking line, then to the exit code', () => {
    expect(why('starting\nconfig loaded\nfailed to open the license file\n')).toMatchObject({ kind: 'error', evidence: 'failed to open the license file' });
    expect(why('starting\nbye', 3)).toMatchObject({ kind: 'exit', title: 'It exited with code 3' });
    expect(explainFailure(['x'], 137)?.kind).toBe('killed');
  });

  it('works from coloured output', () => {
    expect(why('\u001b[31mError: listen EADDRINUSE: address already in use :::5173\u001b[39m')).toMatchObject({ port: 5173 });
  });
});

describe('suggesting what to run', () => {
  const cmds = (entries: string[], scripts?: Record<string, string>) =>
    suggestCommands({ entries, pkg: scripts ? { scripts } : null }).map(s => s.command);

  it('uses the package manager the project uses, dev before start before build', () => {
    expect(cmds(['package.json', 'pnpm-lock.yaml'], { dev: 'vite', build: 'vite build', test: 'vitest' })).toEqual(['pnpm run dev', 'pnpm run build', 'pnpm run test']);
    expect(cmds(['package.json', 'yarn.lock'], { start: 'node .' })).toEqual(['yarn start']);
    expect(cmds(['package.json'], { start: 'node .', dev: 'nodemon .' })).toEqual(['npm run dev', 'npm start']);
  });

  it('knows other stacks', () => {
    expect(cmds(['manage.py'])).toEqual(['python manage.py runserver']);
    expect(cmds(['go.mod', 'main.go'])).toEqual(['go run .']);
    expect(cmds(['Cargo.toml'])).toEqual(['cargo run']);
    expect(cmds(['gradlew', 'build.gradle'])).toEqual(['./gradlew bootRun']);
    expect(cmds(['docker-compose.yml'])).toEqual(['docker compose up']);
    expect(cmds(['App.csproj'])).toEqual(['dotnet run']);
    expect(cmds(['README.md'])).toEqual([]);
  });
});

describe('who holds a port', () => {
  it('reads lsof output', () => {
    expect(parsePortOwner('darwin', 'p4242\ncnode\nf23\n', 3000)).toEqual({ pid: 4242, name: 'node' });
    expect(parsePortOwner('linux', '', 3000)).toBeNull();
  });
  it('reads netstat output on Windows', () => {
    const out = '  Proto  Local Address          Foreign Address        State           PID\r\n  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       9876\r\n  TCP    0.0.0.0:30000          0.0.0.0:0              LISTENING       111\r\n';
    expect(parsePortOwner('win32', out, 3000)).toEqual({ pid: 9876, name: '' });
    expect(parsePortOwner('win32', out, 3001)).toBeNull();
  });
});

describe('suggestions for real folders of this repository', () => {
  const root = path.resolve(__dirname, '../../..');
  const facts = (dir: string) => ({
    entries: readdirSync(dir),
    pkg: existsSync(path.join(dir, 'package.json')) ? JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) : null
  });

  it('the app itself: its dev script first', () => {
    expect(suggestCommands(facts(path.join(root, 'DevBrowser')))[0]).toEqual({ label: 'npm dev', command: 'npm run dev' });
  });
  it('the sandbox shop: docker compose', () => {
    expect(suggestCommands(facts(path.join(root, 'sandbox', 'shop'))).map(s => s.command)).toContain('docker compose up');
  });
});
