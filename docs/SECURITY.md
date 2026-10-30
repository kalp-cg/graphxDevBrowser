# Security and privacy

This is what DevBrowser and SentinelGraph can see and do, written so a security reviewer can check it against the
code. Read the section on the server first: it is the one decision that matters.

## The one thing to know: the server has no login

SentinelGraph's HTTP API has **no authentication**. Anyone who can reach it can read the graph, run the agent,
approve or reject its proposals, and ask it to read a folder on the machine it runs on (the codebase scan).

So:

- It is designed to run **on your own machine**, listening on `127.0.0.1`. `scripts/sentinelgraph.sh` and the Docker
  setup do exactly that.
- **Never publish its port**, never put it behind a public URL, never bind it to `0.0.0.0` on a shared network.
- The default action mode is `dry_run`: approving a rollback, circuit-breaker or scale-up records the decision and
  changes nothing outside the graph. Real execution (Kubernetes, GitHub Actions, the sandbox shop) needs
  `ACTIONS_MODE=live` **and** an adapter you configure. Do not set it on an unauthenticated server.
- The hosted demo in `render.yaml` publishes the API on purpose for sample data. Do not point it at real data.

Adding real authentication and per-user roles is the first item on the roadmap for team use
([Product overview](PRODUCT.md#roadmap)).

## What the desktop app does

| Question | Answer |
| :--- | :--- |
| Does it collect analytics or telemetry? | No. There is no analytics code, and no setting for it. |
| Does it phone home or auto-update? | No. Updates are installs you choose to make. |
| Where does network traffic go? | Pages load directly from their sites. Captured requests go to **one place only: the SentinelGraph server you connect**, and only the page address, the request address, method, status, content type and timing, with the query string and fragment removed. Headers, cookies and bodies are never sent. Local AI calls go to Ollama on this machine (`127.0.0.1:11434` by default). |
| What does it store? | Open tabs, browsing history (last 300 pages), per-profile cookies and storage, the SentinelGraph address, a log file, and window size. Captured traffic and findings stay in memory until you quit. |
| How are saved secrets protected? | Encrypted with the system's secure storage (Keychain on macOS, DPAPI on Windows, libsecret on Linux) through Electron `safeStorage`. They never reach the page or the interface process. |
| Can I wipe it? | Settings, **Clear browsing data**: cookies, storage and cache of every profile, saved credentials, history and captured traffic. |

### Isolating the pages you browse

- Every page runs in a `<webview>` with **Node.js disabled, context isolation on and the Chromium sandbox on**. Pages
  get no preload script, whatever their markup asks for, and the app refuses to attach a webview to anything that is
  not `http(s)`, `about:`, `data:` or `view-source:`.
- Page permissions default to deny. Only sanitized clipboard writes, fullscreen and pointer lock are granted.
- Each profile (Default, Admin, Customer) has its own partition: cookies and storage are not shared.
- The app's own window can never navigate: links in it open in your system browser, and it denies new windows.
- The interface has a Content-Security-Policy, and its privileged calls go through a typed preload bridge
  (`contextIsolation: true`), not through the page.
- The interface process is restarted automatically if it crashes; crashes are written to the log.

### The security audit is passive

The Security panel reads responses your browsing already made. It never sends probes, so it is safe to leave on for
any site. Findings are evidence, not proof of a vulnerability: review them.

## What the server does

- **Reads** the repository folder you point it at: compose and Kubernetes files, source files (to read imports and
  the *names* of the environment variables they use), `CODEOWNERS`, and `git log`. It reads a `.env` file only to
  resolve `${VARIABLES}` in compose files, in memory; those values are not stored. It writes the names it
  finds and recent commit messages and authors into the graph. It does not upload anything anywhere.
- **Never sends your source code to a model.** If you set `LLM_PROVIDER` to a hosted model, that model sees the
  results of graph queries: service names, alert metrics, commit messages and authors. Use `ollama` or the default
  deterministic agent to keep even that on your machine.
- **Proposes, never executes on its own.** Every state-changing action waits for a human **Approve**.
- Runs as an unprivileged user in the Docker image, with the graph in a volume and the projects folder mounted
  read-only.

## Known limitations of version 1.0

- No authentication or authorization on the server (above).
- The installers are not code-signed or notarized; your OS will warn on first launch. Verify downloads against the
  `SHA256SUMS.txt` published with each release.
- Commit messages and author names are stored in the graph as written; a secret pasted into a commit message is not
  scrubbed.
- Single-tenant: one graph per server.

## Reporting a vulnerability

Open a private security advisory on the repository, or email the maintainer at the address in `package.json`.
Please do not file public issues for vulnerabilities. We aim to acknowledge within 3 working days.
